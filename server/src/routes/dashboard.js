import { Router } from 'express';
import { todayUtc } from '../lib/util.js';
import { caseScope, scopeByCase } from '../middleware/auth.js';
import { Case, CustodyEvent, Evidence, Finding, User } from '../models/index.js';
import { can, INVESTIGATOR } from '../permissions.js';

const router = Router();

const groupCount = (Model, match, field) =>
  Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, value: { $sum: 1 } } }])
    .then((rows) => rows.map((r) => ({ label: r._id, value: r.value })));

router.get('/', async (req, res) => {
  const cases = caseScope(req.user);
  const open = { ...cases, status: { $ne: 'Closed' } };
  const evidence = await scopeByCase(req.user);
  const evidenceIds = await Evidence.find(evidence).distinct('_id');
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const [activeCases, overdueCases, evidenceItems, integrityFailures, transfers7d, draftFindings,
    casesByStatus, evidenceByStatus, deadlines, recentCustody] = await Promise.all([
    Case.countDocuments(open),
    Case.countDocuments({ ...open, dueDate: { $ne: null, $lt: todayUtc() } }),
    Evidence.countDocuments(evidence),
    Evidence.countDocuments({ ...evidence, lastVerifyResult: 'Mismatch' }),
    CustodyEvent.countDocuments({ evidence: { $in: evidenceIds }, action: 'Transfer', occurredAt: { $gte: weekAgo } }),
    Finding.countDocuments(await scopeByCase(req.user, { status: 'Draft' })),
    groupCount(Case, cases, 'status'),
    groupCount(Evidence, evidence, 'status'),
    Case.find({ ...open, dueDate: { $ne: null } }).sort({ dueDate: 1 }).limit(5).select('caseNumber title priority status dueDate'),
    CustodyEvent.find({ evidence: { $in: evidenceIds } }).sort({ occurredAt: -1, _id: -1 }).limit(6)
      .populate('evidence', 'evidenceNumber').populate('fromUser', 'fullName').populate('toUser', 'fullName'),
  ]);

  let workload = null;
  if (can(req.user, 'report.view')) {
    const investigators = await User.find({ role: INVESTIGATOR, isActive: true }).sort({ fullName: 1 });
    const active = await Case.aggregate([
      { $match: { status: { $ne: 'Closed' } } },
      { $unwind: '$assignments' },
      { $group: { _id: '$assignments.user', value: { $sum: 1 } } },
    ]);
    const counts = new Map(active.map((r) => [String(r._id), r.value]));
    workload = investigators
      .map((u) => ({ label: u.fullName, value: counts.get(String(u._id)) ?? 0 }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  res.json({
    stats: { activeCases, overdueCases, evidenceItems, integrityFailures, transfers7d, draftFindings },
    casesByStatus,
    evidenceByStatus,
    workload,
    deadlines,
    recentCustody,
  });
});

export default router;
