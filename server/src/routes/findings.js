import fs from 'node:fs';
import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { hashFile, HttpError, objectId, oneOf, text } from '../lib/util.js';
import { loadCase, requirePermission } from '../middleware/auth.js';
import { decodeFilename, storedPath, upload } from '../middleware/upload.js';
import { CaseSummary, CustodyEvent, Evidence, Finding, SEVERITIES } from '../models/index.js';

const router = Router();

const withRefs = (query) => query.populate('author', 'fullName').populate('evidence', 'evidenceNumber');

async function loadFinding(req, rawId) {
  const finding = await Finding.findById(objectId(rawId, 'finding id'));
  if (!finding) throw new HttpError(404, 'Finding not found');
  return { finding, caseDoc: await loadCase(req, String(finding.case)) };
}

async function evidenceInCase(raw, caseId) {
  if (!raw) return null;
  const evidenceId = objectId(String(raw), 'evidence id');
  if (!(await Evidence.exists({ _id: evidenceId, case: caseId }))) {
    throw new HttpError(400, 'Linked evidence does not belong to this case');
  }
  return evidenceId;
}

function assertEditable(req, finding) {
  if (finding.status === 'Final') throw new HttpError(409, 'Finalized findings cannot be changed');
  if (String(finding.author) !== String(req.user._id) && req.user.role !== 'Admin') {
    throw new HttpError(403, 'Only the author can edit this draft');
  }
}

router.get('/', async (req, res) => {
  const caseDoc = await loadCase(req, req.query.caseId);
  res.json(await withRefs(Finding.find({ case: caseDoc._id }).sort({ createdAt: -1, _id: -1 })));
});

router.post('/', requirePermission('finding.write'), upload.single('attachment'), async (req, res) => {
  const body = req.body ?? {};
  const caseDoc = await loadCase(req, body.caseId);
  if (caseDoc.status === 'Closed') throw new HttpError(409, 'Findings cannot be added to a closed case');
  const doc = new Finding({
    case: caseDoc._id,
    evidence: await evidenceInCase(body.evidenceId, caseDoc._id),
    title: text(body, 'title', { max: 200, label: 'Title' }),
    details: text(body, 'details', { max: 20000, label: 'Details' }),
    severity: oneOf(body.severity || 'Medium', SEVERITIES, 'Severity'),
    author: req.user._id,
  });
  if (req.file) {
    const { sha256 } = await hashFile(req.file.path);
    doc.attachment = { storageName: req.file.filename, originalName: decodeFilename(req.file.originalname), sha256 };
  }
  await doc.save();
  req.keepUpload = true;
  await audit(req, 'FINDING_CREATED', 'finding', String(doc._id), `${caseDoc.caseNumber}: ${doc.title}`);
  res.status(201).json(await withRefs(Finding.findById(doc._id)));
});

router.patch('/:id', requirePermission('finding.write'), async (req, res) => {
  const { finding, caseDoc } = await loadFinding(req, req.params.id);
  assertEditable(req, finding);
  const body = req.body ?? {};
  finding.title = text(body, 'title', { max: 200, label: 'Title' });
  finding.details = text(body, 'details', { max: 20000, label: 'Details' });
  finding.severity = oneOf(body.severity, SEVERITIES, 'Severity');
  finding.evidence = await evidenceInCase(body.evidenceId, caseDoc._id);
  await finding.save();
  await audit(req, 'FINDING_UPDATED', 'finding', String(finding._id), `${caseDoc.caseNumber}: ${finding.title}`);
  res.json(await withRefs(Finding.findById(finding._id)));
});

router.post('/:id/finalize', requirePermission('finding.finalize'), async (req, res) => {
  const { finding, caseDoc } = await loadFinding(req, req.params.id);
  if (finding.status === 'Final') throw new HttpError(409, 'Finding is already final');
  finding.status = 'Final';
  finding.finalizedAt = new Date();
  await finding.save();
  await audit(req, 'FINDING_FINALIZED', 'finding', String(finding._id), `${caseDoc.caseNumber}: ${finding.title}`);
  res.json(await withRefs(Finding.findById(finding._id)));
});

router.get('/:id/attachment', requirePermission('evidence.download'), async (req, res) => {
  const { finding } = await loadFinding(req, req.params.id);
  if (!finding.attachment?.storageName) throw new HttpError(404, 'This finding has no attachment');
  const filePath = storedPath(finding.attachment.storageName);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'The attachment file is missing');
  await audit(req, 'FINDING_ATTACHMENT_DOWNLOADED', 'finding', String(finding._id), finding.attachment.originalName);
  res.download(filePath, finding.attachment.originalName);
});

// --- Case summaries: versioned plain-text snapshots built from the case record. ---

const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
const day = (date) => new Date(date).toISOString().slice(0, 10);

async function buildSummary(caseDoc) {
  await caseDoc.populate('assignments.user', 'fullName');
  const evidence = await Evidence.find({ case: caseDoc._id }).sort({ _id: 1 }).populate('currentCustodian', 'fullName');
  const transfers = new Map((await CustodyEvent.aggregate([
    { $match: { evidence: { $in: evidence.map((e) => e._id) }, action: 'Transfer' } },
    { $group: { _id: '$evidence', n: { $sum: 1 } } },
  ])).map((r) => [String(r._id), r.n]));
  const findings = (await withRefs(Finding.find({ case: caseDoc._id })))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.createdAt - b.createdAt);

  const final = findings.filter((f) => f.status === 'Final');
  const drafts = findings.length - final.length;
  const mismatches = evidence.filter((e) => e.lastVerifyResult === 'Mismatch').length;
  const unverified = evidence.filter((e) => !e.lastVerifiedAt).length;
  const leadFirst = (a) => (a.roleOnCase === 'Lead' ? 0 : 1);
  const team = [...caseDoc.assignments].sort((a, b) => leadFirst(a) - leadFirst(b))
    .map((a) => `${a.user?.fullName} (${a.roleOnCase})`).join(', ');

  const lines = [
    `CASE SUMMARY: ${caseDoc.caseNumber}`,
    caseDoc.title,
    '',
    `Type: ${caseDoc.caseType}`,
    `Priority: ${caseDoc.priority}`,
    `Status: ${caseDoc.status}`,
    `Opened: ${day(caseDoc.openedAt)}${caseDoc.closedAt ? `   Closed: ${day(caseDoc.closedAt)}` : ''}`,
    `Team: ${team || 'None assigned'}`,
    '',
    'BACKGROUND',
    caseDoc.description || 'No description recorded.',
    '',
    `EVIDENCE (${evidence.length} items, ${unverified} never verified, ${mismatches} failed verification)`,
    ...evidence.map((e) =>
      `- ${e.evidenceNumber} ${e.itemName} [${e.evidenceType}], ${e.status}, held by ${e.currentCustodian?.fullName}, ${transfers.get(String(e._id)) ?? 0} transfer(s)\n  Source: ${e.source}\n  ${e.sha256 ? `SHA-256: ${e.sha256}` : `MD5: ${e.md5}`}`),
    '',
    `FINALIZED FINDINGS (${final.length})`,
    ...(final.length ? final.map((f, i) =>
      `${i + 1}. [${f.severity}] ${f.title}${f.evidence ? ` (${f.evidence.evidenceNumber})` : ''}\n   ${f.details}\n   Author: ${f.author?.fullName}, finalized ${day(f.finalizedAt)}`)
      : ['No findings have been finalized.']),
  ];
  if (drafts) lines.push('', `NOTE: ${drafts} draft finding(s) are excluded from this summary.`);
  if (mismatches) lines.push('', `WARNING: ${mismatches} evidence item(s) failed integrity verification.`);
  return lines.join('\n');
}

router.get('/summaries', async (req, res) => {
  const caseDoc = await loadCase(req, req.query.caseId);
  res.json(await CaseSummary.find({ case: caseDoc._id }).sort({ version: -1 }).populate('generatedBy', 'fullName'));
});

router.post('/summaries', requirePermission('summary.generate'), async (req, res) => {
  const caseDoc = await loadCase(req, req.body?.caseId);
  const content = await buildSummary(caseDoc);
  const latest = await CaseSummary.findOne({ case: caseDoc._id }).sort({ version: -1 }).select('version').lean();
  // The unique (case, version) index rejects a duplicate if two people generate at the same moment.
  const doc = await CaseSummary.create({ case: caseDoc._id, version: (latest?.version ?? 0) + 1, content, generatedBy: req.user._id });
  await audit(req, 'SUMMARY_GENERATED', 'case', caseDoc.caseNumber, `Version ${doc.version}`);
  res.status(201).json(await CaseSummary.findById(doc._id).populate('generatedBy', 'fullName'));
});

export default router;
