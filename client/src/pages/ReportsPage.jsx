import { useState } from 'react';
import { api, download } from '../api.js';
import { ErrorPanel, FilterSelect, Loading, PageHeader, Tabs } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../utils/useAsync.js';
import { CASE_STATUSES, EVIDENCE_STATUSES, PRIORITIES } from './caseOptions.js';

const REPORTS = [
  { key: 'case-status', label: 'Case Status', filters: ['status', 'priority', 'dates'] },
  { key: 'evidence-register', label: 'Evidence Register', filters: ['case', 'evidenceStatus', 'dates'] },
  { key: 'investigator-workload', label: 'Investigator Workload', filters: [] },
  { key: 'chain-of-custody', label: 'Chain of Custody', filters: ['case', 'dates'] },
];
const HASH_COLUMNS = new Set(['sha256', 'md5']);
const NOWRAP_COLUMNS = new Set(['caseNumber', 'evidenceNumber', 'opened', 'dueDate', 'closed', 'collectedAt', 'registeredAt', 'occurredAt']);

export default function ReportsPage() {
  const { toastError } = useToast();
  const [active, setActive] = useState(REPORTS[0]);
  const [params, setParams] = useState({});
  const [exporting, setExporting] = useState('');
  const { data: cases } = useAsync(() => api.get('/api/cases'), []);
  const { data: report, error, loading } = useAsync(() => api.get(`/api/reports/${active.key}`, params), [active.key, JSON.stringify(params)]);

  const setParam = (key) => (value) => setParams((p) => ({ ...p, [key]: value }));
  const switchTab = (key) => {
    setActive(REPORTS.find((r) => r.key === key));
    setParams({});
  };

  async function exportAs(format) {
    setExporting(format);
    try {
      await download(`/api/reports/${active.key}`, { ...params, format });
    } catch (err) {
      toastError(err);
    } finally {
      setExporting('');
    }
  }

  const filterControls = {
    status: <FilterSelect key="status" label="Status" value={params.status ?? ''} onChange={setParam('status')} items={CASE_STATUSES} />,
    priority: <FilterSelect key="priority" label="Priority" value={params.priority ?? ''} onChange={setParam('priority')} items={PRIORITIES} />,
    evidenceStatus: <FilterSelect key="evidenceStatus" label="Status" value={params.status ?? ''} onChange={setParam('status')} items={EVIDENCE_STATUSES} />,
    case: <FilterSelect key="case" label="Case" value={params.caseId ?? ''} onChange={setParam('caseId')} items={(cases ?? []).map((c) => [c.id, c.caseNumber])} />,
    dates: [
      <label key="from">From<input type="date" value={params.from ?? ''} onChange={(e) => setParam('from')(e.target.value)} /></label>,
      <label key="to">To<input type="date" value={params.to ?? ''} onChange={(e) => setParam('to')(e.target.value)} /></label>,
    ],
  };

  return (
    <>
      <PageHeader title="Reports Hub" subtitle="Preview the mandatory reports and export them as PDF or CSV">
        <button type="button" className="btn" onClick={() => exportAs('csv')} disabled={Boolean(exporting)}>{exporting === 'csv' ? 'Exporting…' : 'Export CSV'}</button>
        <button type="button" className="btn primary" onClick={() => exportAs('pdf')} disabled={Boolean(exporting)}>{exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}</button>
      </PageHeader>
      <section className="panel">
        <Tabs tabs={REPORTS} active={active.key} onChange={switchTab} />
        {active.filters.length > 0 && <div className="toolbar">{active.filters.map((f) => filterControls[f])}</div>}
        {error && <ErrorPanel error={error} />}
        {!report && !error && <Loading />}
        {report && (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {report.subtitle} {loading ? 'Updating…' : `${report.rows.length} row(s).`}
            </div>
            {report.rows.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr>{report.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {report.rows.map((row, i) => (
                      <tr key={i}>
                        {report.columns.map((c) => {
                          const value = row[c.key];
                          if (value === null || value === undefined || value === '') return <td key={c.key}>—</td>;
                          if (HASH_COLUMNS.has(c.key)) return <td key={c.key} className="hash nowrap" title={value}>{value.slice(0, 10)}…</td>;
                          return <td key={c.key} className={typeof value === 'number' ? 'num' : NOWRAP_COLUMNS.has(c.key) ? 'nowrap' : ''}>{value}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No rows match these filters</div>}
          </>
        )}
      </section>
    </>
  );
}
