import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from './config.js';
import { audit } from './lib/audit.js';
import { Case, Counter, CustodyEvent, Evidence, Finding, User } from './models/index.js';

export const DEMO_PASSWORD = 'Forensics@123';

const daysAgo = (d, hour = 10) => {
  const date = new Date(Date.now() - d * 86400000);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};
const dueIn = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const fakeHash = (seed, algo) => crypto.createHash(algo).update(seed).digest('hex');

const USERS = [
  ['admin', 'Priya Raman', 'Admin'],
  ['manager', 'Daniel Osei', 'Case Manager'],
  ['investigator1', 'Ananya Iyer', 'Forensic Investigator'],
  ['investigator2', 'Marcus Lindholm', 'Forensic Investigator'],
  ['investigator3', 'Sofia Mendes', 'Forensic Investigator'],
  ['auditor', 'Grace Whitfield', 'Auditor'],
];

// [title, description, type, priority, status, opened days ago, due in days]
const CASES = [
  ['Unauthorized database export at regional office', 'A privileged account exported customer records outside business hours.', 'Data Breach', 'Critical', 'In Progress', 21, 6],
  ['Ransomware outbreak on finance file servers', 'File shares encrypted over a weekend. Determine the initial access vector and scope.', 'Malware', 'High', 'In Progress', 14, 12],
  ['Employee laptop misuse investigation', 'HR referral about policy violations on a corporate laptop.', 'Insider Threat', 'Medium', 'Open', 5, 25],
  ['Phishing campaign targeting payroll staff', 'Credential harvesting emails sent to payroll staff.', 'Phishing', 'High', 'On Hold', 30, -3],
  ['Mobile device extraction for fraud inquiry', 'Extraction and review of a company mobile phone.', 'Fraud', 'Low', 'Closed', 60, null],
];

// [case index, user index, role on case]
const ASSIGNMENTS = [[0, 2, 'Lead'], [0, 3, 'Support'], [1, 3, 'Lead'], [1, 4, 'Support'], [2, 4, 'Lead'], [3, 2, 'Lead'], [4, 3, 'Lead']];

// [case index, item, type, source, description, location, custodian index]
const EVIDENCE = [
  [0, 'Database server audit log', 'Log File', 'DB-PROD-02, /var/log/audit', 'Audit log covering the export window.', 'Evidence Vault A, Shelf 2', 2],
  [0, 'Workstation disk image', 'Disk Image', 'Dell OptiPlex, asset WS-4471', 'Full E01 image, write-blocked acquisition.', 'Forensic Lab 1', 2],
  [0, 'VPN gateway session records', 'Network Capture', 'Perimeter VPN appliance', 'Session records for the suspect account.', 'Evidence Vault A, Shelf 3', 3],
  [1, 'Encrypted file share sample', 'Disk Image', 'FS-FIN-01, volume D', 'Sample of encrypted shares and ransom note.', 'Forensic Lab 2', 3],
  [1, 'Memory dump of patient-zero host', 'Memory Dump', 'Host FIN-WS-019', 'RAM capture taken before shutdown.', 'Forensic Lab 2', 4],
  [2, 'Corporate laptop', 'Physical Device', 'Lenovo T14, asset LT-2208', 'Seized from employee desk with HR present.', 'Evidence Locker 7', 4],
  [3, 'Phishing email headers', 'Email', 'Mail gateway quarantine', 'Original messages exported in EML format.', 'Evidence Vault B, Shelf 1', 2],
  [4, 'Mobile phone extraction', 'Mobile Extraction', 'Samsung A54, IMEI on file', 'Logical extraction report.', 'Archive Room', 3],
];

// [case index, evidence index, title, details, severity, status, author index]
const FINDINGS = [
  [0, 0, 'Bulk export ran under a service account', 'The audit log shows 184,220 customer rows exported by svc_report at 23:41 UTC, outside its scheduled window.', 'Critical', 'Final', 2],
  [0, 1, 'Credential harvesting tool on workstation', 'A credential dumping utility was recovered from unallocated space on the workstation image.', 'High', 'Draft', 2],
  [1, 4, 'Ransomware loader identified in memory', 'The memory capture contains a loader injected into a signed process. Analysis of persistence is continuing.', 'High', 'Draft', 4],
  [4, 7, 'No evidence of fraudulent messaging', 'The extraction contained no messages or transactions supporting the allegation.', 'Info', 'Final', 3],
];

// Seeded records are back-dated, so their timestamps are set by hand instead of by Mongoose.
const saveDated = (doc) => doc.save({ timestamps: false });

/** Creates demo users, cases, evidence, custody and findings when the database has no users. */
export async function seedIfEmpty({ force = false } = {}) {
  if (!force && (!config.seedDemo || (await User.exists({})))) return false;
  const now = new Date();
  const year = now.getUTCFullYear();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const users = await User.insertMany(USERS.map(([username, fullName, role]) => ({
    username, fullName, role, passwordHash, email: `${username}@forensics.example`,
  })));
  const manager = users[1];
  await audit(null, 'DEMO_DATA_SEEDED', 'system', '', `${USERS.length} users`, { _id: null, username: 'system', role: '' });

  const cases = [];
  for (const [i, [title, description, caseType, priority, status, opened, due]] of CASES.entries()) {
    const doc = new Case({
      caseNumber: `DF-${year}-${String(i + 1).padStart(4, '0')}`, title, description, caseType, priority, status,
      createdBy: manager._id, openedAt: daysAgo(opened), dueDate: due === null ? null : dueIn(due),
      closedAt: status === 'Closed' ? daysAgo(10) : null, createdAt: daysAgo(opened), updatedAt: daysAgo(1),
      assignments: ASSIGNMENTS.filter(([c]) => c === i).map(([, u, roleOnCase]) => ({
        user: users[u]._id, roleOnCase, assignedBy: manager._id, assignedAt: daysAgo(opened - 1),
      })),
    });
    cases.push(await saveDated(doc));
  }

  // The first item has a real stored file, so "Verify integrity" and "Download file" work in the demo.
  const sampleContent = 'timestamp,user,action,rows\n2026-10-18T23:41:07Z,svc_report,EXPORT customers,184220\n';
  const sampleName = crypto.randomUUID();
  fs.writeFileSync(path.join(config.uploadDir, sampleName), sampleContent);

  const evidence = [];
  for (const [i, [c, itemName, evidenceType, source, description, storageLocation, custodian]] of EVIDENCE.entries()) {
    const opened = CASES[c][5];
    const registered = daysAgo(opened - 1, 14);
    const real = i === 0;
    const closed = CASES[c][4] === 'Closed';
    // Keeps each chain continuous: every transfer starts from whoever received the item last.
    const firstHolder = !closed && i % 2 ? manager : users[custodian];
    const finalHolder = closed ? manager : users[custodian];
    const doc = await saveDated(new Evidence({
      evidenceNumber: `EV-${year}-${String(i + 1).padStart(4, '0')}`, case: cases[c]._id, itemName, evidenceType, source,
      description, storageLocation, collectedAt: daysAgo(opened - 1, 9), registeredBy: firstHolder._id,
      sha256: fakeHash(real ? sampleContent : itemName, 'sha256'), md5: fakeHash(real ? sampleContent : itemName, 'md5'),
      hashOrigin: real ? 'Computed' : 'Declared',
      file: real ? { storageName: sampleName, originalName: 'db_audit_export.csv', mimeType: 'text/csv', size: Buffer.byteLength(sampleContent) } : undefined,
      currentCustodian: finalHolder._id, status: closed ? 'Archived' : i % 2 ? 'In Analysis' : 'In Storage',
      registeredAt: registered, updatedAt: registered,
    }));
    evidence.push(doc);
    await saveDated(new CustodyEvent({
      evidence: doc._id, action: 'Registered', fromUser: null, toUser: firstHolder._id, location: storageLocation,
      purpose: 'Initial registration', statusAfter: 'In Storage', occurredAt: registered, recordedBy: firstHolder._id, recordedAt: registered,
    }));
    if (closed || i % 2) {
      const at = daysAgo(closed ? 10 : 2);
      await saveDated(new CustodyEvent({
        evidence: doc._id, action: 'Transfer', fromUser: firstHolder._id, toUser: finalHolder._id, location: storageLocation,
        purpose: closed ? 'Archived after case closure' : 'Released to examiner for analysis',
        statusAfter: closed ? 'Archived' : 'In Analysis', occurredAt: at, recordedBy: manager._id, recordedAt: at,
      }));
    }
  }

  for (const [c, e, title, details, severity, status, author] of FINDINGS) {
    const at = daysAgo(status === 'Final' ? 11 : 1);
    await saveDated(new Finding({
      case: cases[c]._id, evidence: evidence[e]._id, title, details, severity, status, author: users[author]._id,
      finalizedAt: status === 'Final' ? at : null, createdAt: at, updatedAt: at,
    }));
  }

  // Continue numbering after the seeded records.
  await Counter.findOneAndUpdate({ _id: `DF-${year}` }, { $set: { seq: CASES.length } }, { upsert: true });
  await Counter.findOneAndUpdate({ _id: `EV-${year}` }, { $set: { seq: EVIDENCE.length } }, { upsert: true });
  return true;
}

// Command line:
//   node src/seed.js --if-empty   load demo data only if the database has no users (safe; used by setup)
//   node src/seed.js --reset      erase ALL data, then load fresh demo data (npm run seed)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { connectDb, disconnectDb, safeUri } = await import('./db.js');
  const reset = process.argv.includes('--reset');
  if (!reset && !process.argv.includes('--if-empty')) {
    console.error('Usage: node src/seed.js --if-empty   (seed only an empty database)');
    console.error('       node src/seed.js --reset      (erases ALL data first)');
    process.exit(1);
  }
  try {
    await connectDb();
  } catch (err) {
    console.error(`Could not connect to MongoDB at ${safeUri(config.mongoUri)}: ${err.message}`);
    process.exit(2);
  }
  if (reset) {
    console.log(`Erasing ${safeUri(config.mongoUri)} ...`);
    await mongoose.connection.dropDatabase();
    await mongoose.connection.syncIndexes();
    fs.rmSync(config.uploadDir, { recursive: true, force: true });
    fs.mkdirSync(config.uploadDir, { recursive: true });
  }
  if (await seedIfEmpty({ force: reset || !(await User.exists({})) })) {
    console.log(`Demo data loaded into ${safeUri(config.mongoUri)}. Sign in as "admin" with password ${DEMO_PASSWORD}`);
  } else {
    console.log(`${safeUri(config.mongoUri)} already has data, so it was left unchanged.`);
  }
  await disconnectDb();
}
