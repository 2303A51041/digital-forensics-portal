import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { contains, dateOnly, HttpError, objectId, oneOf, text } from '../lib/util.js';
import { caseScope, loadCase, requirePermission } from '../middleware/auth.js';
import { Case, CASE_STATUSES, Evidence, Finding, FINAL_EVIDENCE_STATUSES, nextNumber, PRIORITIES, User } from '../models/index.js';
import { INVESTIGATOR } from '../permissions.js';

const router = Router();

const ASSIGNEE_FIELDS = 'fullName email username';

/** Lead first, then alphabetical: "Ananya Iyer (Lead), Marcus Lindholm". */
export function investigatorNames(caseDoc) {
  return [...caseDoc.assignments]
    .sort((a, b) => (a.roleOnCase === b.roleOnCase ? 0 : a.roleOnCase === 'Lead' ? -1 : 1)
      || String(a.user?.fullName).localeCompare(String(b.user?.fullName)))
    .map((a) => `${a.user?.fullName ?? 'Unknown'}${a.roleOnCase === 'Lead' ? ' (Lead)' : ''}`)
    .join(', ');
}

async function countsByCase(Model, caseIds, extra = {}) {
  const rows = await Model.aggregate([{ $match: { case: { $in: caseIds }, ...extra } }, { $group: { _id: '$case', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

router.get('/', async (req, res) => {
  const filter = caseScope(req.user);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.priority) filter.priority = String(req.query.priority);
  if (req.query.q) filter.$or = [{ title: contains(req.query.q) }, { caseNumber: contains(req.query.q) }];

  const cases = await Case.find(filter).sort({ openedAt: -1, _id: -1 }).populate('assignments.user', ASSIGNEE_FIELDS);
  const ids = cases.map((c) => c._id);
  const [evidence, findings] = await Promise.all([countsByCase(Evidence, ids), countsByCase(Finding, ids)]);
  res.json(cases.map((c) => ({
    ...c.toJSON(),
    investigators: investigatorNames(c),
    evidenceCount: evidence.get(String(c._id)) ?? 0,
    findingCount: findings.get(String(c._id)) ?? 0,
  })));
});

router.post('/', requirePermission('case.create'), async (req, res) => {
  const body = req.body ?? {};
  const doc = new Case({
    title: text(body, 'title', { max: 200, label: 'Title' }),
    description: text(body, 'description', { required: false }),
    caseType: text(body, 'caseType', { max: 100, label: 'Case type' }),
    priority: oneOf(body.priority || 'Medium', PRIORITIES, 'Priority'),
    dueDate: dateOnly(body.dueDate, 'Due date'),
    createdBy: req.user._id,
  });
  doc.caseNumber = await nextNumber('DF');
  await doc.save();
  await audit(req, 'CASE_CREATED', 'case', doc.caseNumber, doc.title);
  res.status(201).json(doc);
});

router.get('/assignable-investigators', requirePermission('case.assign'), async (_req, res) => {
  const [users, active] = await Promise.all([
    User.find({ role: INVESTIGATOR, isActive: true }).sort({ fullName: 1 }),
    Case.aggregate([
      { $match: { status: { $ne: 'Closed' } } },
      { $unwind: '$assignments' },
      { $group: { _id: '$assignments.user', n: { $sum: 1 } } },
    ]),
  ]);
  const counts = new Map(active.map((r) => [String(r._id), r.n]));
  res.json(users.map((u) => ({ id: String(u._id), fullName: u.fullName, activeCases: counts.get(String(u._id)) ?? 0 })));
});

router.get('/:id', async (req, res) => {
  const doc = await loadCase(req, req.params.id);
  await doc.populate('assignments.user', ASSIGNEE_FIELDS);
  const evidence = await Evidence.find({ case: doc._id }).sort({ _id: 1 }).populate('currentCustodian', 'fullName');
  res.json({ ...doc.toJSON(), investigators: investigatorNames(doc), evidence });
});

router.patch('/:id', requirePermission('case.update'), async (req, res) => {
  const doc = await loadCase(req, req.params.id);
  const body = req.body ?? {};
  const has = (key) => Object.hasOwn(body, key);
  const before = doc.toObject();

  if (has('title')) doc.title = text(body, 'title', { max: 200, label: 'Title' });
  if (has('description')) doc.description = text(body, 'description', { required: false });
  if (has('caseType')) doc.caseType = text(body, 'caseType', { max: 100, label: 'Case type' });
  if (has('priority')) doc.priority = oneOf(body.priority, PRIORITIES, 'Priority');
  if (has('dueDate')) doc.dueDate = dateOnly(body.dueDate, 'Due date');
  if (has('status')) doc.status = oneOf(body.status, CASE_STATUSES, 'Status');
  doc.closedAt = doc.status === 'Closed' ? (before.closedAt ?? new Date()) : null;

  const changes = ['title', 'caseType', 'priority', 'dueDate', 'status']
    .filter((key) => before[key] !== doc[key])
    .map((key) => `${key}: ${before[key] ?? '-'} -> ${doc[key] ?? '-'}`);
  await doc.save();
  await audit(req, before.status !== doc.status ? 'CASE_STATUS_CHANGED' : 'CASE_UPDATED', 'case', doc.caseNumber, changes.join('; '));
  res.json(doc);
});

router.put('/:id/assignments', requirePermission('case.assign'), async (req, res) => {
  const doc = await loadCase(req, req.params.id);
  if (doc.status === 'Closed') throw new HttpError(409, 'Reopen the case before changing assignments');
  const userId = objectId(req.body?.userId, 'investigator');
  const roleOnCase = oneOf(req.body?.roleOnCase || 'Support', ['Lead', 'Support'], 'Case role');
  const user = await User.findOne({ _id: userId, isActive: true, role: INVESTIGATOR });
  if (!user) throw new HttpError(400, 'Only active forensic investigators can be assigned');

  // A case has at most one lead: promoting someone demotes the current lead to support.
  if (roleOnCase === 'Lead') doc.assignments.forEach((a) => { if (a.roleOnCase === 'Lead') a.roleOnCase = 'Support'; });
  const existing = doc.assignments.find((a) => String(a.user) === userId);
  if (existing) existing.roleOnCase = roleOnCase;
  else doc.assignments.push({ user: user._id, roleOnCase, assignedBy: req.user._id, assignedAt: new Date() });
  await doc.save();
  await audit(req, 'CASE_ASSIGNED', 'case', doc.caseNumber, `${user.username} as ${roleOnCase}`);
  res.status(204).end();
});

router.delete('/:id/assignments/:userId', requirePermission('case.assign'), async (req, res) => {
  const doc = await loadCase(req, req.params.id);
  const userId = objectId(req.params.userId, 'investigator');
  const held = await Evidence.countDocuments({ case: doc._id, currentCustodian: userId, status: { $nin: FINAL_EVIDENCE_STATUSES } });
  if (held > 0) {
    throw new HttpError(409, `This investigator still holds ${held} evidence item(s) on this case. Transfer custody first.`);
  }
  const index = doc.assignments.findIndex((a) => String(a.user) === userId);
  if (index < 0) throw new HttpError(404, 'Assignment not found');
  doc.assignments.splice(index, 1);
  await doc.save();
  const user = await User.findById(userId).select('username');
  await audit(req, 'CASE_UNASSIGNED', 'case', doc.caseNumber, user?.username ?? userId);
  res.status(204).end();
});

export default router;
