import { Router } from 'express';
import { all, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { dateOnly, HttpError, id, nowIso } from '../lib/util.js';
import { requirePermission } from '../middleware/auth.js';
import { INVESTIGATOR } from '../permissions.js';

const router = Router();
router.use(requirePermission('report.view'));

function filters(column, query, extra = []) {
  const where = [];
  const params = [];
  const from = dateOnly(query.from, 'From date');
  const to = dateOnly(query.to, 'To date');
  if (from) { where.push(`date(${column}) >= ?`); params.push(from); }
  if (to) { where.push(`date(${column}) <= ?`); params.push(to); }
  for (const [sql, value] of extra) {
    if (value) { where.push(sql); params.push(value); }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const REPORTS = {
  'case-status': {
    title: 'Case Status Report',
    columns: [
      ['case_number', 'Case No.'], ['title', 'Title'], ['case_type', 'Type'], ['priority', 'Priority'],
      ['status', 'Status'], ['investigators', 'Investigators'], ['evidence_count', 'Evidence'],
      ['findings_final', 'Final findings'], ['opened', 'Opened'], ['due_date', 'Due'], ['closed', 'Closed'], ['age_days', 'Age (days)'],
    ],
    rows(query) {
      const f = filters('c.opened_at', query, [['c.status = ?', query.status], ['c.priority = ?', query.priority]]);
      return all(
        `SELECT c.case_number, c.title, c.case_type, c.priority, c.status, c.due_date,
           date(c.opened_at) AS opened, date(c.closed_at) AS closed,
           COALESCE((SELECT group_concat(u.full_name, '; ') FROM case_assignments a JOIN users u ON u.id = a.user_id WHERE a.case_id = c.id), '') AS investigators,
           (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count,
           (SELECT COUNT(*) FROM findings fi WHERE fi.case_id = c.id AND fi.status = 'Final') AS findings_final,
           CAST(julianday(COALESCE(c.closed_at, 'now')) - julianday(c.opened_at) AS INTEGER) AS age_days
         FROM cases c ${f.sql} ORDER BY c.opened_at DESC`, ...f.params,
      );
    },
  },
  'evidence-register': {
    title: 'Evidence Register',
    columns: [
      ['evidence_number', 'Evidence No.'], ['case_number', 'Case No.'], ['item_name', 'Item'], ['evidence_type', 'Type'],
      ['source', 'Source'], ['collected_at', 'Collected (UTC)'], ['registered_at', 'Registered (UTC)'], ['sha256', 'SHA-256'],
      ['md5', 'MD5'], ['hash_origin', 'Hash origin'], ['custodian', 'Custodian'], ['status', 'Status'], ['integrity', 'Last verification'],
    ],
    rows(query) {
      const f = filters('e.collected_at', query, [
        ['e.status = ?', query.status],
        ['e.case_id = ?', query.case_id ? id(query.case_id, 'case id') : null],
      ]);
      return all(
        `SELECT e.evidence_number, c.case_number, e.item_name, e.evidence_type, e.source, e.collected_at, e.registered_at,
           COALESCE(e.sha256, '') AS sha256, COALESCE(e.md5, '') AS md5, e.hash_origin, u.full_name AS custodian, e.status,
           COALESCE(e.last_verify_result || ' on ' || date(e.last_verified_at), 'Never') AS integrity
         FROM evidence e JOIN cases c ON c.id = e.case_id JOIN users u ON u.id = e.current_custodian_id
         ${f.sql} ORDER BY e.id DESC`, ...f.params,
      );
    },
  },
  'investigator-workload': {
    title: 'Investigator Workload Report',
    columns: [
      ['full_name', 'Investigator'], ['active_cases', 'Active cases'], ['high_priority', 'High/Critical active'],
      ['overdue', 'Overdue'], ['closed_cases', 'Closed cases'], ['evidence_held', 'Evidence held'],
      ['findings_draft', 'Draft findings'], ['findings_final', 'Final findings'],
    ],
    rows() {
      return all(
        `SELECT u.full_name,
           COALESCE(SUM(c.status <> 'Closed'), 0) AS active_cases,
           COALESCE(SUM(c.status <> 'Closed' AND c.priority IN ('High','Critical')), 0) AS high_priority,
           COALESCE(SUM(c.status <> 'Closed' AND c.due_date < date('now')), 0) AS overdue,
           COALESCE(SUM(c.status = 'Closed'), 0) AS closed_cases,
           (SELECT COUNT(*) FROM evidence e WHERE e.current_custodian_id = u.id AND e.status NOT IN ('Released','Archived')) AS evidence_held,
           (SELECT COUNT(*) FROM findings f WHERE f.author_id = u.id AND f.status = 'Draft') AS findings_draft,
           (SELECT COUNT(*) FROM findings f WHERE f.author_id = u.id AND f.status = 'Final') AS findings_final
         FROM users u
         LEFT JOIN case_assignments a ON a.user_id = u.id
         LEFT JOIN cases c ON c.id = a.case_id
         WHERE u.role = ? AND u.is_active = 1
         GROUP BY u.id ORDER BY active_cases DESC, u.full_name`, INVESTIGATOR,
      );
    },
  },
  'chain-of-custody': {
    title: 'Chain-of-Custody Report',
    columns: [
      ['evidence_number', 'Evidence No.'], ['case_number', 'Case No.'], ['item_name', 'Item'], ['action', 'Action'],
      ['from_name', 'From'], ['to_name', 'To'], ['location', 'Location'], ['purpose', 'Purpose'],
      ['status_after', 'Status after'], ['occurred_at', 'Occurred (UTC)'], ['recorded_by_name', 'Recorded by'],
    ],
    rows(query) {
      const f = filters('ce.occurred_at', query, [
        ['c.id = ?', query.case_id ? id(query.case_id, 'case id') : null],
        ['e.id = ?', query.evidence_id ? id(query.evidence_id, 'evidence id') : null],
      ]);
      return all(
        `SELECT e.evidence_number, c.case_number, e.item_name, ce.action, COALESCE(fu.full_name, '') AS from_name, tu.full_name AS to_name,
           ce.location, ce.purpose, ce.status_after, ce.occurred_at, ru.full_name AS recorded_by_name
         FROM custody_events ce
         JOIN evidence e ON e.id = ce.evidence_id JOIN cases c ON c.id = e.case_id
         LEFT JOIN users fu ON fu.id = ce.from_user_id JOIN users tu ON tu.id = ce.to_user_id JOIN users ru ON ru.id = ce.recorded_by
         ${f.sql} ORDER BY e.id DESC, ce.occurred_at, ce.id`, ...f.params,
      );
    },
  },
};

/** Quotes a CSV cell and neutralizes spreadsheet formulas in user-entered text. */
function csvCell(value) {
  let cell = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

router.get('/:type', (req, res) => {
  const report = REPORTS[req.params.type];
  if (!report || !Object.hasOwn(REPORTS, req.params.type)) throw new HttpError(404, 'Unknown report');
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  const rows = report.rows(req.query);
  tx(() => audit(req, 'REPORT_GENERATED', 'report', req.params.type, `${format.toUpperCase()}, ${rows.length} rows`));

  if (format === 'csv') {
    const lines = [
      report.columns.map(([, label]) => csvCell(label)).join(','),
      ...rows.map((row) => report.columns.map(([key]) => csvCell(row[key])).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${nowIso().slice(0, 10)}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}\r\n`);
  }
  res.json({
    title: report.title,
    generated_at: nowIso(),
    generated_by: req.user.full_name,
    columns: report.columns.map(([key, label]) => ({ key, label })),
    rows,
  });
});

export default router;
