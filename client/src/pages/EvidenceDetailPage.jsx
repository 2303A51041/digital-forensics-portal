import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Badge, DataTable, ErrorPanel, Field, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtBytes, fmtDateTime } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';

export default function EvidenceDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { toast, toastError } = useToast();
  const [verifyWithFile, setVerifyWithFile] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const { data: e, error, reload } = useAsync(() => api.get(`/api/evidence/${id}`), [id]);

  if (error) return <ErrorPanel error={error} />;
  if (!e) return <Loading />;

  async function showResult(result) {
    setLastCheck(result);
    await reload();
    toast(`Integrity check: ${result.result}`, result.result === 'Match' ? '' : 'error');
  }

  async function verify() {
    if (!e.hasFile) return setVerifyWithFile(true);
    try {
      await showResult(await api.post(`/api/evidence/${e.id}/verify`));
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <>
      <PageHeader title={`${e.evidenceNumber}: ${e.itemName}`} subtitle={<Link to="/evidence">Back to evidence</Link>}>
        {e.hasFile && can('evidence.download') && (
          <button type="button" className="btn" onClick={() => download(`/api/evidence/${e.id}/download`).catch(toastError)}>Download file</button>
        )}
        <Link className="btn" to={`/custody?evidence=${e.id}`}>Chain of custody</Link>
        {can('evidence.verify') && <button type="button" className="btn primary" onClick={verify}>Verify integrity</button>}
      </PageHeader>

      {lastCheck && (
        <div className={`notice ${lastCheck.result === 'Match' ? 'good' : 'bad'}`}>
          {lastCheck.result === 'Match'
            ? `Integrity verified (${lastCheck.basis.toLowerCase()}): the file matches its registered hash values.`
            : `Integrity FAILURE (${lastCheck.basis.toLowerCase()}): the file does not match its registered hash values.`}
        </div>
      )}

      <div className="grid-side">
        <div className="stack">
          <section className="panel">
            <h2>Metadata</h2>
            <dl className="meta">
              <dt>Case</dt><dd><Link to={`/cases/${e.case?.id}`}>{e.case?.caseNumber}</Link>: {e.case?.title}</dd>
              <dt>Type</dt><dd>{e.evidenceType}</dd>
              <dt>Source</dt><dd>{e.source}</dd>
              <dt>Description</dt><dd>{e.description || '—'}</dd>
              <dt>Collected</dt><dd>{fmtDateTime(e.collectedAt)}</dd>
              <dt>Registered</dt><dd>{fmtDateTime(e.registeredAt)} by {e.registeredBy?.fullName}</dd>
              <dt>Status</dt><dd><Badge label={e.status} /></dd>
              <dt>Custodian</dt><dd>{e.currentCustodian?.fullName}</dd>
              <dt>Location</dt><dd>{e.storageLocation || '—'}</dd>
              <dt>File</dt><dd>{e.file?.originalName ? `${e.file.originalName} (${fmtBytes(e.file.size)})` : 'No file stored (metadata record)'}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Integrity</h2>
            <dl className="meta">
              <dt>SHA-256</dt><dd className="hash">{e.sha256 || '—'}</dd>
              <dt>MD5</dt><dd className="hash">{e.md5 || '—'}</dd>
              <dt>Hash origin</dt><dd><Badge label={e.hashOrigin} /></dd>
              <dt>Last verified</dt><dd>{e.lastVerifiedAt ? <><Badge label={e.lastVerifyResult} /> {fmtDateTime(e.lastVerifiedAt)}</> : 'Never'}</dd>
            </dl>
          </section>
          {e.accessLog && (
            <section className="panel">
              <h2>Access log</h2>
              <DataTable
                rows={e.accessLog}
                columns={[
                  { label: 'When', render: (l) => <span className="nowrap small">{fmtDateTime(l.accessedAt)}</span> },
                  { label: 'User', render: (l) => l.user?.fullName },
                  { label: 'Action', render: (l) => l.action },
                  { label: 'Detail', render: (l) => l.detail },
                ]}
              />
            </section>
          )}
        </div>
        <section className="panel">
          <h2>Custody history</h2>
          <ol className="timeline">
            {e.custody.map((c, i) => (
              <li key={c.id} className={i === e.custody.length - 1 ? 'current' : ''}>
                <div>{c.fromUser ? `${c.fromUser.fullName} → ${c.toUser?.fullName}` : `Registered, held by ${c.toUser?.fullName}`}</div>
                <div className="small">{c.purpose}{c.location && ` · ${c.location}`}</div>
                <div className="when">{fmtDateTime(c.occurredAt)}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {verifyWithFile && (
        <Modal
          title="Verify against original file"
          submitLabel="Compare hashes"
          onClose={() => setVerifyWithFile(false)}
          onSubmit={async (data) => showResult(await api.post(`/api/evidence/${e.id}/verify`, data))}
        >
          <p style={{ margin: 0 }}>No file is stored for this item. Choose the original file to hash and compare with the registered value.</p>
          <Field label="File" name="file" type="file" required />
        </Modal>
      )}
    </>
  );
}
