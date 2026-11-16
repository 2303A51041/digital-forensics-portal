import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { writeReportPdf } from '../lib/pdf.js';
import { dateRange, HttpError, objectId, todayUtc } from '../lib/util.js';
import { requirePermission } from '../middleware/auth.js';
import { Case, CustodyEvent, Evidence, Finding, FINAL_EVIDENCE_STATUSES, User } from '../models/index.js';
import { INVESTIGATOR } from '../permissions.js';
import { investigatorNames } from './cases.js';

const router = Router();
router.use(requirePermission('report.view'));

const dateOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const timeOf = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '');

async function countBy(Model, match, field = 'case') {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

// Each report: title, columns as [key, label, PDF width weight], the filters it accepts and how to build its rows.
const REPORTS = {
  'case-status': {
    title: 'Case Status Report',
    subtitle: 'Every forensic case with its status, team, evidence count and age.',
    columns: [
      ['caseNumber', 'Case No.', 1.25], ['title', 'Title', 2.6], ['caseType', 'Type', 1.2], ['priority', 'Priority', 0.8],
      ['status', 'Status', 0.9], ['investigators', 'Investigators', 2.2], ['evidenceCount', 'Evidence', 0.7],
      ['findingsFinal', 'Final findings', 0.8], ['opened', 'Opened', 0.9], ['dueDate', 'Due', 0.9], ['closed', 'Closed', 0.9],
      ['ageDays', 'Age (days)', 0.7],
    ],
    async rows(q) {
      const filter = {};
      const range = dateRange(q);
      if (range) filter.openedAt = range;
      if (q.status) filter.status = String(q.status);
      if (q.priority) filter.priority = String(q.priority);
      const cases = await Case.find(filter).sort({ openedAt: -1 }).populate('assignments.user', 'fullName');
      const ids = cases.map((c) => c._id);
      const [evidence, findings] = await Promise.all([
        countBy(Evidence, { case: { $in: ids } }),
        countBy(Finding, { case: { $in: ids }, status: 'Final' }),
      ]);
      return cases.map((c) => ({
        caseNumber: c.caseNumber, title: c.title, caseType: c.caseType, priority: c.priority, status: c.status,
        investigators: investigatorNames(c), evidenceCount: evidence.get(String(c._id)) ?? 0,
        findingsFinal: findings.get(String(c._id)) ?? 0, opened: dateOf(c.openedAt), dueDate: c.dueDate ?? '',
        closed: dateOf(c.closedAt), ageDays: Math.floor(((c.closedAt ?? new Date()) - c.openedAt) / 86400000),
      }));
    },
  },
  'evidence-register': {
    title: 'Evidence Register',
    subtitle: 'All registered evidence with source, hash values, custodian and last integrity check.',
    columns: [
      ['evidenceNumber', 'Evidence No.', 1.25], ['caseNumber', 'Case No.', 1.2], ['itemName', 'Item', 1.6], ['evidenceType', 'Type', 1],
      ['source', 'Source', 1.4], ['collectedAt', 'Collected (UTC)', 1], ['registeredAt', 'Registered (UTC)', 1],
      ['sha256', 'SHA-256', 2.2], ['md5', 'MD5', 1.3], ['hashOrigin', 'Hash origin', 1], ['custodian', 'Custodian', 1.1],
      ['status', 'Status', 0.9], ['integrity', 'Last verification', 1.1],
    ],
    async rows(q) {
      const filter = {};
      const range = dateRange(q);
      if (range) filter.collectedAt = range;
      if (q.status) filter.status = String(q.status);
      if (q.caseId) filter.case = objectId(String(q.caseId), 'case id');
      const items = await Evidence.find(filter).sort({ _id: -1 }).populate('case', 'caseNumber').populate('currentCustodian', 'fullName');
      return items.map((e) => ({
        evidenceNumber: e.evidenceNumber, caseNumber: e.case?.caseNumber, itemName: e.itemName, evidenceType: e.evidenceType,
        source: e.source, collectedAt: timeOf(e.collectedAt), registeredAt: timeOf(e.registeredAt), sha256: e.sha256 ?? '',
        md5: e.md5 ?? '', hashOrigin: e.hashOrigin, custodian: e.currentCustodian?.fullName, status: e.status,
        integrity: e.lastVerifyResult ? `${e.lastVerifyResult} on ${dateOf(e.lastVerifiedAt)}` : 'Never',
      }));
    },
  },
  'investigator-workload': {
    title: 'Investigator Workload Report',
    subtitle: 'Active and closed cases, evidence held and findings for each active forensic investigator.',
    columns: [
      ['fullName', 'Investigator', 2], ['activeCases', 'Active cases', 1], ['highPriority', 'High/Critical active', 1.1],
      ['overdue', 'Overdue', 0.8], ['closedCases', 'Closed cases', 1], ['evidenceHeld', 'Evidence held', 1],
      ['findingsDraft', 'Draft findings', 1], ['findingsFinal', 'Final findings', 1],
    ],
    async rows() {
      const today = todayUtc();
      const investigators = await User.find({ role: INVESTIGATOR, isActive: true });
      const ids = investigators.map((u) => u._id);
      const [cases, held, drafts, finals] = await Promise.all([
        Case.find({ 'assignments.user': { $in: ids } }).select('assignments status priority dueDate').lean(),
        countBy(Evidence, { currentCustodian: { $in: ids }, status: { $nin: FINAL_EVIDENCE_STATUSES } }, 'currentCustodian'),
        countBy(Finding, { author: { $in: ids }, status: 'Draft' }, 'author'),
        countBy(Finding, { author: { $in: ids }, status: 'Final' }, 'author'),
      ]);
      return investigators.map((u) => {
        const mine = cases.filter((c) => c.assignments.some((a) => a.user.equals(u._id)));
        const active = mine.filter((c) => c.status !== 'Closed');
        const key = String(u._id);
        return {
          fullName: u.fullName,
          activeCases: active.length,
          highPriority: active.filter((c) => ['High', 'Critical'].includes(c.priority)).length,
          overdue: active.filter((c) => c.dueDate && c.dueDate < today).length,
          closedCases: mine.length - active.length,
          evidenceHeld: held.get(key) ?? 0,
          findingsDraft: drafts.get(key) ?? 0,
          findingsFinal: finals.get(key) ?? 0,
        };
      }).sort((a, b) => b.activeCases - a.activeCases || a.fullName.localeCompare(b.fullName));
    },
  },
  'chain-of-custody': {
    title: 'Chain-of-Custody Report',
    subtitle: 'Every registration and transfer of every evidence item, in order.',
    columns: [
      ['evidenceNumber', 'Evidence No.', 1.25], ['caseNumber', 'Case No.', 1.2], ['itemName', 'Item', 1.6], ['action', 'Action', 0.8],
      ['fromName', 'From', 1.1], ['toName', 'To', 1.1], ['location', 'Location', 1.3], ['purpose', 'Purpose', 1.9],
      ['statusAfter', 'Status after', 0.9], ['occurredAt', 'Occurred (UTC)', 1.1], ['recordedBy', 'Recorded by', 1.1],
    ],
    async rows(q) {
      const evidenceFilter = {};
      if (q.caseId) evidenceFilter.case = objectId(String(q.caseId), 'case id');
      if (q.evidenceId) evidenceFilter._id = objectId(String(q.evidenceId), 'evidence id');
      const filter = {};
      if (Object.keys(evidenceFilter).length) filter.evidence = { $in: await Evidence.find(evidenceFilter).distinct('_id') };
      const range = dateRange(q);
      if (range) filter.occurredAt = range;
      const events = await CustodyEvent.find(filter)
        .populate({ path: 'evidence', select: 'evidenceNumber itemName case', populate: { path: 'case', select: 'caseNumber' } })
        .populate('fromUser', 'fullName').populate('toUser', 'fullName').populate('recordedBy', 'fullName');
      // Newest evidence first; within one item, events in the order they happened.
      events.sort((a, b) => String(b.evidence?.evidenceNumber).localeCompare(String(a.evidence?.evidenceNumber))
        || a.occurredAt - b.occurredAt || String(a._id).localeCompare(String(b._id)));
      return events.map((ev) => ({
        evidenceNumber: ev.evidence?.evidenceNumber, caseNumber: ev.evidence?.case?.caseNumber, itemName: ev.evidence?.itemName,
        action: ev.action, fromName: ev.fromUser?.fullName ?? '', toName: ev.toUser?.fullName, location: ev.location,
        purpose: ev.purpose, statusAfter: ev.statusAfter, occurredAt: timeOf(ev.occurredAt), recordedBy: ev.recordedBy?.fullName,
      }));
    },
  },
};

const FILTER_LABELS = { status: 'Status', priority: 'Priority', caseId: 'Case', evidenceId: 'Evidence', from: 'From', to: 'To' };

/** Quotes a CSV cell and neutralizes spreadsheet formulas in user-entered text. */
function csvCell(value) {
  let cell = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

router.get('/:type', async (req, res) => {
  if (!Object.hasOwn(REPORTS, req.params.type)) throw new HttpError(404, 'Unknown report');
  const report = REPORTS[req.params.type];
  const format = ['csv', 'pdf'].includes(req.query.format) ? req.query.format : 'json';
  const rows = await report.rows(req.query);
  const generatedAt = new Date();
  await audit(req, 'REPORT_GENERATED', 'report', req.params.type, `${format.toUpperCase()}, ${rows.length} rows`);
  const filename = `${req.params.type}-${generatedAt.toISOString().slice(0, 10)}`;

  if (format === 'csv') {
    const lines = [
      report.columns.map(([, label]) => csvCell(label)).join(','),
      ...rows.map((row) => report.columns.map(([key]) => csvCell(row[key])).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}\r\n`);
  }

  if (format === 'pdf') {
    let filters = Object.entries(FILTER_LABELS).filter(([key]) => req.query[key]).map(([key, label]) => `${label} = ${req.query[key]}`);
    if (req.query.caseId) {
      const c = await Case.findById(String(req.query.caseId)).select('caseNumber').lean();
      filters = filters.map((f) => (f.startsWith('Case =') ? `Case = ${c?.caseNumber ?? req.query.caseId}` : f));
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    return writeReportPdf(res, {
      title: report.title,
      subtitle: report.subtitle,
      generatedBy: req.user.fullName,
      generatedAt: `${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      filters: filters.join(', '),
      columns: report.columns,
      rows,
    });
  }

  res.json({
    title: report.title,
    subtitle: report.subtitle,
    generatedAt,
    generatedBy: req.user.fullName,
    columns: report.columns.map(([key, label]) => ({ key, label })),
    rows,
  });
});

export default router;
