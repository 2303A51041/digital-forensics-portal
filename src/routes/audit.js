import { Router } from 'express';
import { all, get, tx } from '../db/index.js';
import { audit, verifyChain } from '../lib/audit.js';
import { dateOnly } from '../lib/util.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requirePermission('audit.view'));

function paging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size, 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function dateClauses(column, query, where, params) {
  const from = dateOnly(query.from, 'From date');
  const to = dateOnly(query.to, 'To date');
  if (from) { where.push(`date(${column}) >= ?`); params.push(from); }
  if (to) { where.push(`date(${column}) <= ?`); params.push(to); }
}

router.get('/logs', (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['1 = 1'];
  const params = [];
  if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action)); }
  if (req.query.q) {
    const like = `%${req.query.q}%`;
    where.push('(username LIKE ? OR details LIKE ? OR entity_id LIKE ?)');
    params.push(like, like, like);
  }
  dateClauses('occurred_at', req.query, where, params);
  const clause = where.join(' AND ');
  res.json({
    total: get(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${clause}`, ...params).n,
    page,
    page_size: pageSize,
    actions: all('SELECT DISTINCT action FROM audit_logs ORDER BY action').map((r) => r.action),
    rows: all(`SELECT * FROM audit_logs WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset),
  });
});

router.get('/evidence-access', (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['1 = 1'];
  const params = [];
  if (req.query.action) { where.push('l.action = ?'); params.push(String(req.query.action)); }
  if (req.query.q) {
    const like = `%${req.query.q}%`;
    where.push('(e.evidence_number LIKE ? OR u.full_name LIKE ? OR l.detail LIKE ?)');
    params.push(like, like, like);
  }
  dateClauses('l.accessed_at', req.query, where, params);
  const clause = where.join(' AND ');
  const from = 'FROM evidence_access_logs l JOIN evidence e ON e.id = l.evidence_id JOIN users u ON u.id = l.user_id';
  res.json({
    total: get(`SELECT COUNT(*) AS n ${from} WHERE ${clause}`, ...params).n,
    page,
    page_size: pageSize,
    actions: ['View', 'Download', 'Verify', 'Transfer', 'Register'],
    rows: all(
      `SELECT l.*, e.evidence_number, e.item_name, u.full_name ${from} WHERE ${clause} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, offset,
    ),
  });
});

router.post('/verify-chain', (req, res) => {
  const result = verifyChain();
  tx(() => audit(req, 'AUDIT_CHAIN_VERIFIED', 'audit', '', result.valid ? `Valid, ${result.checked} entries` : `BROKEN at ${result.firstBrokenId}`));
  res.json(result);
});

export default router;
