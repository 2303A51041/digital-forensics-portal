import { Router } from 'express';
import { audit, verifyChain } from '../lib/audit.js';
import { contains, dateRange } from '../lib/util.js';
import { requirePermission } from '../middleware/auth.js';
import { ACCESS_ACTIONS, AccessLog, AuditLog, Evidence, User } from '../models/index.js';

const router = Router();
router.use(requirePermission('audit.view'));

function paging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

router.get('/logs', async (req, res) => {
  const { page, pageSize, skip } = paging(req.query);
  const filter = {};
  if (req.query.action) filter.action = String(req.query.action);
  if (req.query.q) {
    const like = contains(req.query.q);
    filter.$or = [{ username: like }, { details: like }, { entityId: like }];
  }
  const range = dateRange(req.query);
  if (range) filter.occurredAt = range;

  const [total, actions, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.distinct('action'),
    AuditLog.find(filter).sort({ seq: -1 }).skip(skip).limit(pageSize),
  ]);
  res.json({ total, page, pageSize, actions: actions.sort(), rows });
});

router.get('/evidence-access', async (req, res) => {
  const { page, pageSize, skip } = paging(req.query);
  const filter = {};
  if (req.query.action) filter.action = String(req.query.action);
  if (req.query.q) {
    const like = contains(req.query.q);
    const [evidenceIds, userIds] = await Promise.all([
      Evidence.find({ evidenceNumber: like }).distinct('_id'),
      User.find({ fullName: like }).distinct('_id'),
    ]);
    filter.$or = [{ evidence: { $in: evidenceIds } }, { user: { $in: userIds } }, { detail: like }];
  }
  const range = dateRange(req.query);
  if (range) filter.accessedAt = range;

  const [total, rows] = await Promise.all([
    AccessLog.countDocuments(filter),
    AccessLog.find(filter).sort({ _id: -1 }).skip(skip).limit(pageSize)
      .populate('evidence', 'evidenceNumber itemName').populate('user', 'fullName'),
  ]);
  res.json({ total, page, pageSize, actions: ACCESS_ACTIONS, rows });
});

router.post('/verify-chain', async (req, res) => {
  const result = await verifyChain();
  await audit(req, 'AUDIT_CHAIN_VERIFIED', 'audit', '', result.valid ? `Valid, ${result.checked} entries` : `BROKEN at ${result.firstBrokenId}`);
  res.json(result);
});

export default router;
