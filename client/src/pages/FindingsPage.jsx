import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download, saveBlob } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Badge, ErrorPanel, Field, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDateTime } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';
import { SEVERITIES } from './caseOptions.js';

export default function FindingsPage() {
  const { user, can } = useAuth();
  const { toast, toastError } = useToast();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(null); // { finding?, evidence }
  const [finalizing, setFinalizing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const { data: cases } = useAsync(() => api.get('/api/cases'), []);
  const caseId = params.get('case') || cases?.[0]?.id || '';
  const currentCase = cases?.find((c) => c.id === caseId);

  // Put the chosen case in the address bar so the page can be bookmarked or refreshed.
  useEffect(() => {
    if (cases?.length && !params.get('case')) setParams({ case: cases[0].id }, { replace: true });
  }, [cases, params, setParams]);

  const { data, error, reload } = useAsync(async () => {
    if (!caseId) return { findings: [], summaries: [] };
    const [findings, summaries] = await Promise.all([
      api.get('/api/findings', { caseId }),
      api.get('/api/findings/summaries', { caseId }),
    ]);
    return { findings, summaries };
  }, [caseId]);

  const caseOpen = currentCase?.status !== 'Closed';
  const canEdit = (f) => f.status === 'Draft' && can('finding.write') && (f.author?.id === user.id || user.role === 'Admin');

  async function openForm(finding) {
    try {
      setForm({ finding, evidence: await api.get('/api/evidence', { caseId }) });
    } catch (err) {
      toastError(err);
    }
  }

  async function generateSummary() {
    try {
      const created = await api.post('/api/findings/summaries', { caseId });
      await reload();
      setViewing(created);
    } catch (err) {
      toastError(err);
    }
  }

  const summaryFile = (s) => `${currentCase?.caseNumber ?? 'case'}-summary-v${s.version}.txt`;

  return (
    <>
      <PageHeader title="Investigation Findings & Summaries" subtitle="Record findings and generate versioned case summaries" />
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ margin: 0 }}>
          <label>Case
            <select value={caseId} onChange={(e) => setParams({ case: e.target.value })}>
              {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.caseNumber}: {c.title}</option>)}
            </select>
          </label>
          {currentCase && <Link className="btn sm" to={`/cases/${currentCase.id}`}>Open case</Link>}
        </div>
      </section>

      {error && <ErrorPanel error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="grid-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Findings</h2>
              {can('finding.write') && caseOpen && caseId && <button type="button" className="btn primary sm" onClick={() => openForm()}>Add finding</button>}
            </div>
            {data.findings.length ? (
              <div className="stack">
                {data.findings.map((f) => (
                  <article key={f.id} className="finding">
                    <header><h3>{f.title}</h3><Badge label={f.severity} /><Badge label={f.status} /></header>
                    <div className="small muted">
                      {f.author?.fullName}, {fmtDateTime(f.updatedAt)}
                      {f.evidence && <> · <Link to={`/evidence/${f.evidence.id}`}>{f.evidence.evidenceNumber}</Link></>}
                    </div>
                    <p>{f.details}</p>
                    <div className="actions">
                      {f.attachment?.originalName && can('evidence.download') && (
                        <button type="button" className="btn sm" onClick={() => download(`/api/findings/${f.id}/attachment`).catch(toastError)}>
                          Attachment: {f.attachment.originalName}
                        </button>
                      )}
                      {canEdit(f) && <button type="button" className="btn sm" onClick={() => openForm(f)}>Edit</button>}
                      {f.status === 'Draft' && can('finding.finalize') && <button type="button" className="btn sm" onClick={() => setFinalizing(f)}>Finalize</button>}
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="empty">{caseId ? 'No findings recorded for this case' : 'No cases available'}</div>}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Case summaries</h2>
              {can('summary.generate') && caseId && <button type="button" className="btn primary sm" onClick={generateSummary}>Generate summary</button>}
            </div>
            {data.summaries.length ? (
              <table><tbody>
                {data.summaries.map((s) => (
                  <tr key={s.id}>
                    <td><strong>Version {s.version}</strong><div className="small muted">{s.generatedBy?.fullName}, {fmtDateTime(s.generatedAt)}</div></td>
                    <td className="num nowrap">
                      <button type="button" className="btn sm" onClick={() => setViewing(s)}>View</button>{' '}
                      <button type="button" className="btn sm" onClick={() => saveBlob(new Blob([s.content], { type: 'text/plain;charset=utf-8' }), summaryFile(s))}>Download</button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            ) : <div className="empty">No summaries generated yet</div>}
          </section>
        </div>
      )}

      {form && (
        <Modal
          title={form.finding ? 'Edit finding' : 'Add finding'}
          wide
          onClose={() => setForm(null)}
          onSubmit={async (fd) => {
            if (form.finding) {
              await api.patch(`/api/findings/${form.finding.id}`, Object.fromEntries(fd));
            } else {
              fd.set('caseId', caseId);
              if (!fd.get('attachment')?.size) fd.delete('attachment');
              await api.post('/api/findings', fd);
            }
            toast('Finding saved');
            await reload();
          }}
        >
          <Field label="Title" name="title" defaultValue={form.finding?.title} required maxLength={200} />
          <div className="field-row">
            <Field label="Severity" name="severity" type="select" items={SEVERITIES} defaultValue={form.finding?.severity ?? 'Medium'} required />
            <Field
              label="Related evidence" name="evidenceId" type="select" placeholder="None"
              defaultValue={form.finding?.evidence?.id ?? ''} items={form.evidence.map((e) => [e.id, e.evidenceNumber])}
            />
          </div>
          <Field label="Details" name="details" type="textarea" rows={7} defaultValue={form.finding?.details} required />
          {!form.finding && <Field label="Evidence attachment" name="attachment" type="file" hint="Optional: tool output, screenshots or analyst notes. Its SHA-256 is recorded." />}
        </Modal>
      )}
      {finalizing && (
        <Modal
          title="Finalize finding"
          submitLabel="Finalize"
          onClose={() => setFinalizing(null)}
          onSubmit={async () => {
            await api.post(`/api/findings/${finalizing.id}/finalize`);
            toast('Finding finalized');
            await reload();
          }}
        >
          <p style={{ margin: 0 }}>A finalized finding is locked permanently and included in case summaries.</p>
        </Modal>
      )}
      {viewing && (
        <Modal title={`Summary version ${viewing.version}`} wide onClose={() => setViewing(null)}>
          <pre className="summary-text">{viewing.content}</pre>
        </Modal>
      )}
    </>
  );
}
