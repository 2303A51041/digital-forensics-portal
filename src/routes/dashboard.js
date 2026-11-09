import { Router } from 'express';
import { all, get } from '../db/index.js';
import { caseScope } from '../middleware/auth.js';
import { can, INVESTIGATOR } from '../permissions.js';

const router = Router();

router.get('/', (req, res) => {
  const scope = caseScope(req.user);
  const p = scope.params;
  const casesWhere = `FROM cases c WHERE ${scope.sql}`;
  const evidenceFrom = `FROM evidence e JOIN cases c ON c.id = e.case_id WHERE ${scope.sql}`;

  res.json({
    stats: {
      active_cases: get(`SELECT COUNT(*) AS n ${casesWhere} AND c.status <> 'Closed'`, ...p).n,
      overdue_cases: get(`SELECT COUNT(*) AS n ${casesWhere} AND c.status <> 'Closed' AND c.due_date < date('now')`, ...p).n,
      evidence_items: get(`SELECT COUNT(*) AS n ${evidenceFrom}`, ...p).n,
      integrity_failures: get(`SELECT COUNT(*) AS n ${evidenceFrom} AND e.last_verify_result = 'Mismatch'`, ...p).n,
      transfers_7d: get(
        `SELECT COUNT(*) AS n FROM custody_events ce JOIN evidence e ON e.id = ce.evidence_id JOIN cases c ON c.id = e.case_id
         WHERE ${scope.sql} AND ce.action = 'Transfer' AND ce.occurred_at >= datetime('now', '-7 days')`, ...p,
      ).n,
      draft_findings: get(
        `SELECT COUNT(*) AS n FROM findings f JOIN cases c ON c.id = f.case_id WHERE ${scope.sql} AND f.status = 'Draft'`, ...p,
      ).n,
    },
    cases_by_status: all(`SELECT c.status AS label, COUNT(*) AS value ${casesWhere} GROUP BY c.status`, ...p),
    evidence_by_status: all(`SELECT e.status AS label, COUNT(*) AS value ${evidenceFrom} GROUP BY e.status`, ...p),
    workload: can(req.user, 'report.view')
      ? all(
        `SELECT u.full_name AS label, COUNT(c.id) AS value
         FROM users u
         LEFT JOIN case_assignments a ON a.user_id = u.id
         LEFT JOIN cases c ON c.id = a.case_id AND c.status <> 'Closed'
         WHERE u.role = ? AND u.is_active = 1 GROUP BY u.id ORDER BY value DESC, u.full_name`, INVESTIGATOR,
      )
      : null,
    deadlines: all(
      `SELECT c.id, c.case_number, c.title, c.priority, c.status, c.due_date ${casesWhere}
       AND c.status <> 'Closed' AND c.due_date IS NOT NULL ORDER BY c.due_date LIMIT 5`, ...p,
    ),
    recent_custody: all(
      `SELECT ce.id, ce.action, ce.occurred_at, ce.purpose, e.evidence_number, fu.full_name AS from_name, tu.full_name AS to_name
       FROM custody_events ce
       JOIN evidence e ON e.id = ce.evidence_id JOIN cases c ON c.id = e.case_id
       LEFT JOIN users fu ON fu.id = ce.from_user_id JOIN users tu ON tu.id = ce.to_user_id
       WHERE ${scope.sql} ORDER BY ce.occurred_at DESC, ce.id DESC LIMIT 6`, ...p,
    ),
  });
});

export default router;
