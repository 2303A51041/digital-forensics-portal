import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Tests run against their own database and upload folder, never the real ones.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forensics-test-'));
process.env.DATA_DIR = dataDir;
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/forensics_test';
process.env.SEED_DEMO = 'true';

const mongoose = (await import('mongoose')).default;
const { createApp } = await import('../src/app.js');
const { connectDb, disconnectDb } = await import('../src/db.js');
const { DEMO_PASSWORD, seedIfEmpty } = await import('../src/seed.js');
const { config } = await import('../src/config.js');
const { AuditLog, Case, CustodyEvent, Evidence, Finding } = await import('../src/models/index.js');

let server, base, year;
const tokens = {};
const ids = {};

async function api(user, method, url, body) {
  const headers = user ? { Authorization: `Bearer ${tokens[user]}` } : {};
  const options = { method, headers };
  if (body instanceof FormData) options.body = body;
  else if (body) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const res = await fetch(base + url, options);
  const type = res.headers.get('content-type') || '';
  let data;
  if (type.includes('json')) data = await res.json();
  else if (type.includes('pdf')) data = Buffer.from(await res.arrayBuffer());
  else data = await res.text();
  return { status: res.status, body: data, headers: res.headers };
}

function evidenceForm(fields, content) {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    caseId: ids.case1, itemName: 'USB stick', evidenceType: 'Removable Media', source: 'Desk drawer',
    collectedAt: new Date(Date.now() - 3600000).toISOString(), ...fields,
  })) form.set(k, v);
  if (content !== undefined) form.set('file', new Blob([content]), 'image.bin');
  return form;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const uploadCount = () => fs.readdirSync(config.uploadDir).length;

before(async () => {
  await connectDb();
  await mongoose.connection.dropDatabase();
  await mongoose.connection.syncIndexes();
  await seedIfEmpty();
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  year = new Date().getUTCFullYear();
  for (const u of ['admin', 'manager', 'investigator1', 'investigator2', 'investigator3', 'auditor']) {
    const res = await api(null, 'POST', '/api/auth/login', { username: u, password: DEMO_PASSWORD });
    assert.equal(res.status, 200, `login ${u}`);
    tokens[u] = res.body.token;
    ids[u] = res.body.user.id;
  }
  for (let n = 1; n <= 5; n += 1) {
    ids[`case${n}`] = String((await Case.findOne({ caseNumber: `DF-${year}-000${n}` }))._id);
  }
  for (let n = 1; n <= 8; n += 1) {
    ids[`ev${n}`] = String((await Evidence.findOne({ evidenceNumber: `EV-${year}-000${n}` }))._id);
  }
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await disconnectDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('rejects bad credentials and missing tokens', async () => {
  assert.equal((await api(null, 'POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await api(null, 'GET', '/api/cases')).status, 401);
  const forged = await fetch(`${base}/api/cases`, { headers: { Authorization: 'Bearer not.a.token' } });
  assert.equal(forged.status, 401);
});

test('role restrictions are enforced on the server', async () => {
  assert.equal((await api('auditor', 'POST', '/api/cases', { title: 'x', caseType: 'Other' })).status, 403);
  assert.equal((await api('investigator1', 'GET', '/api/users')).status, 403);
  assert.equal((await api('manager', 'GET', '/api/audit/logs')).status, 403);
  assert.equal((await api('investigator1', 'GET', '/api/reports/case-status')).status, 403);
  assert.equal((await api('auditor', 'GET', '/api/reports/case-status')).status, 200);
  const denied = await AuditLog.findOne({ action: 'ACCESS_DENIED' });
  assert.ok(denied, 'denied requests are audited');
});

test('investigators only see assigned cases', async () => {
  const res = await api('investigator3', 'GET', '/api/cases');
  assert.deepEqual(res.body.map((c) => c.caseNumber).sort(), [`DF-${year}-0002`, `DF-${year}-0003`]);
  assert.equal((await api('investigator3', 'GET', `/api/cases/${ids.case1}`)).status, 404);
  assert.equal((await api('investigator3', 'GET', `/api/evidence/${ids.ev1}`)).status, 404);
  const evidence = await api('investigator3', 'GET', '/api/evidence');
  assert.ok(evidence.body.every((e) => [`DF-${year}-0002`, `DF-${year}-0003`].includes(e.case.caseNumber)));
});

test('case creation and assignment', async () => {
  const created = await api('manager', 'POST', '/api/cases', { title: 'Test case', caseType: 'Fraud', priority: 'High', dueDate: '2030-01-31' });
  assert.equal(created.status, 201);
  assert.match(created.body.caseNumber, new RegExp(`^DF-${year}-0006$`));
  ids.newCase = created.body.id;

  assert.equal((await api('manager', 'PUT', `/api/cases/${ids.newCase}/assignments`, { userId: ids.auditor })).status, 400);
  assert.equal((await api('manager', 'PUT', `/api/cases/${ids.newCase}/assignments`, { userId: ids.investigator1, roleOnCase: 'Lead' })).status, 204);
  assert.equal((await api('manager', 'PUT', `/api/cases/${ids.newCase}/assignments`, { userId: ids.investigator2, roleOnCase: 'Lead' })).status, 204);
  const detail = await api('investigator1', 'GET', `/api/cases/${ids.newCase}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.leadInvestigator.fullName, 'Marcus Lindholm', 'a new lead replaces the old one');
  assert.equal(detail.body.assignments.filter((a) => a.roleOnCase === 'Lead').length, 1);

  assert.equal((await api('manager', 'POST', '/api/cases', { caseType: 'Fraud' })).status, 400);
  assert.equal((await api('manager', 'POST', '/api/cases', { title: 'x', caseType: 'Fraud', dueDate: '31/01/2030' })).status, 400);
});

test('uploaded evidence gets server-computed hashes and a custody record', async () => {
  const content = 'disk image bytes';
  const res = await api('investigator1', 'POST', '/api/evidence', evidenceForm({}, content));
  assert.equal(res.status, 201);
  assert.equal(res.body.sha256, sha256(content));
  assert.equal(res.body.md5, md5(content));
  assert.equal(res.body.hashOrigin, 'Computed');
  assert.equal(res.body.hasFile, true);
  assert.equal(res.body.file.storageName, undefined, 'internal storage name is not exposed');
  ids.uploaded = res.body.id;
  const custody = await CustodyEvent.find({ evidence: ids.uploaded });
  assert.equal(custody.length, 1);
  assert.equal(custody[0].action, 'Registered');
});

test('browser-computed SHA-256 is accepted when it matches the upload', async () => {
  const content = 'hashed in the browser';
  const res = await api('investigator1', 'POST', '/api/evidence', evidenceForm({ sha256: sha256(content) }, content));
  assert.equal(res.status, 201);
  assert.equal(res.body.sha256, sha256(content));
});

test('wrong declared hash is rejected and its upload removed', async () => {
  const before = uploadCount();
  const res = await api('investigator1', 'POST', '/api/evidence', evidenceForm({ sha256: sha256('something else') }, 'real bytes'));
  assert.equal(res.status, 422);
  assert.equal(uploadCount(), before);
});

test('metadata-only evidence needs a valid hash', async () => {
  assert.equal((await api('investigator1', 'POST', '/api/evidence', evidenceForm({}))).status, 400);
  assert.equal((await api('investigator1', 'POST', '/api/evidence', evidenceForm({ md5: 'xyz' }))).status, 400);
  const ok = await api('investigator1', 'POST', '/api/evidence', evidenceForm({ md5: md5('declared') }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.hashOrigin, 'Declared');
  const future = await api('investigator1', 'POST', '/api/evidence', evidenceForm({ md5: md5('x'), collectedAt: '2999-01-01T00:00:00Z' }));
  assert.equal(future.status, 400);
});

test('tampering with a stored file is detected', async () => {
  assert.equal((await api('auditor', 'POST', `/api/evidence/${ids.uploaded}/verify`)).body.result, 'Match');
  const doc = await Evidence.findById(ids.uploaded);
  fs.appendFileSync(path.join(config.uploadDir, doc.file.storageName), 'tampered');
  const res = await api('auditor', 'POST', `/api/evidence/${ids.uploaded}/verify`);
  assert.equal(res.body.result, 'Mismatch');
  assert.ok(await AuditLog.findOne({ action: 'EVIDENCE_INTEGRITY_FAILURE' }));
});

test('custody transfer rules', async () => {
  const body = { toUserId: ids.investigator2, purpose: 'Analysis', location: 'Lab 2', status: 'In Analysis' };
  // investigator2 does not hold the item.
  assert.equal((await api('investigator2', 'POST', `/api/evidence/${ids.uploaded}/transfer`, body)).status, 403);
  // investigator3 is not assigned to case 1, so cannot receive its evidence.
  assert.equal((await api('investigator1', 'POST', `/api/evidence/${ids.uploaded}/transfer`, { ...body, toUserId: ids.investigator3 })).status, 400);
  assert.equal((await api('investigator1', 'POST', `/api/evidence/${ids.uploaded}/transfer`, { ...body, occurredAt: '2001-01-01T00:00:00Z' })).status, 400);
  const ok = await api('investigator1', 'POST', `/api/evidence/${ids.uploaded}/transfer`, body);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.custody.length, 2);
  assert.equal((await Evidence.findById(ids.uploaded)).currentCustodian.toString(), ids.investigator2);

  const archive = await api('manager', 'POST', `/api/evidence/${ids.uploaded}/transfer`, { ...body, toUserId: ids.manager, status: 'Archived' });
  assert.equal(archive.status, 201);
  assert.equal((await api('manager', 'POST', `/api/evidence/${ids.uploaded}/transfer`, { ...body, toUserId: ids.admin })).status, 409);
});

test('the database layer refuses to alter protected records', async () => {
  await assert.rejects(CustodyEvent.updateOne({}, { purpose: 'edited' }), /append-only/);
  await assert.rejects(CustodyEvent.deleteMany({}), /append-only/);
  await assert.rejects(AuditLog.deleteOne({}), /append-only/);
  await assert.rejects(Evidence.updateOne({ _id: ids.ev1 }, { sha256: '0'.repeat(64) }), /through the application/);
  await assert.rejects(Evidence.deleteOne({ _id: ids.ev1 }), /cannot be deleted/);
  await assert.rejects(Case.deleteOne({ _id: ids.case1 }), /cannot be deleted/);

  const event = await CustodyEvent.findOne();
  event.purpose = 'edited';
  await assert.rejects(event.save(), /append-only/);

  // Hash values are immutable: an attempted change is discarded on save.
  const evidence = await Evidence.findById(ids.ev1);
  const original = evidence.sha256;
  evidence.sha256 = '0'.repeat(64);
  await evidence.save();
  assert.equal((await Evidence.findById(ids.ev1)).sha256, original);

  const final = await Finding.findOne({ status: 'Final' });
  final.details = 'rewritten';
  await assert.rejects(final.save(), /immutable/);
});

test('findings lifecycle and versioned summaries', async () => {
  const form = new FormData();
  form.set('caseId', ids.case1);
  form.set('title', 'Persistence via scheduled task');
  form.set('details', 'A scheduled task launches the implant at logon.');
  form.set('severity', 'High');
  form.set('evidenceId', ids.ev2);
  form.set('attachment', new Blob(['tool output']), 'output.txt');
  const created = await api('investigator1', 'POST', '/api/findings', form);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'Draft');
  assert.equal(created.body.attachment.sha256, sha256('tool output'));
  const id = created.body.id;

  const wrongEvidence = new FormData();
  for (const [k, v] of [['caseId', ids.case1], ['title', 't'], ['details', 'd'], ['evidenceId', ids.ev4]]) wrongEvidence.set(k, v);
  assert.equal((await api('investigator1', 'POST', '/api/findings', wrongEvidence)).status, 400);

  const edit = { title: 'Edited', details: 'More detail', severity: 'Critical' };
  assert.equal((await api('investigator2', 'PATCH', `/api/findings/${id}`, edit)).status, 403, 'only the author edits a draft');
  assert.equal((await api('investigator1', 'PATCH', `/api/findings/${id}`, edit)).status, 200);
  assert.equal((await api('investigator1', 'POST', `/api/findings/${id}/finalize`)).status, 200);
  assert.equal((await api('investigator1', 'PATCH', `/api/findings/${id}`, edit)).status, 409);

  const v1 = await api('manager', 'POST', '/api/findings/summaries', { caseId: ids.case1 });
  const v2 = await api('manager', 'POST', '/api/findings/summaries', { caseId: ids.case1 });
  assert.equal(v1.body.version, 1);
  assert.equal(v2.body.version, 2);
  assert.match(v2.body.content, /Edited/);
  assert.doesNotMatch(v2.body.content, /Credential harvesting tool/, 'drafts are excluded');
  assert.match(v2.body.content, /1 draft finding\(s\) are excluded/);
});

test('closed cases refuse new evidence and findings', async () => {
  assert.equal((await api('manager', 'POST', '/api/evidence', evidenceForm({ caseId: ids.case5, md5: md5('x') }))).status, 409);
  const form = new FormData();
  for (const [k, v] of [['caseId', ids.case5], ['title', 't'], ['details', 'd']]) form.set(k, v);
  assert.equal((await api('admin', 'POST', '/api/findings', form)).status, 409);
});

test('all four reports return JSON, CSV and PDF', async () => {
  for (const type of ['case-status', 'evidence-register', 'investigator-workload', 'chain-of-custody']) {
    const json = await api('auditor', 'GET', `/api/reports/${type}`);
    assert.equal(json.status, 200, type);
    assert.ok(json.body.rows.length > 0, `${type} has rows`);

    const csv = await api('auditor', 'GET', `/api/reports/${type}?format=csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.equal(csv.body.trim().split('\r\n').length, json.body.rows.length + 1);

    const pdf = await api('auditor', 'GET', `/api/reports/${type}?format=pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.headers.get('content-disposition'), new RegExp(`${type}-\\d{4}-\\d{2}-\\d{2}\\.pdf`));
  }
  const filtered = await api('manager', 'GET', '/api/reports/case-status?status=Closed');
  assert.deepEqual(filtered.body.rows.map((r) => r.status), ['Closed']);
  assert.equal((await api('manager', 'GET', '/api/reports/case-status?from=2026-13-01')).status, 400);
  assert.equal((await api('manager', 'GET', '/api/reports/unknown')).status, 404);
});

test('CSV cells cannot inject spreadsheet formulas', async () => {
  await api('manager', 'POST', '/api/cases', { title: '=HYPERLINK("http://evil")', caseType: 'Other' });
  const csv = await api('manager', 'GET', '/api/reports/case-status?format=csv');
  assert.match(csv.body, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
});

test('user management guards', async () => {
  assert.equal((await api('admin', 'PATCH', `/api/users/${ids.admin}`, { isActive: false })).status, 409);
  assert.equal((await api('admin', 'PATCH', `/api/users/${ids.investigator1}`, { role: 'Auditor' })).status, 409);
  assert.equal((await api('admin', 'POST', '/api/users', { username: 'admin', fullName: 'X', email: 'x@y.z', role: 'Auditor', password: 'Password1!' })).status, 409);
  assert.equal((await api('admin', 'POST', '/api/users', { username: 'new.user', fullName: 'X', email: 'x@y.z', role: 'Auditor', password: 'short' })).status, 400);

  const created = await api('admin', 'POST', '/api/users', { username: 'temp.auditor', fullName: 'Temp', email: 'temp@forensics.example', role: 'Auditor', password: 'Password1!' });
  assert.equal(created.status, 201);
  assert.equal(created.body.passwordHash, undefined);
  const login = await api(null, 'POST', '/api/auth/login', { username: 'temp.auditor', password: 'Password1!' });
  tokens.temp = login.body.token;
  assert.equal((await api('temp', 'GET', '/api/dashboard')).status, 200);
  assert.equal((await api('admin', 'PATCH', `/api/users/${created.body.id}`, { isActive: false })).status, 200);
  assert.equal((await api('temp', 'GET', '/api/dashboard')).status, 401, 'deactivation applies immediately');
});

test('the audit chain verifies, and detects tampering made outside the app', async () => {
  const ok = await api('auditor', 'POST', '/api/audit/verify-chain');
  assert.equal(ok.body.valid, true);
  assert.ok(ok.body.checked > 10);

  // Bypass Mongoose entirely, as someone editing the database directly would.
  const raw = mongoose.connection.db.collection('auditlogs');
  const target = await raw.findOne({ seq: 3 });
  await raw.updateOne({ _id: target._id }, { $set: { details: 'covered up' } });
  const broken = await api('auditor', 'POST', '/api/audit/verify-chain');
  assert.equal(broken.body.valid, false);
  assert.equal(broken.body.firstBrokenId, 3);
  await raw.updateOne({ _id: target._id }, { $set: { details: target.details } });
});

test('dashboard is scoped per role', async () => {
  const all = await api('manager', 'GET', '/api/dashboard');
  const mine = await api('investigator3', 'GET', '/api/dashboard');
  assert.ok(all.body.stats.evidenceItems > mine.body.stats.evidenceItems);
  assert.ok(Array.isArray(all.body.workload));
  assert.equal(mine.body.workload, null);
});
