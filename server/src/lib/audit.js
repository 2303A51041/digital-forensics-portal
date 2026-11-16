import crypto from 'node:crypto';
import { AccessLog, AuditLog } from '../models/index.js';

const GENESIS = '0'.repeat(64);

function computeHash(row) {
  const payload = [
    row.prevHash, row.seq, new Date(row.occurredAt).toISOString(), row.user ? String(row.user) : '',
    row.username, row.role, row.action, row.entityType, row.entityId, row.details, row.ip,
  ].join('\u001f');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Entries are written one at a time so each one links to the entry written just before it.
let queue = Promise.resolve();

/** Appends to the hash-chained audit log. req supplies the actor and IP unless actor is given. */
export function audit(req, action, entityType = '', entityId = '', details = '', actor = req?.user) {
  const task = queue.then(async () => {
    const last = await AuditLog.findOne().sort({ seq: -1 }).select('seq rowHash').lean();
    const row = {
      seq: (last?.seq ?? 0) + 1,
      occurredAt: new Date(),
      user: actor?._id ?? null,
      username: actor?.username ?? 'anonymous',
      role: actor?.role ?? '',
      action,
      entityType,
      entityId: String(entityId ?? ''),
      details: String(details ?? ''),
      ip: req?.ip ?? '',
      prevHash: last?.rowHash ?? GENESIS,
    };
    row.rowHash = computeHash(row);
    await AuditLog.create(row);
  });
  queue = task.catch(() => {});
  return task;
}

/** Walks the whole chain and reports the first entry that is missing or does not match. */
export async function verifyChain() {
  let expectedPrev = GENESIS;
  let expectedSeq = 1;
  let checked = 0;
  for await (const row of AuditLog.find().sort({ seq: 1 }).lean().cursor()) {
    checked += 1;
    if (row.seq !== expectedSeq) return { valid: false, checked, firstBrokenId: expectedSeq, reason: 'Missing log entry' };
    if (row.prevHash !== expectedPrev) return { valid: false, checked, firstBrokenId: row.seq, reason: 'Chain link mismatch' };
    if (computeHash(row) !== row.rowHash) return { valid: false, checked, firstBrokenId: row.seq, reason: 'Entry contents altered' };
    expectedPrev = row.rowHash;
    expectedSeq += 1;
  }
  return { valid: true, checked };
}

export function logEvidenceAccess(req, evidenceId, action, detail = '') {
  return AccessLog.create({ evidence: evidenceId, user: req.user._id, action, detail, ip: req.ip ?? '' });
}
