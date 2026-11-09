import crypto from 'node:crypto';
import { all, get, run } from '../db/index.js';
import { nowIso } from './util.js';

const GENESIS = '0'.repeat(64);

function computeHash(row) {
  const payload = [
    row.prev_hash, row.occurred_at, row.user_id ?? '', row.username, row.role,
    row.action, row.entity_type, row.entity_id, row.details, row.ip_address,
  ].join('\u001f');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** Appends to the hash-chained audit log. req supplies the actor unless actor is given. */
export function audit(req, action, entityType = '', entityId = '', details = '', actor = req?.user) {
  const previous = get('SELECT row_hash FROM audit_logs ORDER BY id DESC LIMIT 1');
  const row = {
    occurred_at: nowIso(),
    user_id: actor?.id ?? null,
    username: actor?.username ?? 'anonymous',
    role: actor?.role ?? '',
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    details: String(details),
    ip_address: req?.ip ?? '',
    prev_hash: previous?.row_hash ?? GENESIS,
  };
  row.row_hash = computeHash(row);
  run(
    `INSERT INTO audit_logs (occurred_at, user_id, username, role, action, entity_type, entity_id, details, ip_address, prev_hash, row_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    row.occurred_at, row.user_id, row.username, row.role, row.action, row.entity_type,
    row.entity_id, row.details, row.ip_address, row.prev_hash, row.row_hash,
  );
}

/** Walks the whole chain and reports the first row that does not match. */
export function verifyChain() {
  let expectedPrev = GENESIS;
  let previousId = 0;
  const rows = all('SELECT * FROM audit_logs ORDER BY id');
  for (const row of rows) {
    if (row.id !== previousId + 1) {
      return { valid: false, checked: rows.length, firstBrokenId: previousId + 1, reason: 'Missing log entry' };
    }
    if (row.prev_hash !== expectedPrev) {
      return { valid: false, checked: rows.length, firstBrokenId: row.id, reason: 'Chain link mismatch' };
    }
    if (computeHash(row) !== row.row_hash) {
      return { valid: false, checked: rows.length, firstBrokenId: row.id, reason: 'Entry contents altered' };
    }
    expectedPrev = row.row_hash;
    previousId = row.id;
  }
  return { valid: true, checked: rows.length };
}

export function logEvidenceAccess(req, evidenceId, action, detail = '') {
  run(
    'INSERT INTO evidence_access_logs (evidence_id, user_id, action, detail, ip_address, accessed_at) VALUES (?,?,?,?,?,?)',
    evidenceId, req.user.id, action, detail, req.ip ?? '', nowIso(),
  );
}
