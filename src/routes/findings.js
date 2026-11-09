import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { all, get, run, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { hashFile, HttpError, id, nowIso, oneOf, text } from '../lib/util.js';
import { loadCase, requirePermission } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();
const SEVERITIES = ['Info', 'Low', 'Medium', 'High', 'Critical'];

const FINDING_SELECT = `
  SELECT f.id, f.case_id, f.evidence_id, f.title, f.details, f.severity, f.status, f.author_id, f.created_at,
    f.updated_at, f.finalized_at, f.attachment_filename, f.attachment_sha256,
    u.full_name AS author, e.evidence_number
  FROM findings f JOIN users u ON u.id = f.author_id LEFT JOIN evidence e ON e.id = f.evidence_id`;

function loadFinding(req, rawId) {
  const row = get('SELECT * FROM findings WHERE id = ?', id(rawId, 'finding id'));
  if (!row) throw new HttpError(404, 'Finding not found');
  return { finding: row, caseRow: loadCase(req, row.case_id) };
}

function evidenceInCase(raw, caseId) {
  if (!raw) return null;
  const evidenceId = id(raw, 'evidence id');
  if (!get('SELECT 1 AS ok FROM evidence WHERE id = ? AND case_id = ?', evidenceId, caseId)) {
    throw new HttpError(400, 'Linked evidence does not belong to this case');
  }
  return evidenceId;
}

function assertEditable(req, finding) {
  if (finding.status === 'Final') throw new HttpError(409, 'Finalized findings cannot be changed');
  if (finding.author_id !== req.user.id && req.user.role !== 'Admin') {
    throw new HttpError(403, 'Only the author can edit this draft');
  }
}

router.get('/', (req, res) => {
  const caseRow = loadCase(req, req.query.case_id);
  res.json(all(`${FINDING_SELECT} WHERE f.case_id = ? ORDER BY f.created_at DESC, f.id DESC`, caseRow.id));
});

router.post('/', requirePermission('finding.write'), upload.single('attachment'), async (req, res) => {
  const body = req.body ?? {};
  const caseRow = loadCase(req, body.case_id);
  if (caseRow.status === 'Closed') throw new HttpError(409, 'Findings cannot be added to a closed case');
  const title = text(body, 'title', { max: 200, label: 'Title' });
  const details = text(body, 'details', { max: 20000, label: 'Details' });
  const severity = oneOf(body.severity || 'Medium', SEVERITIES, 'Severity');
  const evidenceId = evidenceInCase(body.evidence_id, caseRow.id);
  const hashes = req.file ? await hashFile(req.file.path) : null;
  const filename = req.file ? path.basename(Buffer.from(req.file.originalname, 'latin1').toString('utf8')) : null;
  const now = nowIso();

  const created = tx(() => {
    const result = run(
      `INSERT INTO findings (case_id, evidence_id, title, details, severity, author_id, created_at, updated_at,
         attachment_storage_name, attachment_filename, attachment_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      caseRow.id, evidenceId, title, details, severity, req.user.id, now, now,
      req.file?.filename ?? null, filename, hashes?.sha256 ?? null,
    );
    const findingId = Number(result.lastInsertRowid);
    audit(req, 'FINDING_CREATED', 'finding', findingId, `${caseRow.case_number}: ${title}`);
    return get(`${FINDING_SELECT} WHERE f.id = ?`, findingId);
  });
  req.keepUpload = true;
  res.status(201).json(created);
});

router.patch('/:id', requirePermission('finding.write'), (req, res) => {
  const { finding, caseRow } = loadFinding(req, req.params.id);
  assertEditable(req, finding);
  const body = req.body ?? {};
  const title = text(body, 'title', { max: 200, label: 'Title' });
  const details = text(body, 'details', { max: 20000, label: 'Details' });
  const severity = oneOf(body.severity, SEVERITIES, 'Severity');
  const evidenceId = evidenceInCase(body.evidence_id, caseRow.id);
  tx(() => {
    run('UPDATE findings SET title = ?, details = ?, severity = ?, evidence_id = ?, updated_at = ? WHERE id = ?',
      title, details, severity, evidenceId, nowIso(), finding.id);
    audit(req, 'FINDING_UPDATED', 'finding', finding.id, `${caseRow.case_number}: ${title}`);
  });
  res.json(get(`${FINDING_SELECT} WHERE f.id = ?`, finding.id));
});

router.post('/:id/finalize', requirePermission('finding.finalize'), (req, res) => {
  const { finding, caseRow } = loadFinding(req, req.params.id);
  if (finding.status === 'Final') throw new HttpError(409, 'Finding is already final');
  const now = nowIso();
  tx(() => {
    run("UPDATE findings SET status = 'Final', finalized_at = ?, updated_at = ? WHERE id = ?", now, now, finding.id);
    audit(req, 'FINDING_FINALIZED', 'finding', finding.id, `${caseRow.case_number}: ${finding.title}`);
  });
  res.json(get(`${FINDING_SELECT} WHERE f.id = ?`, finding.id));
});

router.get('/:id/attachment', requirePermission('evidence.download'), (req, res) => {
  const { finding } = loadFinding(req, req.params.id);
  if (!finding.attachment_storage_name) throw new HttpError(404, 'This finding has no attachment');
  const filePath = path.join(config.uploadDir, finding.attachment_storage_name);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'The attachment file is missing');
  audit(req, 'FINDING_ATTACHMENT_DOWNLOADED', 'finding', finding.id, finding.attachment_filename);
  res.download(filePath, finding.attachment_filename);
});

// --- Case summaries: versioned snapshots built from the case record. ---

function buildSummary(caseRow) {
  const team = all(
    `SELECT u.full_name, a.role_on_case FROM case_assignments a JOIN users u ON u.id = a.user_id
     WHERE a.case_id = ? ORDER BY a.role_on_case, u.full_name`, caseRow.id,
  );
  const evidence = all(
    `SELECT e.*, u.full_name AS custodian,
       (SELECT COUNT(*) FROM custody_events ce WHERE ce.evidence_id = e.id AND ce.action = 'Transfer') AS transfers
     FROM evidence e JOIN users u ON u.id = e.current_custodian_id WHERE e.case_id = ? ORDER BY e.id`, caseRow.id,
  );
  const findings = all(
    `SELECT f.*, u.full_name AS author, e.evidence_number FROM findings f JOIN users u ON u.id = f.author_id
     LEFT JOIN evidence e ON e.id = f.evidence_id WHERE f.case_id = ?
     ORDER BY CASE f.severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END, f.id`,
    caseRow.id,
  );
  const final = findings.filter((f) => f.status === 'Final');
  const drafts = findings.length - final.length;
  const mismatches = evidence.filter((e) => e.last_verify_result === 'Mismatch').length;
  const unverified = evidence.filter((e) => !e.last_verified_at).length;

  const lines = [
    `CASE SUMMARY: ${caseRow.case_number}`,
    caseRow.title,
    '',
    `Type: ${caseRow.case_type}`,
    `Priority: ${caseRow.priority}`,
    `Status: ${caseRow.status}`,
    `Opened: ${caseRow.opened_at.slice(0, 10)}${caseRow.closed_at ? `   Closed: ${caseRow.closed_at.slice(0, 10)}` : ''}`,
    `Team: ${team.map((t) => `${t.full_name} (${t.role_on_case})`).join(', ') || 'None assigned'}`,
    '',
    'BACKGROUND',
    caseRow.description || 'No description recorded.',
    '',
    `EVIDENCE (${evidence.length} items, ${unverified} never verified, ${mismatches} failed verification)`,
    ...evidence.map((e) =>
      `- ${e.evidence_number} ${e.item_name} [${e.evidence_type}], ${e.status}, held by ${e.custodian}, ${e.transfers} transfer(s)\n  Source: ${e.source}\n  ${e.sha256 ? `SHA-256: ${e.sha256}` : `MD5: ${e.md5}`}`),
    '',
    `FINALIZED FINDINGS (${final.length})`,
    ...(final.length ? final.map((f, i) =>
      `${i + 1}. [${f.severity}] ${f.title}${f.evidence_number ? ` (${f.evidence_number})` : ''}\n   ${f.details}\n   Author: ${f.author}, finalized ${f.finalized_at.slice(0, 10)}`)
      : ['No findings have been finalized.']),
  ];
  if (drafts) lines.push('', `NOTE: ${drafts} draft finding(s) are excluded from this summary.`);
  if (mismatches) lines.push('', `WARNING: ${mismatches} evidence item(s) failed integrity verification.`);
  return lines.join('\n');
}

router.get('/summaries', (req, res) => {
  const caseRow = loadCase(req, req.query.case_id);
  res.json(all(
    `SELECT s.*, u.full_name AS generated_by_name FROM case_summaries s JOIN users u ON u.id = s.generated_by
     WHERE s.case_id = ? ORDER BY s.version DESC`, caseRow.id,
  ));
});

router.post('/summaries', requirePermission('summary.generate'), (req, res) => {
  const caseRow = loadCase(req, req.body?.case_id);
  const created = tx(() => {
    const { v } = get('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM case_summaries WHERE case_id = ?', caseRow.id);
    const result = run(
      'INSERT INTO case_summaries (case_id, version, content, generated_by, generated_at) VALUES (?,?,?,?,?)',
      caseRow.id, v, buildSummary(caseRow), req.user.id, nowIso(),
    );
    audit(req, 'SUMMARY_GENERATED', 'case', caseRow.case_number, `Version ${v}`);
    return get(
      `SELECT s.*, u.full_name AS generated_by_name FROM case_summaries s JOIN users u ON u.id = s.generated_by WHERE s.id = ?`,
      Number(result.lastInsertRowid),
    );
  });
  res.status(201).json(created);
});

export default router;
