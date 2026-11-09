import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { get, run, tx } from './index.js';
import { audit } from '../lib/audit.js';

export const DEMO_PASSWORD = 'Forensics@123';

const daysAgo = (d, hour = 10) => {
  const date = new Date(Date.now() - d * 86400000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
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

const CASES = [
  ['Unauthorized database export at regional office', 'A privileged account exported customer records outside business hours.', 'Data Breach', 'Critical', 'In Progress', 21, 6],
  ['Ransomware outbreak on finance file servers', 'File shares encrypted over a weekend. Determine the initial access vector and scope.', 'Malware', 'High', 'In Progress', 14, 12],
  ['Employee laptop misuse investigation', 'HR referral about policy violations on a corporate laptop.', 'Insider Threat', 'Medium', 'Open', 5, 25],
  ['Phishing campaign targeting payroll staff', 'Credential harvesting emails sent to payroll staff.', 'Phishing', 'High', 'On Hold', 30, -3],
  ['Mobile device extraction for fraud inquiry', 'Extraction and review of a company mobile phone.', 'Fraud', 'Low', 'Closed', 60, null],
];

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

export function seedIfEmpty() {
  if (!config.seedDemo || get('SELECT 1 AS ok FROM users LIMIT 1')) return false;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  tx(() => {
    const now = new Date().toISOString();
    const userIds = USERS.map(([username, name, role]) => Number(run(
      'INSERT INTO users (username, full_name, email, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      username, name, `${username}@forensics.example`, hash, role, now, now,
    ).lastInsertRowid));
    const managerId = userIds[1];
    const system = { id: null, username: 'system', role: '' };
    audit(null, 'DEMO_DATA_SEEDED', 'system', '', `${USERS.length} users`, system);

    const year = now.slice(0, 4);
    const caseIds = CASES.map(([title, description, type, priority, status, opened, due], i) => Number(run(
      `INSERT INTO cases (case_number, title, description, case_type, priority, status, created_by, opened_at, due_date, closed_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      `DF-${year}-${String(i + 1).padStart(4, '0')}`, title, description, type, priority, status, managerId,
      daysAgo(opened), due === null ? null : dueIn(due), status === 'Closed' ? daysAgo(10) : null, daysAgo(1),
    ).lastInsertRowid));

    // [case index, user index, role]
    for (const [c, u, role] of [[0, 2, 'Lead'], [0, 3, 'Support'], [1, 3, 'Lead'], [1, 4, 'Support'], [2, 4, 'Lead'], [3, 2, 'Lead'], [4, 3, 'Lead']]) {
      run('INSERT INTO case_assignments (case_id, user_id, role_on_case, assigned_by, assigned_at) VALUES (?,?,?,?,?)',
        caseIds[c], userIds[u], role, managerId, daysAgo(CASES[c][5] - 1));
    }

    // The first item has a real stored file, so verify and download work in the demo.
    const sampleContent = 'timestamp,user,action,rows\n2026-10-18T23:41:07Z,svc_report,EXPORT customers,184220\n';
    const sampleName = crypto.randomUUID();
    fs.writeFileSync(path.join(config.uploadDir, sampleName), sampleContent);

    const evidenceIds = EVIDENCE.map(([c, item, type, source, description, location, custodian], i) => {
      const opened = CASES[c][5];
      const collected = daysAgo(opened - 1, 9);
      const registered = daysAgo(opened - 1, 14);
      const real = i === 0;
      const closed = CASES[c][4] === 'Closed';
      // Keeps each chain continuous: every transfer starts from whoever received the item last.
      const firstHolder = !closed && i % 2 ? managerId : userIds[custodian];
      const id = Number(run(
        `INSERT INTO evidence (evidence_number, case_id, item_name, evidence_type, source, description, storage_location, collected_at,
           registered_at, registered_by, sha256, md5, hash_origin, file_storage_name, original_filename, mime_type, file_size, current_custodian_id, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `EV-${year}-${String(i + 1).padStart(4, '0')}`, caseIds[c], item, type, source, description, location, collected,
        registered, firstHolder, fakeHash(real ? sampleContent : item, 'sha256'), fakeHash(real ? sampleContent : item, 'md5'),
        real ? 'Computed' : 'Declared', real ? sampleName : null, real ? 'db_audit_export.csv' : null, real ? 'text/csv' : null,
        real ? Buffer.byteLength(sampleContent) : null, userIds[closed ? 1 : custodian], closed ? 'Archived' : i % 2 ? 'In Analysis' : 'In Storage',
      ).lastInsertRowid);
      run(
        `INSERT INTO custody_events (evidence_id, action, from_user_id, to_user_id, location, purpose, status_after, occurred_at, recorded_by, recorded_at)
         VALUES (?, 'Registered', NULL, ?, ?, 'Initial registration', 'In Storage', ?, ?, ?)`,
        id, firstHolder, location, registered, firstHolder, registered,
      );
      if (closed || i % 2) {
        const at = daysAgo(closed ? 10 : 2);
        run(
          `INSERT INTO custody_events (evidence_id, action, from_user_id, to_user_id, location, purpose, status_after, occurred_at, recorded_by, recorded_at)
           VALUES (?, 'Transfer', ?,?,?,?,?,?,?,?)`,
          id, firstHolder, userIds[closed ? 1 : custodian], location,
          closed ? 'Archived after case closure' : 'Released to examiner for analysis',
          closed ? 'Archived' : 'In Analysis', at, userIds[1], at,
        );
      }
      return id;
    });

    const findings = [
      [0, 0, 'Bulk export ran under a service account', 'The audit log shows 184,220 customer rows exported by svc_report at 23:41 UTC, outside its scheduled window.', 'Critical', 'Final', 2],
      [0, 1, 'Credential harvesting tool on workstation', 'A credential dumping utility was recovered from unallocated space on the workstation image.', 'High', 'Draft', 2],
      [1, 4, 'Ransomware loader identified in memory', 'The memory capture contains a loader injected into a signed process. Analysis of persistence is continuing.', 'High', 'Draft', 4],
      [4, 7, 'No evidence of fraudulent messaging', 'The extraction contained no messages or transactions supporting the allegation.', 'Info', 'Final', 3],
    ];
    for (const [c, e, title, details, severity, status, author] of findings) {
      const at = daysAgo(status === 'Final' ? 11 : 1);
      run(
        `INSERT INTO findings (case_id, evidence_id, title, details, severity, status, author_id, created_at, updated_at, finalized_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        caseIds[c], evidenceIds[e], title, details, severity, status, userIds[author], at, at, status === 'Final' ? at : null,
      );
    }
  });
  return true;
}
