import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Badge, DataTable, ErrorPanel, Field, FilterSelect, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDate } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';
import { CASE_STATUSES, CASE_TYPES, PRIORITIES } from './caseOptions.js';

/** Fields shared by the "new case" and "edit case" forms. */
export function CaseFields({ value = {} }) {
  return (
    <>
      <Field label="Title" name="title" defaultValue={value.title} required maxLength={200} />
      <div className="field-row">
        <Field label="Case type" name="caseType" type="select" items={CASE_TYPES} defaultValue={value.caseType ?? 'Data Breach'} required />
        <Field label="Priority" name="priority" type="select" items={PRIORITIES} defaultValue={value.priority ?? 'Medium'} required />
      </div>
      <Field label="Due date" name="dueDate" type="date" defaultValue={value.dueDate ?? ''} />
      <Field label="Description" name="description" type="textarea" defaultValue={value.description} />
    </>
  );
}

export default function CasesPage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', priority: '' });
  const [creating, setCreating] = useState(false);
  const { data: cases, error } = useAsync(() => api.get('/api/cases', filters), [filters.q, filters.status, filters.priority]);
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <>
      <PageHeader title="Case Management" subtitle="Create forensic cases and assign investigators">
        {can('case.create') && <button type="button" className="btn primary" onClick={() => setCreating(true)}>New case</button>}
      </PageHeader>
      <section className="panel">
        <div className="toolbar">
          <label>Search<input type="search" value={filters.q} onChange={(e) => set('q')(e.target.value)} placeholder="Title or case number" /></label>
          <FilterSelect label="Status" value={filters.status} onChange={set('status')} items={CASE_STATUSES} />
          <FilterSelect label="Priority" value={filters.priority} onChange={set('priority')} items={PRIORITIES} />
        </div>
        {error ? <ErrorPanel error={error} /> : (
          <DataTable
            rows={cases}
            empty={cases ? 'No cases match these filters' : 'Loading…'}
            columns={[
              { label: 'Case No.', render: (c) => <Link className="nowrap" to={`/cases/${c.id}`}>{c.caseNumber}</Link> },
              { label: 'Title', render: (c) => <>{c.title}<div className="small muted">{c.caseType}</div></> },
              { label: 'Priority', render: (c) => <Badge label={c.priority} /> },
              { label: 'Status', render: (c) => <Badge label={c.status} /> },
              { label: 'Investigators', render: (c) => c.investigators || <span className="muted">Unassigned</span> },
              { label: 'Evidence', num: true, render: (c) => c.evidenceCount },
              { label: 'Due', render: (c) => <span className="nowrap">{fmtDate(c.dueDate)}</span> },
            ]}
          />
        )}
      </section>

      {creating && (
        <Modal
          title="New forensic case"
          submitLabel="Create case"
          onClose={() => setCreating(false)}
          onSubmit={async (data) => {
            const created = await api.post('/api/cases', Object.fromEntries(data));
            toast(`Created ${created.caseNumber}`);
            navigate(`/cases/${created.id}`);
          }}
        >
          <CaseFields />
        </Modal>
      )}
    </>
  );
}
