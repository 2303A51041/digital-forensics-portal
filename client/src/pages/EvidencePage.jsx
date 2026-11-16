import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, DataTable, ErrorPanel, FilterSelect, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDateTime, shortHash } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';
import { EVIDENCE_STATUSES } from './caseOptions.js';
import RegisterEvidenceModal from './RegisterEvidenceModal.jsx';

export default function EvidencePage() {
  const { can } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', caseId: '', status: '' });
  const [registering, setRegistering] = useState(null);
  const { data: cases } = useAsync(() => api.get('/api/cases'), []);
  const { data: rows, error } = useAsync(() => api.get('/api/evidence', filters), [filters.q, filters.caseId, filters.status]);
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

  const openCases = (cases ?? []).filter((c) => c.status !== 'Closed');

  function openRegister(caseId = '') {
    if (!openCases.length) toast('There are no open cases available to you', 'error');
    else setRegistering({ caseId });
  }

  // "Register evidence" on a case page opens this form with that case already chosen.
  const preset = params.get('register');
  useEffect(() => {
    if (!preset || !cases) return;
    setParams({}, { replace: true });
    if (can('evidence.register')) openRegister(preset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, cases]);

  return (
    <>
      <PageHeader title="Evidence Registration" subtitle="Register evidence with source, hash values, timestamps and description">
        {can('evidence.register') && <button type="button" className="btn primary" onClick={() => openRegister()}>Register evidence</button>}
      </PageHeader>
      <section className="panel">
        <div className="toolbar">
          <label>Search<input type="search" value={filters.q} onChange={(e) => set('q')(e.target.value)} placeholder="Name, number or hash" /></label>
          <FilterSelect label="Case" value={filters.caseId} onChange={set('caseId')} items={(cases ?? []).map((c) => [c.id, c.caseNumber])} />
          <FilterSelect label="Status" value={filters.status} onChange={set('status')} items={EVIDENCE_STATUSES} />
        </div>
        {error ? <ErrorPanel error={error} /> : (
          <DataTable
            rows={rows}
            empty={rows ? 'No evidence matches these filters' : 'Loading…'}
            columns={[
              { label: 'Evidence No.', render: (e) => <Link className="nowrap" to={`/evidence/${e.id}`}>{e.evidenceNumber}</Link> },
              { label: 'Item', render: (e) => <>{e.itemName}<div className="small muted">{e.evidenceType}</div></> },
              { label: 'Case', render: (e) => <Link className="nowrap" to={`/cases/${e.case?.id}`}>{e.case?.caseNumber}</Link> },
              { label: 'Source', render: (e) => e.source },
              { label: 'Hash', render: (e) => <span className="hash nowrap">{shortHash(e)}</span> },
              { label: 'Collected', render: (e) => <span className="nowrap small">{fmtDateTime(e.collectedAt)}</span> },
              { label: 'Custodian', render: (e) => e.currentCustodian?.fullName },
              { label: 'Status', render: (e) => <Badge label={e.status} /> },
            ]}
          />
        )}
      </section>

      {registering && (
        <RegisterEvidenceModal
          cases={openCases}
          presetCaseId={registering.caseId}
          onClose={() => setRegistering(null)}
          onRegistered={(created) => {
            toast(`Registered ${created.evidenceNumber}`);
            navigate(`/evidence/${created.id}`);
          }}
        />
      )}
    </>
  );
}
