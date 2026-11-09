import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { all, get, run, tx } from '../db/index.js';
import { audit, logEvidenceAccess } from '../lib/audit.js';
import { hashFile, hashValue, HttpError, id, nowIso, oneOf, pastTimestamp, removeFile, text } from '../lib/util.js';
import { caseScope, isAssigned, loadCase, requirePermission } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { can, INVESTIGATOR } from '../permissions.js';

const router = Router();

export const EVIDENCE_STATUSES = ['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived'];
const FINAL_STATUSES = ['Released', 'Archived'];

const EVIDENCE_SELECT = `
  SELECT e.*, c.case_number, c.title AS case_title, c.status AS case_status,
    cu.full_name AS custodian, ru.full_name AS registered_by_name
  FROM evidence e
  JOIN cases c ON c.id = e.case_id
  JOIN users cu ON cu.id = e.current_custodian_id
  JOIN users ru ON ru.id = e.registered_by`;

function loadEvidence(req, rawId) {
  const scope = caseScope(req.user);
  const row = get(`${EVIDENCE_SELECT} WHERE e.id = ? AND ${scope.sql}`, id(rawId, 'evidence id'), ...scope.params);
  if (!row) throw new HttpError(404, 'Evidence not found');
  return row;
}

/** Browsers send UTF-8 filenames, which multipart parsing decodes as latin1. */
const decodeFilename = (name) => path.basename(Buffer.from(name, 'latin1').toString('utf8'));

const canHold = (evidence, user) =>
  user.is_active && user.id !== evidence.current_custodian_id && (
    user.role === 'Admin' || user.role === 'Case Manager' ||
    (user.role === INVESTIGATOR && isAssigned(user.id, evidence.case_id))
  );

router.get('/', (req, res) => {
  const scope = caseScope(req.user);
  const where = [scope.sql];
  const params = [...scope.params];
  if (req.query.case_id) { where.push('e.case_id = ?'); params.push(id(req.query.case_id, 'case id')); }
  if (req.query.status) { where.push('e.status = ?'); params.push(String(req.query.status)); }
  if (req.query.q) {
    const like = `%${req.query.q}%`;
    where.push('(e.item_name LIKE ? OR e.evidence_number LIKE ? OR e.sha256 LIKE ? OR e.md5 LIKE ?)');
    params.push(like, like, like, like);
  }
  res.json(all(`${EVIDENCE_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.id DESC`, ...params));
});

router.post('/', requirePermission('evidence.register'), upload.single('file'), async (req, res) => {
  const body = req.body ?? {};
  const caseRow = loadCase(req, body.case_id);
  if (caseRow.status === 'Closed') throw new HttpError(409, 'Evidence cannot be added to a closed case');

  const fields = {
    item: text(body, 'item_name', { max: 200, label: 'Item name' }),
    type: text(body, 'evidence_type', { max: 100, label: 'Evidence type' }),
    source: text(body, 'source', { max: 500, label: 'Source' }),
    description: text(body, 'description', { required: false }),
    location: text(body, 'storage_location', { required: false, max: 200 }),
    collectedAt: pastTimestamp(body.collected_at, 'Collection time'),
  };
  let sha256 = hashValue(body.sha256, 'sha256');
  let md5 = hashValue(body.md5, 'md5');
  let origin = 'Declared';

  if (req.file) {
    const computed = await hashFile(req.file.path);
    if ((sha256 && sha256 !== computed.sha256) || (md5 && md5 !== computed.md5)) {
      audit(req, 'EVIDENCE_HASH_REJECTED', 'case', caseRow.case_number, `Declared hash did not match upload ${fields.item}`);
      throw new HttpError(422, 'The declared hash does not match the uploaded file. Nothing was registered.');
    }
    ({ sha256, md5 } = computed);
    origin = 'Computed';
  } else if (!sha256 && !md5) {
    throw new HttpError(400, 'Upload a file or enter a SHA-256 or MD5 hash');
  }

  const now = nowIso();
  const created = tx(() => {
    const { n } = get('SELECT COUNT(*) AS n FROM evidence');
    const number = `EV-${now.slice(0, 4)}-${String(n + 1).padStart(4, '0')}`;
    const result = run(
      `INSERT INTO evidence (evidence_number, case_id, item_name, evidence_type, source, description, storage_location,
         collected_at, registered_at, registered_by, sha256, md5, hash_origin, file_storage_name, original_filename,
         mime_type, file_size, current_custodian_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, caseRow.id, fields.item, fields.type, fields.source, fields.description, fields.location,
      fields.collectedAt, now, req.user.id, sha256, md5, origin,
      req.file?.filename ?? null, req.file ? decodeFilename(req.file.originalname) : null,
      req.file?.mimetype ?? null, req.file?.size ?? null, req.user.id,
    );
    const evidenceId = Number(result.lastInsertRowid);
    run(
      `INSERT INTO custody_events (evidence_id, action, from_user_id, to_user_id, location, purpose, status_after, occurred_at, recorded_by, recorded_at)
       VALUES (?, 'Registered', NULL, ?, ?, 'Initial registration', 'In Storage', ?, ?, ?)`,
      evidenceId, req.user.id, fields.location, now, req.user.id, now,
    );
    logEvidenceAccess(req, evidenceId, 'Register', origin === 'Computed' ? 'File uploaded and hashed' : 'Metadata only');
    audit(req, 'EVIDENCE_REGISTERED', 'evidence', number, `${fields.item} (${caseRow.case_number})`);
    return get(`${EVIDENCE_SELECT} WHERE e.id = ?`, evidenceId);
  });
  req.keepUpload = true;
  res.status(201).json(created);
});

router.get('/:id', (req, res) => {
  const row = loadEvidence(req, req.params.id);
  tx(() => logEvidenceAccess(req, row.id, 'View'));
  res.json({
    ...row,
    custody: custodyFor(row.id),
    access_log: can(req.user, 'audit.view')
      ? all(
        `SELECT l.*, u.full_name FROM evidence_access_logs l JOIN users u ON u.id = l.user_id
         WHERE l.evidence_id = ? ORDER BY l.id DESC LIMIT 50`, row.id,
      )
      : undefined,
  });
});

router.get('/:id/download', requirePermission('evidence.download'), (req, res) => {
  const row = loadEvidence(req, req.params.id);
  if (!row.file_storage_name) throw new HttpError(404, 'No file is stored for this evidence item');
  const filePath = path.join(config.uploadDir, row.file_storage_name);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'The stored file is missing from evidence storage');
  tx(() => {
    logEvidenceAccess(req, row.id, 'Download', row.original_filename);
    audit(req, 'EVIDENCE_DOWNLOADED', 'evidence', row.evidence_number, row.original_filename);
  });
  res.download(filePath, row.original_filename);
});

// Checks the stored file, or a re-acquired file sent by the client, against the registered hashes.
router.post('/:id/verify', requirePermission('evidence.verify'), upload.single('file'), async (req, res) => {
  const row = loadEvidence(req, req.params.id);
  const stored = row.file_storage_name ? path.join(config.uploadDir, row.file_storage_name) : null;
  let computed;
  let basis;

  if (req.file) {
    computed = await hashFile(req.file.path);
    basis = 'Supplied file';
    await removeFile(req.file.path);
  } else if (stored && fs.existsSync(stored)) {
    computed = await hashFile(stored);
    basis = 'Stored file';
  } else if (stored) {
    computed = { sha256: null, md5: null };
    basis = 'Stored file missing';
  } else {
    throw new HttpError(409, 'No file is stored for this item. Select the original file to compare against its hash.');
  }

  const checks = [];
  if (row.sha256) checks.push(row.sha256 === computed.sha256);
  if (row.md5) checks.push(row.md5 === computed.md5);
  const result = checks.every(Boolean) ? 'Match' : 'Mismatch';
  const now = nowIso();
  tx(() => {
    run('UPDATE evidence SET last_verified_at = ?, last_verify_result = ? WHERE id = ?', now, result, row.id);
    logEvidenceAccess(req, row.id, 'Verify', `${basis}: ${result}`);
    audit(req, result === 'Match' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_INTEGRITY_FAILURE', 'evidence', row.evidence_number, `${basis}: ${result}`);
  });
  res.json({ result, basis, verified_at: now, registered: { sha256: row.sha256, md5: row.md5 }, computed });
});

router.get('/:id/recipients', requirePermission('custody.transfer'), (req, res) => {
  const row = loadEvidence(req, req.params.id);
  const users = all("SELECT id, full_name, role, is_active FROM users WHERE is_active = 1 AND role <> 'Auditor' ORDER BY full_name");
  res.json(users.filter((u) => canHold(row, u)).map(({ id: userId, full_name, role }) => ({ id: userId, full_name, role })));
});

router.post('/:id/transfer', requirePermission('custody.transfer'), (req, res) => {
  const row = loadEvidence(req, req.params.id);
  if (FINAL_STATUSES.includes(row.status)) throw new HttpError(409, `Evidence is ${row.status} and can no longer be transferred`);
  if (req.user.role === INVESTIGATOR && row.current_custodian_id !== req.user.id) {
    throw new HttpError(403, 'Only the current custodian can transfer this evidence');
  }
  const body = req.body ?? {};
  const toUser = get('SELECT * FROM users WHERE id = ?', id(body.to_user_id, 'recipient'));
  if (!toUser || !canHold(row, toUser)) {
    throw new HttpError(400, 'Recipient must be an active case manager, admin, or investigator assigned to this case, and not the current custodian');
  }
  const purpose = text(body, 'purpose', { max: 500, label: 'Purpose' });
  const location = text(body, 'location', { max: 200, label: 'Location' });
  const notes = text(body, 'notes', { required: false });
  const status = oneOf(body.status || row.status, EVIDENCE_STATUSES, 'Status');
  const occurredAt = pastTimestamp(body.occurred_at || nowIso(), 'Transfer time');

  const last = get('SELECT MAX(occurred_at) AS at FROM custody_events WHERE evidence_id = ?', row.id);
  if (occurredAt < last.at) throw new HttpError(400, 'Transfer time cannot be earlier than the previous custody event');

  tx(() => {
    run(
      `INSERT INTO custody_events (evidence_id, action, from_user_id, to_user_id, location, purpose, notes, status_after, occurred_at, recorded_by, recorded_at)
       VALUES (?, 'Transfer', ?,?,?,?,?,?,?,?,?)`,
      row.id, row.current_custodian_id, toUser.id, location, purpose, notes, status, occurredAt, req.user.id, nowIso(),
    );
    run('UPDATE evidence SET current_custodian_id = ?, status = ?, storage_location = ? WHERE id = ?', toUser.id, status, location, row.id);
    logEvidenceAccess(req, row.id, 'Transfer', `To ${toUser.full_name}: ${purpose}`);
    audit(req, 'CUSTODY_TRANSFERRED', 'evidence', row.evidence_number, `${row.custodian} -> ${toUser.full_name}; ${purpose}`);
  });
  res.status(201).json({ custody: custodyFor(row.id) });
});

export function custodyFor(evidenceId) {
  return all(
    `SELECT ce.*, fu.full_name AS from_name, tu.full_name AS to_name, ru.full_name AS recorded_by_name
     FROM custody_events ce
     LEFT JOIN users fu ON fu.id = ce.from_user_id
     JOIN users tu ON tu.id = ce.to_user_id
     JOIN users ru ON ru.id = ce.recorded_by
     WHERE ce.evidence_id = ? ORDER BY ce.occurred_at, ce.id`, evidenceId,
  );
}

export default router;
