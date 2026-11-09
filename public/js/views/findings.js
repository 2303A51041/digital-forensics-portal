import { api, badge, download, field, fmtDateTime, formObject, html, mount, on, openForm, options, pageHead, saveBlob, session, toast } from '../core.js';

const SEVERITIES = ['Info', 'Low', 'Medium', 'High', 'Critical'];

export default async function findingsView(root, { query }) {
  const cases = await api.get('/api/cases');
  let caseId = query.get('case') || (cases[0]?.id ?? '');
  let findings = [];
  let summaries = [];

  mount(root, html`
    ${pageHead('Investigation Findings & Summaries', 'Record findings and generate versioned case summaries')}
    <section class="panel" style="margin-bottom:16px"><div class="toolbar" style="margin:0"><label>Case
      <select data-case>${options(cases.map((c) => [c.id, `${c.case_number}: ${c.title}`]), caseId)}</select></label></div></section>
    <div class="grid-side">
      <section class="panel"><div data-findings></div></section>
      <section class="panel"><div data-summaries></div></section>
    </div>`);

  const findingsBox = root.querySelector('[data-findings]');
  const summariesBox = root.querySelector('[data-summaries]');
  const currentCase = () => cases.find((c) => String(c.id) === String(caseId));

  const canEdit = (f) => f.status === 'Draft' && session.can('finding.write') && (f.author_id === session.user.id || session.user.role === 'Admin');

  function renderFindings() {
    const open = currentCase()?.status !== 'Closed';
    mount(findingsBox, html`
      <div class="panel-head"><h2>Findings</h2>${session.can('finding.write') && open && caseId ? html`<button class="btn primary sm" data-new>Add finding</button>` : ''}</div>
      ${findings.length ? html`<div class="stack">${findings.map((f) => html`<article class="finding">
        <header><h3>${f.title}</h3>${badge(f.severity)}${badge(f.status)}</header>
        <div class="small muted">${f.author}, ${fmtDateTime(f.updated_at)}${f.evidence_number ? html` · <a href="#/evidence/${f.evidence_id}">${f.evidence_number}</a>` : ''}</div>
        <p>${f.details}</p>
        <div class="actions">
          ${f.attachment_filename && session.can('evidence.download') ? html`<button class="btn sm" data-attachment="${f.id}" data-name="${f.attachment_filename}">${f.attachment_filename}</button>` : ''}
          ${canEdit(f) ? html`<button class="btn sm" data-edit="${f.id}">Edit</button>` : ''}
          ${f.status === 'Draft' && session.can('finding.finalize') ? html`<button class="btn sm" data-finalize="${f.id}">Finalize</button>` : ''}
        </div></article>`)}</div>` : html`<div class="empty">${caseId ? 'No findings recorded for this case' : 'No cases available'}</div>`}`);
  }

  function renderSummaries() {
    mount(summariesBox, html`
      <div class="panel-head"><h2>Case summaries</h2>${session.can('summary.generate') && caseId ? html`<button class="btn primary sm" data-generate>Generate summary</button>` : ''}</div>
      ${summaries.length ? html`<table><tbody>${summaries.map((s) => html`<tr>
        <td><strong>Version ${s.version}</strong><div class="small muted">${s.generated_by_name}, ${fmtDateTime(s.generated_at)}</div></td>
        <td class="num nowrap"><button class="btn sm" data-view="${s.id}">View</button> <button class="btn sm" data-save="${s.id}">Download</button></td>
      </tr>`)}</tbody></table>` : html`<div class="empty">No summaries generated yet</div>`}`);
  }

  async function load() {
    if (!caseId) { renderFindings(); renderSummaries(); return; }
    [findings, summaries] = await Promise.all([
      api.get('/api/findings', { case_id: caseId }),
      api.get('/api/findings/summaries', { case_id: caseId }),
    ]);
    renderFindings();
    renderSummaries();
  }

  async function findingForm(existing) {
    const evidence = await api.get('/api/evidence', { case_id: caseId });
    const body = html`
      ${field({ label: 'Title', name: 'title', value: existing?.title, required: true })}
      <div class="field-row">
        ${field({ label: 'Severity', name: 'severity', type: 'select', items: SEVERITIES, value: existing?.severity ?? 'Medium', required: true })}
        ${field({ label: 'Related evidence', name: 'evidence_id', type: 'select', value: existing?.evidence_id ?? '', placeholder: 'None', items: evidence.map((e) => [e.id, e.evidence_number]) })}
      </div>
      ${field({ label: 'Details', name: 'details', type: 'textarea', rows: 7, value: existing?.details, required: true })}
      ${existing ? '' : field({ label: 'Attachment', name: 'attachment', type: 'file', hint: 'Optional: tool output, screenshots or analyst notes.' })}`;
    openForm({
      title: existing ? 'Edit finding' : 'Add finding',
      wide: true,
      body,
      onSubmit: async (data) => {
        if (existing) {
          await api.patch(`/api/findings/${existing.id}`, formObject(data));
        } else {
          data.set('case_id', caseId);
          if (!data.get('attachment')?.size) data.delete('attachment');
          await api.post('/api/findings', data);
        }
        toast('Finding saved');
        await load();
      },
    });
  }

  const findSummary = (sid) => summaries.find((s) => String(s.id) === String(sid));
  const summaryFile = (s) => `${currentCase()?.case_number ?? 'case'}-summary-v${s.version}.txt`;
  const viewSummary = (s) => openForm({
    title: `Summary version ${s.version}`,
    wide: true,
    body: html`<pre class="summary-text">${s.content}</pre>`,
  });

  on(root, 'change', '[data-case]', async (_e, el) => { caseId = el.value; await load(); });
  on(root, 'click', '[data-new]', () => findingForm());
  on(root, 'click', '[data-edit]', (_e, b) => findingForm(findings.find((f) => String(f.id) === b.dataset.edit)));
  on(root, 'click', '[data-attachment]', (_e, b) => download(`/api/findings/${b.dataset.attachment}/attachment`, b.dataset.name));
  on(root, 'click', '[data-finalize]', (_e, b) => openForm({
    title: 'Finalize finding',
    submitLabel: 'Finalize',
    body: html`<p style="margin:0">A finalized finding is locked permanently and included in case summaries.</p>`,
    onSubmit: async () => {
      await api.post(`/api/findings/${b.dataset.finalize}/finalize`);
      toast('Finding finalized');
      await load();
    },
  }));
  on(root, 'click', '[data-generate]', async () => {
    const created = await api.post('/api/findings/summaries', { case_id: caseId });
    await load();
    viewSummary(created);
  });
  on(root, 'click', '[data-view]', (_e, b) => viewSummary(findSummary(b.dataset.view)));
  on(root, 'click', '[data-save]', (_e, b) => {
    const s = findSummary(b.dataset.save);
    saveBlob(new Blob([s.content], { type: 'text/plain;charset=utf-8' }), summaryFile(s));
  });

  await load();
}
