import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Badge, DataTable, ErrorPanel, Field, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDate, fmtDateTime } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';
import { CASE_STATUSES } from './caseOptions.js';
import { CaseFields } from './CasesPage.jsx';

export default function CaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { toast, toastError } = useToast();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(null);
  const { data, error, reload } = useAsync(async () => {
    const [c, investigators] = await Promise.all([
      api.get(`/api/cases/${id}`),
      can('case.assign') ? api.get('/api/cases/assignable-investigators') : [],
    ]);
    return { c, investigators };
  }, [id]);

  if (error) return <ErrorPanel error={error} />;
  if (!data) return <Loading />;
  const { c, investigators } = data;
  const canAssign = can('case.assign') && c.status !== 'Closed';
  const assigned = new Set(c.assignments.map((a) => a.user?.id));
  const available = investigators.filter((u) => !assigned.has(u.id));

  async function assign(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api.put(`/api/cases/${c.id}/assignments`, Object.fromEntries(new FormData(form)));
      toast('Investigator assigned');
      form.reset();
      await reload();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <>
      <PageHeader title={`${c.caseNumber}: ${c.title}`} subtitle={<Link to="/cases">Back to all cases</Link>}>
        <Link className="btn" to={`/findings?case=${c.id}`}>Findings &amp; summaries</Link>
        {can('evidence.register') && c.status !== 'Closed' && <Link className="btn" to={`/evidence?register=${c.id}`}>Register evidence</Link>}
        {can('case.update') && <button type="button" className="btn primary" onClick={() => setEditing(true)}>Edit case</button>}
      </PageHeader>
      <div className="grid-side">
        <div className="stack">
          <section className="panel">
            <h2>Details</h2>
            <dl className="meta">
              <dt>Status</dt><dd><Badge label={c.status} /></dd>
              <dt>Priority</dt><dd><Badge label={c.priority} /></dd>
              <dt>Type</dt><dd>{c.caseType}</dd>
              <dt>Lead investigator</dt><dd>{c.leadInvestigator?.fullName ?? '—'}</dd>
              <dt>Opened</dt><dd>{fmtDateTime(c.openedAt)}</dd>
              <dt>Due</dt><dd>{fmtDate(c.dueDate)}</dd>
              {c.closedAt && <><dt>Closed</dt><dd>{fmtDateTime(c.closedAt)}</dd></>}
              <dt>Description</dt><dd>{c.description || '—'}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Evidence</h2>
            <DataTable
              rows={c.evidence}
              empty="No evidence registered yet"
              columns={[
                { label: 'No.', render: (e) => <Link className="nowrap" to={`/evidence/${e.id}`}>{e.evidenceNumber}</Link> },
                { label: 'Item', render: (e) => <>{e.itemName}<div className="small muted">{e.evidenceType}</div></> },
                { label: 'Custodian', render: (e) => e.currentCustodian?.fullName },
                { label: 'Status', render: (e) => <Badge label={e.status} /> },
              ]}
            />
          </section>
        </div>
        <section className="panel">
          <h2>Assigned investigators</h2>
          <DataTable
            rows={c.assignments}
            rowKey={(a) => a.user?.id}
            empty="No investigators assigned"
            columns={[
              { label: 'Name', render: (a) => a.user?.fullName },
              { label: 'Role', render: (a) => a.roleOnCase },
              ...(canAssign ? [{ label: '', render: (a) => <button type="button" className="btn sm danger" onClick={() => setRemoving(a.user)}>Remove</button> }] : []),
            ]}
          />
          {canAssign && (
            <form className="stack" style={{ marginTop: 14 }} onSubmit={assign}>
              <Field
                label="Investigator" name="userId" type="select" required
                placeholder={available.length ? 'Select…' : 'Everyone is assigned'}
                items={available.map((u) => [u.id, `${u.fullName} (${u.activeCases} active)`])}
              />
              <Field label="Role on case" name="roleOnCase" type="select" items={['Support', 'Lead']} defaultValue="Support" />
              <button className="btn primary" type="submit">Assign</button>
            </form>
          )}
        </section>
      </div>

      {editing && (
        <Modal
          title={`Edit ${c.caseNumber}`}
          onClose={() => setEditing(false)}
          onSubmit={async (form) => {
            await api.patch(`/api/cases/${c.id}`, { ...Object.fromEntries(form), dueDate: form.get('dueDate') || null });
            toast('Case updated');
            await reload();
          }}
        >
          <CaseFields value={c} />
          <Field label="Status" name="status" type="select" items={CASE_STATUSES} defaultValue={c.status} required />
        </Modal>
      )}
      {removing && (
        <Modal
          title="Remove investigator"
          submitLabel="Remove"
          danger
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            await api.del(`/api/cases/${c.id}/assignments/${removing.id}`);
            toast('Investigator removed');
            await reload();
          }}
        >
          <p style={{ margin: 0 }}>Remove {removing.fullName} from {c.caseNumber}?</p>
        </Modal>
      )}
    </>
  );
}
