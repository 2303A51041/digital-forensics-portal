import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { DataTable, ErrorPanel, FilterSelect, PageHeader, Tabs } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDateTime } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';

const TABS = {
  system: {
    label: 'System audit log',
    url: '/api/audit/logs',
    columns: [
      { label: 'When', render: (r) => <span className="nowrap small">{fmtDateTime(r.occurredAt)}</span> },
      { label: 'User', render: (r) => <>{r.username}<div className="small muted">{r.role}</div></> },
      { label: 'Action', render: (r) => <span className="mono">{r.action}</span> },
      { label: 'Entity', render: (r) => <span className="nowrap">{r.entityId || r.entityType || '—'}</span> },
      { label: 'Details', render: (r) => r.details || '—' },
      { label: 'IP', render: (r) => <span className="mono">{r.ip || '—'}</span> },
    ],
  },
  access: {
    label: 'Evidence access log',
    url: '/api/audit/evidence-access',
    columns: [
      { label: 'When', render: (r) => <span className="nowrap small">{fmtDateTime(r.accessedAt)}</span> },
      { label: 'User', render: (r) => r.user?.fullName },
      { label: 'Action', render: (r) => r.action },
      { label: 'Evidence', render: (r) => <><Link className="nowrap" to={`/evidence/${r.evidence?.id}`}>{r.evidence?.evidenceNumber}</Link><div className="small muted">{r.evidence?.itemName}</div></> },
      { label: 'Detail', render: (r) => r.detail || '—' },
      { label: 'IP', render: (r) => <span className="mono">{r.ip || '—'}</span> },
    ],
  },
};

const EMPTY_FILTERS = { q: '', action: '', from: '', to: '' };

export default function AuditPage() {
  const { toast, toastError } = useToast();
  const [tab, setTab] = useState('system');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [chain, setChain] = useState(null);
  const { data, error, reload } = useAsync(
    () => api.get(TABS[tab].url, { ...filters, page }),
    [tab, filters.q, filters.action, filters.from, filters.to, page],
  );

  const setFilter = (key) => (value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function verifyChain() {
    try {
      const result = await api.post('/api/audit/verify-chain');
      setChain(result);
      toast(result.valid ? 'Audit chain is intact' : 'Audit chain is broken', result.valid ? '' : 'error');
      await reload();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <>
      <PageHeader title="Audit & Access Logs" subtitle="Append-only record of system activity and evidence access">
        <button type="button" className="btn primary" onClick={verifyChain}>Verify log integrity</button>
      </PageHeader>
      {chain && (
        <div className={`notice ${chain.valid ? 'good' : 'bad'}`}>
          {chain.valid
            ? `Log integrity verified: all ${chain.checked} entries are intact.`
            : `Log integrity failure at entry ${chain.firstBrokenId}: ${chain.reason}.`}
        </div>
      )}
      <section className="panel">
        <Tabs
          tabs={Object.entries(TABS).map(([key, t]) => ({ key, label: t.label }))}
          active={tab}
          onChange={(key) => { setTab(key); setFilters(EMPTY_FILTERS); setPage(1); }}
        />
        <div className="toolbar">
          <label>Search<input type="search" value={filters.q} onChange={(e) => setFilter('q')(e.target.value)} placeholder="User, reference or detail" /></label>
          <FilterSelect label="Action" value={filters.action} onChange={setFilter('action')} items={data?.actions ?? []} />
          <label>From<input type="date" value={filters.from} onChange={(e) => setFilter('from')(e.target.value)} /></label>
          <label>To<input type="date" value={filters.to} onChange={(e) => setFilter('to')(e.target.value)} /></label>
        </div>
        {error ? <ErrorPanel error={error} /> : (
          <>
            <DataTable rows={data?.rows} columns={TABS[tab].columns} empty={data ? 'No log entries match these filters' : 'Loading…'} />
            <div className="pager">
              <span className="small muted">{data?.total ?? 0} entries · page {page} of {pages}</span>
              <div className="actions">
                <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
