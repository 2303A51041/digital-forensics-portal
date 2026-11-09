import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forensics-test-'));
process.env.DATA_DIR = dataDir;

const { createApp } = await import('../src/app.js');
const { DEMO_PASSWORD, seedIfEmpty } = await import('../src/db/seed.js');
const { db, get } = await import('../src/db/index.js');

let server, base;
const tokens = {};

async function api(user, method, url, body) {
  const headers = user ? { Authorization: `Bearer ${tokens[user]}` } : {};
  const options = { method, headers };
  if (body instanceof FormData) options.body = body;
  else if (body) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const res = await fetch(base + url, options);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
}

function evidenceForm(fields, content) {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    case_id: 1, item_name: 'USB stick', evidence_type: 'Removable Media', source: 'Desk drawer',
    collected_at: new Date(Date.now() - 3600000).toISOString(), ...fields,
  })) form.set(k, v);
  if (content !== undefined) form.set('file', new Blob([content]), 'image.bin');
  return form;
}

before(async () => {
  seedIfEmpty();
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['admin', 'manager', 'investigator1', 'investigator2', 'investigator3', 'auditor']) {
    const res = await api(null, 'POST', '/api/auth/login', { username: u, password: DEMO_PASSWORD });
    assert.equal(res.status, 200);
    tokens[u] = res.body.token;
  }
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('rejects bad credentials and missing tokens', async () => {
  assert.equal((await api(null, 'POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await api(null, 'GET', '/api/cases')).status, 401);
});

test('role restrictions are enforced', async () => {
  assert.equal((await api('investigator1', 'POST', '/api/cases', { title: 'x', case_type: 'y' })).status, 403);
  assert.equal((await api('investigator1', 'GET', '/api/reports/case-status')).status, 403);
  assert.equal((await api('investigator1', 'GET', '/api/audit/logs')).status, 403);
  assert.equal((await api('manager', 'GET', '/api/users')).status, 403);
  assert.equal((await api('auditor', 'POST', '/api/findings', evidenceForm({}))).status, 403);
  assert.equal((await api('auditor', 'GET', '/api/evidence/1/download')).status, 403);
});

test('investigators only see assigned cases', async () => {
  const list = await api('investigator3', 'GET', '/api/cases');
  assert.deepEqual(list.body.map((c) => c.id).sort(), [2, 3]);
  assert.equal((await api('investigator3', 'GET', '/api/cases/1')).status, 404);
  assert.equal((await api('investigator3', 'GET', '/api/evidence/1')).status, 404);
  assert.equal((await api('investigator3', 'POST', '/api/evidence', evidenceForm({}, 'x'))).status, 404);
});

test('case creation and assignment', async () => {
  const created = await api('manager', 'POST', '/api/cases', { title: 'New case', case_type: 'Malware', priority: 'High' });
  assert.equal(created.status, 201);
  assert.match(created.body.case_number, /^DF-\d{4}-0006$/);
  assert.equal((await api('manager', 'PUT', `/api/cases/${created.body.id}/assignments`, { user_id: 1 })).status, 400);
  assert.equal((await api('manager', 'PUT', `/api/cases/${created.body.id}/assignments`, { user_id: 5, role_on_case: 'Lead' })).status, 204);
  assert.equal((await api('investigator3', 'GET', `/api/cases/${created.body.id}`)).status, 200);
});

test('uploaded evidence gets server-computed hashes and custody', async () => {
  const content = 'forensic bytes';
  const res = await api('investigator1', 'POST', '/api/evidence', evidenceForm({}, content));
  assert.equal(res.status, 201);
  assert.equal(res.body.sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(res.body.md5, crypto.createHash('md5').update(content).digest('hex'));
  const detail = await api('admin', 'GET', `/api/evidence/${res.body.id}`);
  assert.equal(detail.body.custody[0].action, 'Registered');
  assert.equal((await api('auditor', 'POST', `/api/evidence/${res.body.id}/verify`)).body.result, 'Match');
  const dl = await api('investigator1', 'GET', `/api/evidence/${res.body.id}/download`);
  assert.equal(dl.body, content);
});

test('wrong declared hash is rejected and its upload removed', async () => {
  const before = fs.readdirSync(path.join(dataDir, 'uploads')).length;
  const res = await api('investigator1', 'POST', '/api/evidence', evidenceForm({ sha256: 'a'.repeat(64) }, 'data'));
  assert.equal(res.status, 422);
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, before);
});

test('metadata-only evidence needs a valid hash', async () => {
  assert.equal((await api('investigator1', 'POST', '/api/evidence', evidenceForm({}))).status, 400);
  assert.equal((await api('investigator1', 'POST', '/api/evidence', evidenceForm({ md5: 'xyz' }))).status, 400);
  const ok = await api('investigator1', 'POST', '/api/evidence', evidenceForm({ md5: 'b'.repeat(32) }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.hash_origin, 'Declared');
  const future = evidenceForm({ md5: 'b'.repeat(32), collected_at: new Date(Date.now() + 86400000).toISOString() });
  assert.equal((await api('investigator1', 'POST', '/api/evidence', future)).status, 400);
});

test('tampering with a stored file is detected', async () => {
  const res = await api('investigator1', 'POST', '/api/evidence', evidenceForm({}, 'original'));
  fs.writeFileSync(path.join(dataDir, 'uploads', res.body.file_storage_name), 'tampered');
  assert.equal((await api('investigator1', 'POST', `/api/evidence/${res.body.id}/verify`)).body.result, 'Mismatch');
});

test('custody transfer rules', async () => {
  const transfer = { to_user_id: 4, purpose: 'Analysis', location: 'Lab 1' };
  // Evidence 1 is held by investigator1 on case 1; investigator2 is on the case but is not custodian.
  assert.equal((await api('investigator2', 'POST', '/api/evidence/1/transfer', transfer)).status, 403);
  // investigator3 (user 5) is not assigned to case 1.
  assert.equal((await api('investigator1', 'POST', '/api/evidence/1/transfer', { ...transfer, to_user_id: 5 })).status, 400);
  assert.equal((await api('investigator1', 'POST', '/api/evidence/1/transfer', { ...transfer, occurred_at: '2001-01-01T00:00:00Z' })).status, 400);
  const ok = await api('investigator1', 'POST', '/api/evidence/1/transfer', transfer);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.custody.at(-1).to_user_id, 4);
  assert.equal((await api('investigator1', 'POST', '/api/evidence/1/transfer', transfer)).status, 403);
  // investigator2 now holds evidence, so cannot be removed from the case.
  assert.equal((await api('manager', 'DELETE', '/api/cases/1/assignments/4')).status, 409);
});

test('database refuses to alter protected records', () => {
  assert.throws(() => db.exec('DELETE FROM custody_events'), /append-only/);
  assert.throws(() => db.exec('UPDATE audit_logs SET details = 1'), /append-only/);
  assert.throws(() => db.exec("UPDATE evidence SET md5 = NULL WHERE id = 1"), /immutable/);
  assert.throws(() => db.exec('DELETE FROM evidence'), /cannot be deleted/);
});

test('findings lifecycle and summaries', async () => {
  const form = new FormData();
  form.set('case_id', 1); form.set('title', 'Finding A'); form.set('details', 'Detail'); form.set('severity', 'High');
  form.set('attachment', new Blob(['notes']), 'notes.txt');
  const created = await api('investigator1', 'POST', '/api/findings', form);
  assert.equal(created.status, 201);
  assert.ok(created.body.attachment_sha256);
  const edit = { title: 'Finding A2', details: 'Detail', severity: 'High' };
  assert.equal((await api('investigator2', 'PATCH', `/api/findings/${created.body.id}`, edit)).status, 403);
  assert.equal((await api('investigator1', 'PATCH', `/api/findings/${created.body.id}`, edit)).status, 200);
  const draftSummary = await api('manager', 'POST', '/api/findings/summaries', { case_id: 1 });
  assert.equal(draftSummary.status, 201);
  assert.ok(!draftSummary.body.content.includes('Finding A2'));
  assert.equal((await api('manager', 'POST', `/api/findings/${created.body.id}/finalize`)).status, 200);
  assert.equal((await api('investigator1', 'PATCH', `/api/findings/${created.body.id}`, edit)).status, 409);
  const summary = await api('manager', 'POST', '/api/findings/summaries', { case_id: 1 });
  assert.equal(summary.body.version, 2);
  assert.ok(summary.body.content.includes('Finding A2'));
});

test('closed cases refuse new evidence', async () => {
  assert.equal((await api('manager', 'POST', '/api/evidence', evidenceForm({ case_id: 5 }, 'x'))).status, 409);
});

test('all four reports return rows and CSV', async () => {
  for (const type of ['case-status', 'evidence-register', 'investigator-workload', 'chain-of-custody']) {
    const json = await api('auditor', 'GET', `/api/reports/${type}`);
    assert.equal(json.status, 200, type);
    assert.ok(json.body.rows.length > 0, type);
    const csv = await api('manager', 'GET', `/api/reports/${type}?format=csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.body.split('\r\n').length > 2, type);
  }
  assert.equal((await api('auditor', 'GET', '/api/reports/constructor')).status, 404);
  assert.equal((await api('auditor', 'GET', '/api/reports/case-status?from=garbage')).status, 400);
});

test('CSV cells cannot inject formulas', async () => {
  await api('manager', 'POST', '/api/cases', { title: '=HYPERLINK("http://x")', case_type: 'T' });
  const csv = await api('manager', 'GET', '/api/reports/case-status?format=csv');
  assert.ok(csv.body.includes(`"'=HYPERLINK(""http://x"")"`));
});

test('user management guards', async () => {
  assert.equal((await api('admin', 'PATCH', '/api/users/1', { role: 'Auditor' })).status, 409);
  assert.equal((await api('admin', 'PATCH', '/api/users/1', { is_active: false })).status, 409);
  assert.equal((await api('admin', 'PATCH', '/api/users/3', { is_active: false })).status, 409);
  const created = await api('admin', 'POST', '/api/users', {
    username: 'temp', full_name: 'Temp', email: 'temp@example.com', role: 'Auditor', password: 'password1',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.password_hash, undefined);
  const login = await api(null, 'POST', '/api/auth/login', { username: 'temp', password: 'password1' });
  tokens.temp = login.body.token;
  assert.equal((await api('temp', 'GET', '/api/cases')).status, 200);
  assert.equal((await api('admin', 'PATCH', `/api/users/${created.body.id}`, { is_active: false })).status, 200);
  assert.equal((await api('temp', 'GET', '/api/cases')).status, 401);
});

test('audit chain verifies, and detects tampering', async () => {
  const good = await api('auditor', 'POST', '/api/audit/verify-chain');
  assert.equal(good.body.valid, true);
  const logs = await api('admin', 'GET', '/api/audit/logs?action=CASE_CREATED');
  assert.ok(logs.body.total >= 1);
  assert.ok((await api('admin', 'GET', '/api/audit/evidence-access')).body.total >= 1);
  const denied = await api('admin', 'GET', '/api/audit/logs?action=ACCESS_DENIED');
  assert.ok(denied.body.total >= 1);

  const target = get("SELECT id FROM audit_logs WHERE action = 'CASE_CREATED' LIMIT 1").id;
  db.exec('DROP TRIGGER audit_no_update');
  db.exec(`UPDATE audit_logs SET details = 'forged' WHERE id = ${target}`);
  const bad = await api('auditor', 'POST', '/api/audit/verify-chain');
  assert.equal(bad.body.valid, false);
  assert.equal(bad.body.firstBrokenId, target);
});

test('dashboard is scoped per role', async () => {
  const admin = await api('admin', 'GET', '/api/dashboard');
  const inv = await api('investigator3', 'GET', '/api/dashboard');
  assert.ok(admin.body.stats.evidence_items > inv.body.stats.evidence_items);
  assert.equal(inv.body.workload, null);
  assert.ok(admin.body.workload.length === 3);
});
