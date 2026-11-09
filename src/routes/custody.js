import { Router } from 'express';
import { all } from '../db/index.js';
import { id } from '../lib/util.js';
import { caseScope } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  const scope = caseScope(req.user);
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.query.evidence_id) { where.push('e.id = ?'); params.push(id(req.query.evidence_id, 'evidence id')); }
  if (req.query.case_id) { where.push('c.id = ?'); params.push(id(req.query.case_id, 'case id')); }
  res.json(all(
    `SELECT ce.*, e.evidence_number, e.item_name, c.case_number,
       fu.full_name AS from_name, tu.full_name AS to_name, ru.full_name AS recorded_by_name
     FROM custody_events ce
     JOIN evidence e ON e.id = ce.evidence_id
     JOIN cases c ON c.id = e.case_id
     LEFT JOIN users fu ON fu.id = ce.from_user_id
     JOIN users tu ON tu.id = ce.to_user_id
     JOIN users ru ON ru.id = ce.recorded_by
     WHERE ${where.join(' AND ')} ORDER BY ce.occurred_at DESC, ce.id DESC LIMIT 200`,
    ...params,
  ));
});

export default router;
