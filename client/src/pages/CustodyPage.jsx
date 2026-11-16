import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Badge, DataTable, ErrorPanel, Field, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDateTime, localInputNow, localToIso } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';
import { EVIDENCE_STATUSES } from './caseOptions.js';

export default function CustodyPage() {
  const { user, can } = useAuth();
  const { toast, toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('evidence') || '';
  const [transfer, setTransfer] = useState(null);

  const { data: evidence } = useAsync(() => api.get('/api/evidence'), []);
  const { data: item, reload: reloadItem } = useAsync(() => (selectedId ? api.get(`/api/evidence/${selectedId}`) : null), [selectedId]);
  const { data: events, error, reload: reloadEvents } = useAsync(() => api.get('/api/custody'), []);

  const canTransfer = (e) => can('custody.transfer') && !['Released', 'Archived'].includes(e.status)
    && (user.role !== 'Forensic Investigator' || e.currentCustodian?.id === user.id);

  async function openTransfer() {
    const recipients = await api.get(`/api/evidence/${item.id}/recipients`);
    setTransfer({ recipients, defaultTime: localInputNow() });
  }

  return (
    <>
      <PageHeader title="Chain-of-Custody Log Tracker" subtitle="Follow each item from registration to disposition. Custody records cannot be edited or deleted." />
      <div className="stack">
        <section className="panel">
          <div className="toolbar">
            <label>Evidence item
              <select value={selectedId} onChange={(e) => setParams(e.target.value ? { evidence: e.target.value } : {})}>
                <option value="">Select an item…</option>
                {(evidence ?? []).map((e) => <option key={e.id} value={e.id}>{e.evidenceNumber}: {e.itemName}</option>)}
              </select>
            </label>
          </div>
          {!selectedId && <div className="empty">Select an evidence item to see its timeline and record a transfer.</div>}
          {selectedId && !item && <Loading />}
          {item && (
            <>
              <div className="panel-head">
                <div>
                  <strong>Current custodian: {item.currentCustodian?.fullName}</strong> <Badge label={item.status} />
                  <div className="small muted">{item.storageLocation || 'No location recorded'}</div>
                </div>
                {canTransfer(item) && <button type="button" className="btn primary" onClick={() => openTransfer().catch(toastError)}>Record transfer</button>}
              </div>
              <ol className="timeline">
                {item.custody.map((c, i) => (
                  <li key={c.id} className={i === item.custody.length - 1 ? 'current' : ''}>
                    <div><strong>{c.action}</strong>: {c.fromUser ? `${c.fromUser.fullName} → ${c.toUser?.fullName}` : c.toUser?.fullName} <Badge label={c.statusAfter} /></div>
                    <div className="small">{c.purpose}{c.location && ` · ${c.location}`}</div>
                    {c.notes && <div className="small muted">{c.notes}</div>}
                    <div className="when">{fmtDateTime(c.occurredAt)}, recorded by {c.recordedBy?.fullName}</div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
        <section className="panel">
          <h2>All custody events</h2>
          {error ? <ErrorPanel error={error} /> : (
            <DataTable
              rows={events}
              empty={events ? 'No custody events yet' : 'Loading…'}
              columns={[
                { label: 'Evidence', render: (c) => <><Link className="nowrap" to={`/evidence/${c.evidence?.id}`}>{c.evidence?.evidenceNumber}</Link><div className="small muted">{c.evidence?.case?.caseNumber}</div></> },
                { label: 'Action', render: (c) => c.action },
                { label: 'From', render: (c) => c.fromUser?.fullName || '—' },
                { label: 'To', render: (c) => c.toUser?.fullName },
                { label: 'Purpose', render: (c) => c.purpose },
                { label: 'Location', render: (c) => c.location || '—' },
                { label: 'Occurred', render: (c) => <span className="nowrap small">{fmtDateTime(c.occurredAt)}</span> },
                { label: 'Recorded by', render: (c) => c.recordedBy?.fullName },
              ]}
            />
          )}
        </section>
      </div>

      {transfer && (
        <Modal
          title={`Transfer ${item.evidenceNumber}`}
          submitLabel="Record transfer"
          onClose={() => setTransfer(null)}
          onSubmit={async (data) => {
            // The picker has minute precision; an untouched default lets the server record the exact time.
            const touched = data.get('occurredAt') !== transfer.defaultTime;
            await api.post(`/api/evidence/${item.id}/transfer`, {
              ...Object.fromEntries(data),
              occurredAt: touched ? localToIso(data.get('occurredAt')) : undefined,
            });
            toast('Transfer recorded');
            await Promise.all([reloadItem(), reloadEvents()]);
          }}
        >
          <Field
            label="Transfer to" name="toUserId" type="select" required placeholder="Select recipient…"
            items={transfer.recipients.map((u) => [u.id, `${u.fullName} (${u.role})`])}
            hint="Investigators must be assigned to this case to receive evidence."
          />
          <Field label="Purpose" name="purpose" required placeholder="e.g. Examination of disk image" maxLength={500} />
          <div className="field-row">
            <Field label="New location" name="location" required defaultValue={item.storageLocation} maxLength={200} />
            <Field label="Status after transfer" name="status" type="select" items={EVIDENCE_STATUSES} defaultValue={item.status} required />
          </div>
          <Field label="Occurred at" name="occurredAt" type="datetime-local" defaultValue={transfer.defaultTime} required />
          <Field label="Notes" name="notes" type="textarea" rows={2} />
          <small className="muted">This entry is permanent. Released and Archived are final statuses.</small>
        </Modal>
      )}
    </>
  );
}
