import { Router } from 'express';
import { all, get, run, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { dateOnly, HttpError, id, nowIso, oneOf, text } from '../lib/util.js';
import { caseScope, loadCase, requirePermission } from '../middleware/auth.js';
import { INVESTIGATOR } from '../permissions.js';

const router = Router();

export const CASE_STATUSES = ['Open', 'In Progress', 'On Hold', 'Closed'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const INVESTIGATORS_SQL = `(
  SELECT group_concat(u.full_name || CASE a.role_on_case WHEN 'Lead' THEN ' (Lead)' ELSE '' END, ', ')
  FROM case_assignments a JOIN users u ON u.id = a.user_id WHERE a.case_id = c.id)`;

router.get('/', (req, res) => {
  const scope = caseScope(req.user);
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.query.status) { where.push('c.status = ?'); params.push(String(req.query.status)); }
  if (req.query.priority) { where.push('c.priority = ?'); params.push(String(req.query.priority)); }
  if (req.query.q) {
    where.push('(c.title LIKE ? OR c.case_number LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  res.json(all(
    `SELECT c.*, ${INVESTIGATORS_SQL} AS investigators,
       (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count,
       (SELECT COUNT(*) FROM findings f WHERE f.case_id = c.id) AS finding_count
     FROM cases c WHERE ${where.join(' AND ')} ORDER BY c.opened_at DESC, c.id DESC`,
    ...params,
  ));
});

router.post('/', requirePermission('case.create'), (req, res) => {
  const body = req.body ?? {};
  const title = text(body, 'title', { max: 200, label: 'Title' });
  const description = text(body, 'description', { required: false });
  const caseType = text(body, 'case_type', { max: 100, label: 'Case type' });
  const priority = oneOf(body.priority || 'Medium', PRIORITIES, 'Priority');
  const dueDate = dateOnly(body.due_date, 'Due date');
  const now = nowIso();

  const created = tx(() => {
    const { n } = get('SELECT COUNT(*) AS n FROM cases');
    const caseNumber = `DF-${now.slice(0, 4)}-${String(n + 1).padStart(4, '0')}`;
    const result = run(
      `INSERT INTO cases (case_number, title, description, case_type, priority, created_by, opened_at, due_date, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      caseNumber, title, description, caseType, priority, req.user.id, now, dueDate, now,
    );
    audit(req, 'CASE_CREATED', 'case', caseNumber, title);
    return get('SELECT * FROM cases WHERE id = ?', Number(result.lastInsertRowid));
  });
  res.status(201).json(created);
});

router.get('/assignable-investigators', requirePermission('case.assign'), (_req, res) => {
  res.json(all(
    `SELECT u.id, u.full_name,
       (SELECT COUNT(*) FROM case_assignments a JOIN cases c ON c.id = a.case_id
        WHERE a.user_id = u.id AND c.status <> 'Closed') AS active_cases
     FROM users u WHERE u.role = ? AND u.is_active = 1 ORDER BY u.full_name`,
    INVESTIGATOR,
  ));
});

router.get('/:id', (req, res) => {
  const row = loadCase(req, req.params.id);
  res.json({
    ...row,
    assignments: all(
      `SELECT a.user_id, a.role_on_case, a.assigned_at, u.full_name, u.email
       FROM case_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.case_id = ? ORDER BY a.role_on_case, u.full_name`, row.id,
    ),
    evidence: all(
      `SELECT e.id, e.evidence_number, e.item_name, e.evidence_type, e.status, u.full_name AS custodian
       FROM evidence e JOIN users u ON u.id = e.current_custodian_id WHERE e.case_id = ? ORDER BY e.id`, row.id,
    ),
  });
});

router.patch('/:id', requirePermission('case.update'), (req, res) => {
  const row = loadCase(req, req.params.id);
  const body = req.body ?? {};
  const has = (key) => Object.hasOwn(body, key);
  const status = has('status') ? oneOf(body.status, CASE_STATUSES, 'Status') : row.status;
  const updated = {
    title: has('title') ? text(body, 'title', { max: 200, label: 'Title' }) : row.title,
    description: has('description') ? text(body, 'description', { required: false }) : row.description,
    case_type: has('case_type') ? text(body, 'case_type', { max: 100, label: 'Case type' }) : row.case_type,
    priority: has('priority') ? oneOf(body.priority, PRIORITIES, 'Priority') : row.priority,
    due_date: has('due_date') ? dateOnly(body.due_date, 'Due date') : row.due_date,
  };
  const now = nowIso();
  const closedAt = status === 'Closed' ? (row.closed_at ?? now) : null;

  const changes = [];
  for (const [key, value] of [...Object.entries(updated), ['status', status]]) {
    if (key !== 'description' && value !== row[key]) changes.push(`${key}: ${row[key] ?? '-'} -> ${value ?? '-'}`);
  }
  tx(() => {
    run(
      `UPDATE cases SET title = ?, description = ?, case_type = ?, priority = ?, due_date = ?, status = ?, closed_at = ?, updated_at = ?
       WHERE id = ?`,
      updated.title, updated.description, updated.case_type, updated.priority, updated.due_date,
      status, closedAt, now, row.id,
    );
    audit(req, status !== row.status ? 'CASE_STATUS_CHANGED' : 'CASE_UPDATED', 'case', row.case_number, changes.join('; '));
  });
  res.json(get('SELECT * FROM cases WHERE id = ?', row.id));
});

router.put('/:id/assignments', requirePermission('case.assign'), (req, res) => {
  const row = loadCase(req, req.params.id);
  if (row.status === 'Closed') throw new HttpError(409, 'Reopen the case before changing assignments');
  const userId = id(req.body?.user_id, 'investigator');
  const roleOnCase = oneOf(req.body?.role_on_case || 'Support', ['Lead', 'Support'], 'Case role');
  const user = get('SELECT * FROM users WHERE id = ? AND is_active = 1 AND role = ?', userId, INVESTIGATOR);
  if (!user) throw new HttpError(400, 'Only active forensic investigators can be assigned');

  tx(() => {
    if (roleOnCase === 'Lead') {
      run("UPDATE case_assignments SET role_on_case = 'Support' WHERE case_id = ? AND role_on_case = 'Lead'", row.id);
    }
    run(
      `INSERT INTO case_assignments (case_id, user_id, role_on_case, assigned_by, assigned_at) VALUES (?,?,?,?,?)
       ON CONFLICT (case_id, user_id) DO UPDATE SET role_on_case = excluded.role_on_case`,
      row.id, userId, roleOnCase, req.user.id, nowIso(),
    );
    audit(req, 'CASE_ASSIGNED', 'case', row.case_number, `${user.username} as ${roleOnCase}`);
  });
  res.status(204).end();
});

router.delete('/:id/assignments/:userId', requirePermission('case.assign'), (req, res) => {
  const row = loadCase(req, req.params.id);
  const userId = id(req.params.userId, 'investigator');
  const { held } = get(
    "SELECT COUNT(*) AS held FROM evidence WHERE case_id = ? AND current_custodian_id = ? AND status NOT IN ('Released','Archived')",
    row.id, userId,
  );
  if (held > 0) {
    throw new HttpError(409, `This investigator still holds ${held} evidence item(s) on this case. Transfer custody first.`);
  }
  tx(() => {
    const { changes } = run('DELETE FROM case_assignments WHERE case_id = ? AND user_id = ?', row.id, userId);
    if (!changes) throw new HttpError(404, 'Assignment not found');
    audit(req, 'CASE_UNASSIGNED', 'case', row.case_number, `user id ${userId}`);
  });
  res.status(204).end();
});

export default router;
