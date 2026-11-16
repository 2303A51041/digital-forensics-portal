import fs from 'node:fs';
import { Router } from 'express';
import { audit, logEvidenceAccess } from '../lib/audit.js';
import { contains, hashFile, hashValue, HttpError, objectId, oneOf, pastTimestamp, removeFile, text } from '../lib/util.js';
import { isAssigned, loadCase, requirePermission, scopeByCase } from '../middleware/auth.js';
import { decodeFilename, storedPath, upload } from '../middleware/upload.js';
import {
  AccessLog, CustodyEvent, Evidence, EVIDENCE_STATUSES, FINAL_EVIDENCE_STATUSES, nextNumber, User,
} from '../models/index.js';
import { can, INVESTIGATOR } from '../permissions.js';

const router = Router();

const CASE_FIELDS = 'caseNumber title status assignments';
const withRefs = (query) => query
  .populate('case', CASE_FIELDS)
  .populate('currentCustodian', 'fullName role')
  .populate('registeredBy', 'fullName');

/** Strips the assignment list from the populated case before sending evidence to the client. */
function evidenceOut(doc) {
  const out = doc.toJSON();
  if (out.case && typeof out.case === 'object') delete out.case.assignments;
  return out;
}

async function loadEvidence(req, rawId) {
  const doc = await withRefs(Evidence.findById(objectId(rawId, 'evidence id')));
  if (!doc || (!can(req.user, 'case.viewAll') && !isAssigned(doc.case, req.user._id))) {
    throw new HttpError(404, 'Evidence not found');
  }
  return doc;
}

/** Who may hold an item: active admins and case managers, or investigators assigned to its case. */
const canHold = (evidence, user) =>
  user.isActive && String(user._id) !== String(evidence.currentCustodian._id) && (
    user.role === 'Admin' || user.role === 'Case Manager' ||
    (user.role === INVESTIGATOR && isAssigned(evidence.case, user._id))
  );

export function custodyFor(evidenceId) {
  return CustodyEvent.find({ evidence: evidenceId })
    .sort({ occurredAt: 1, _id: 1 })
    .populate('fromUser', 'fullName')
    .populate('toUser', 'fullName')
    .populate('recordedBy', 'fullName');
}

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.caseId) filter.case = objectId(String(req.query.caseId), 'case id');
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) {
    const like = contains(req.query.q);
    filter.$or = [{ itemName: like }, { evidenceNumber: like }, { sha256: like }, { md5: like }];
  }
  const docs = await withRefs(Evidence.find(await scopeByCase(req.user, filter)).sort({ _id: -1 }));
  res.json(docs.map(evidenceOut));
});

router.post('/', requirePermission('evidence.register'), upload.single('file'), async (req, res) => {
  const body = req.body ?? {};
  const caseDoc = await loadCase(req, body.caseId);
  if (caseDoc.status === 'Closed') throw new HttpError(409, 'Evidence cannot be added to a closed case');

  const fields = {
    itemName: text(body, 'itemName', { max: 200, label: 'Item name' }),
    evidenceType: text(body, 'evidenceType', { max: 100, label: 'Evidence type' }),
    source: text(body, 'source', { max: 500, label: 'Source' }),
    description: text(body, 'description', { required: false }),
    storageLocation: text(body, 'storageLocation', { required: false, max: 200 }),
    collectedAt: pastTimestamp(body.collectedAt, 'Collection time'),
  };
  let sha256 = hashValue(body.sha256, 'sha256');
  let md5 = hashValue(body.md5, 'md5');
  let hashOrigin = 'Declared';

  if (req.file) {
    // The server always hashes the upload itself. A hash sent by the browser must agree with it.
    const computed = await hashFile(req.file.path);
    if ((sha256 && sha256 !== computed.sha256) || (md5 && md5 !== computed.md5)) {
      await audit(req, 'EVIDENCE_HASH_REJECTED', 'case', caseDoc.caseNumber, `Declared hash did not match upload ${fields.itemName}`);
      throw new HttpError(422, 'The declared hash does not match the uploaded file. Nothing was registered.');
    }
    ({ sha256, md5 } = computed);
    hashOrigin = 'Computed';
  } else if (!sha256 && !md5) {
    throw new HttpError(400, 'Upload a file or enter a SHA-256 or MD5 hash');
  }

  const doc = new Evidence({
    ...fields,
    case: caseDoc._id,
    registeredBy: req.user._id,
    currentCustodian: req.user._id,
    sha256,
    md5,
    hashOrigin,
    file: req.file
      ? { storageName: req.file.filename, originalName: decodeFilename(req.file.originalname), mimeType: req.file.mimetype, size: req.file.size }
      : undefined,
  });
  doc.evidenceNumber = await nextNumber('EV');
  await doc.save();
  req.keepUpload = true;

  await CustodyEvent.create({
    evidence: doc._id, action: 'Registered', fromUser: null, toUser: req.user._id, location: fields.storageLocation,
    purpose: 'Initial registration', statusAfter: 'In Storage', occurredAt: doc.registeredAt, recordedBy: req.user._id,
  });
  await logEvidenceAccess(req, doc._id, 'Register', hashOrigin === 'Computed' ? 'File uploaded and hashed' : 'Metadata only');
  await audit(req, 'EVIDENCE_REGISTERED', 'evidence', doc.evidenceNumber, `${fields.itemName} (${caseDoc.caseNumber})`);
  res.status(201).json(evidenceOut(await withRefs(Evidence.findById(doc._id))));
});

router.get('/:id', async (req, res) => {
  const doc = await loadEvidence(req, req.params.id);
  await logEvidenceAccess(req, doc._id, 'View');
  const [custody, accessLog] = await Promise.all([
    custodyFor(doc._id),
    can(req.user, 'audit.view')
      ? AccessLog.find({ evidence: doc._id }).sort({ _id: -1 }).limit(50).populate('user', 'fullName')
      : null,
  ]);
  res.json({ ...evidenceOut(doc), custody, accessLog: accessLog ?? undefined });
});

router.get('/:id/download', requirePermission('evidence.download'), async (req, res) => {
  const doc = await loadEvidence(req, req.params.id);
  if (!doc.file?.storageName) throw new HttpError(404, 'No file is stored for this evidence item');
  const filePath = storedPath(doc.file.storageName);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'The stored file is missing from evidence storage');
  await logEvidenceAccess(req, doc._id, 'Download', doc.file.originalName);
  await audit(req, 'EVIDENCE_DOWNLOADED', 'evidence', doc.evidenceNumber, doc.file.originalName);
  res.download(filePath, doc.file.originalName);
});

// Checks the stored file, or a re-acquired file sent by the client, against the registered hashes.
router.post('/:id/verify', requirePermission('evidence.verify'), upload.single('file'), async (req, res) => {
  const doc = await loadEvidence(req, req.params.id);
  const stored = doc.file?.storageName ? storedPath(doc.file.storageName) : null;
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
  if (doc.sha256) checks.push(doc.sha256 === computed.sha256);
  if (doc.md5) checks.push(doc.md5 === computed.md5);
  const result = checks.every(Boolean) ? 'Match' : 'Mismatch';
  doc.lastVerifiedAt = new Date();
  doc.lastVerifyResult = result;
  await doc.save();
  await logEvidenceAccess(req, doc._id, 'Verify', `${basis}: ${result}`);
  await audit(req, result === 'Match' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_INTEGRITY_FAILURE', 'evidence', doc.evidenceNumber, `${basis}: ${result}`);
  res.json({ result, basis, verifiedAt: doc.lastVerifiedAt, registered: { sha256: doc.sha256, md5: doc.md5 }, computed });
});

router.get('/:id/recipients', requirePermission('custody.transfer'), async (req, res) => {
  const doc = await loadEvidence(req, req.params.id);
  const users = await User.find({ isActive: true, role: { $ne: 'Auditor' } }).sort({ fullName: 1 });
  res.json(users.filter((u) => canHold(doc, u)).map((u) => ({ id: String(u._id), fullName: u.fullName, role: u.role })));
});

router.post('/:id/transfer', requirePermission('custody.transfer'), async (req, res) => {
  const doc = await loadEvidence(req, req.params.id);
  if (FINAL_EVIDENCE_STATUSES.includes(doc.status)) throw new HttpError(409, `Evidence is ${doc.status} and can no longer be transferred`);
  if (req.user.role === INVESTIGATOR && String(doc.currentCustodian._id) !== String(req.user._id)) {
    throw new HttpError(403, 'Only the current custodian can transfer this evidence');
  }
  const body = req.body ?? {};
  const toUser = await User.findById(objectId(body.toUserId, 'recipient'));
  if (!toUser || !canHold(doc, toUser)) {
    throw new HttpError(400, 'Recipient must be an active case manager, admin, or investigator assigned to this case, and not the current custodian');
  }
  const purpose = text(body, 'purpose', { max: 500, label: 'Purpose' });
  const location = text(body, 'location', { max: 200, label: 'Location' });
  const notes = text(body, 'notes', { required: false });
  const status = oneOf(body.status || doc.status, EVIDENCE_STATUSES, 'Status');
  const occurredAt = pastTimestamp(body.occurredAt || new Date().toISOString(), 'Transfer time');

  const last = await CustodyEvent.findOne({ evidence: doc._id }).sort({ occurredAt: -1 }).select('occurredAt').lean();
  if (last && occurredAt < last.occurredAt) throw new HttpError(400, 'Transfer time cannot be earlier than the previous custody event');

  const fromName = doc.currentCustodian.fullName;
  await CustodyEvent.create({
    evidence: doc._id, action: 'Transfer', fromUser: doc.currentCustodian._id, toUser: toUser._id, location, purpose, notes,
    statusAfter: status, occurredAt, recordedBy: req.user._id,
  });
  doc.currentCustodian = toUser._id;
  doc.status = status;
  doc.storageLocation = location;
  await doc.save();
  await logEvidenceAccess(req, doc._id, 'Transfer', `To ${toUser.fullName}: ${purpose}`);
  await audit(req, 'CUSTODY_TRANSFERRED', 'evidence', doc.evidenceNumber, `${fromName} -> ${toUser.fullName}; ${purpose}`);
  res.status(201).json({ custody: await custodyFor(doc._id) });
});

export default router;
