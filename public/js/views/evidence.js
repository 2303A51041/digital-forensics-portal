import { api, badge, download, field, fmtBytes, fmtDateTime, html, localInputNow, localToIso, mount, on, openForm, options, pageHead, session, shortHash, table, toast, toastError } from '../core.js';

const STATUSES = ['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived'];
const TYPES = ['Disk Image', 'Memory Dump', 'Log File', 'Network Capture', 'Email', 'Mobile Extraction', 'Physical Device', 'Removable Media', 'Document', 'Other'];

async function openRegister(presetCase, onDone) {
  const cases = (await api.get('/api/cases')).filter((c) => c.status !== 'Closed');
  if (!cases.length) throw new Error('There are no open cases available to you');
  openForm({
    title: 'Register evidence',
    submitLabel: 'Register evidence',
    wide: true,
    body: html`
      ${field({ label: 'Case', name: 'case_id', type: 'select', required: true, value: presetCase, placeholder: 'Select a case…', items: cases.map((c) => [c.id, `${c.case_number}: ${c.title}`]) })}
      <div class="field-row">
        ${field({ label: 'Item name', name: 'item_name', required: true })}
        ${field({ label: 'Evidence type', name: 'evidence_type', type: 'select', items: TYPES, required: true, value: 'Disk Image' })}
      </div>
      ${field({ label: 'Source', name: 'source', required: true, placeholder: 'Device, host, serial number or location acquired from' })}
      <div class="field-row">
        ${field({ label: 'Collected at', name: 'collected_at', type: 'datetime-local', value: localInputNow(), required: true })}
        ${field({ label: 'Storage location', name: 'storage_location', placeholder: 'e.g. Evidence Vault A, Shelf 2' })}
      </div>
      ${field({ label: 'Description', name: 'description', type: 'textarea', rows: 3 })}
      ${field({ label: 'Evidence file', name: 'file', type: 'file', hint: 'If you upload a file, the server computes its SHA-256 and MD5. Any hash entered below must match it.' })}
      <div class="field-row">
        ${field({ label: 'SHA-256', name: 'sha256', placeholder: '64 hex characters', attrs: 'class="hash" spellcheck="false"' })}
        ${field({ label: 'MD5', name: 'md5', placeholder: '32 hex characters', attrs: 'class="hash" spellcheck="false"' })}
      </div>
      <small class="muted">For items too large to upload or physical items, skip the file and enter at least one hash from your acquisition tool.</small>`,
    onSubmit: async (data) => {
      data.set('collected_at', localToIso(data.get('collected_at')));
      if (!data.get('file')?.size) data.delete('file');
      const created = await api.post('/api/evidence', data);
      toast(`Registered ${created.evidence_number}`);
      onDone(created);
    },
  });
}

export async function evidenceView(root, { query }) {
  const filters = { q: '', status: '', case_id: '' };
  const cases = await api.get('/api/cases');

  mount(root, html`
    ${pageHead('Evidence Registration', 'Register evidence with source, hash values, timestamps and description',
      session.can('evidence.register') ? html`<button class="btn primary" data-new>Register evidence</button>` : '')}
    <section class="panel">
      <div class="toolbar">
        <label>Search<input data-filter="q" type="search" placeholder="Name, number or hash"></label>
        <label>Case<select data-filter="case_id">${options(cases.map((c) => [c.id, c.case_number]), '', 'All')}</select></label>
        <label>Status<select data-filter="status">${options(STATUSES, '', 'All')}</select></label>
      </div>
      <div data-list></div>
    </section>`);

  const list = root.querySelector('[data-list]');
  async function load() {
    const rows = await api.get('/api/evidence', filters);
    mount(list, table([
      { label: 'Evidence No.', render: (e) => html`<a class="nowrap" href="#/evidence/${e.id}">${e.evidence_number}</a>` },
      { label: 'Item', render: (e) => html`${e.item_name}<div class="small muted">${e.evidence_type}</div>` },
      { label: 'Case', render: (e) => html`<a class="nowrap" href="#/cases/${e.case_id}">${e.case_number}</a>` },
      { label: 'Source', render: (e) => e.source },
      { label: 'Hash', render: shortHash },
      { label: 'Collected', render: (e) => html`<span class="nowrap small">${fmtDateTime(e.collected_at)}</span>` },
      { label: 'Custodian', render: (e) => e.custodian },
      { label: 'Status', render: (e) => badge(e.status) },
    ], rows, 'No evidence matches these filters'));
  }

  on(root, 'input', '[data-filter]', async (_e, el) => { filters[el.dataset.filter] = el.value; await load(); });
  on(root, 'click', '[data-new]', () => openRegister('', (e) => { location.hash = `#/evidence/${e.id}`; }));
  await load();
  if (query.get('register')) {
    openRegister(query.get('register'), (e) => { location.hash = `#/evidence/${e.id}`; }).catch(toastError);
  }
}

export async function evidenceDetailView(root, { id, reload }) {
  const e = await api.get(`/api/evidence/${id}`);
  const canVerifyStored = Boolean(e.file_storage_name);

  mount(root, html`
    ${pageHead(`${e.evidence_number}: ${e.item_name}`, html`<a href="#/evidence">Back to evidence</a>`, html`
      ${e.file_storage_name && session.can('evidence.download') ? html`<button class="btn" data-download>Download file</button>` : ''}
      <a class="btn" href="#/custody?evidence=${e.id}">Chain of custody</a>
      ${session.can('evidence.verify') ? html`<button class="btn primary" data-verify>Verify integrity</button>` : ''}`)}
    <div data-result></div>
    <div class="grid-side">
      <div class="stack">
        <section class="panel"><h2>Metadata</h2>
          <dl class="meta">
            <dt>Case</dt><dd><a href="#/cases/${e.case_id}">${e.case_number}</a>: ${e.case_title}</dd>
            <dt>Type</dt><dd>${e.evidence_type}</dd>
            <dt>Source</dt><dd>${e.source}</dd>
            <dt>Description</dt><dd>${e.description || '—'}</dd>
            <dt>Collected</dt><dd>${fmtDateTime(e.collected_at)}</dd>
            <dt>Registered</dt><dd>${fmtDateTime(e.registered_at)} by ${e.registered_by_name}</dd>
            <dt>Status</dt><dd>${badge(e.status)}</dd>
            <dt>Custodian</dt><dd>${e.custodian}</dd>
            <dt>Location</dt><dd>${e.storage_location || '—'}</dd>
            <dt>File</dt><dd>${e.original_filename ? html`${e.original_filename} (${fmtBytes(e.file_size)})` : 'No file stored (metadata record)'}</dd>
          </dl>
        </section>
        <section class="panel"><h2>Integrity</h2>
          <dl class="meta">
            <dt>SHA-256</dt><dd class="hash">${e.sha256 || '—'}</dd>
            <dt>MD5</dt><dd class="hash">${e.md5 || '—'}</dd>
            <dt>Hash origin</dt><dd>${badge(e.hash_origin)}</dd>
            <dt>Last verified</dt><dd>${e.last_verified_at ? html`${badge(e.last_verify_result)} ${fmtDateTime(e.last_verified_at)}` : 'Never'}</dd>
          </dl>
        </section>
        ${e.access_log ? html`<section class="panel"><h2>Access log</h2>
          ${table([
            { label: 'When', render: (l) => html`<span class="nowrap small">${fmtDateTime(l.accessed_at)}</span>` },
            { label: 'User', render: (l) => l.full_name },
            { label: 'Action', render: (l) => l.action },
            { label: 'Detail', render: (l) => l.detail },
          ], e.access_log)}
        </section>` : ''}
      </div>
      <section class="panel"><h2>Custody history</h2>
        <ol class="timeline">${e.custody.map((c, i) => html`<li class="${i === e.custody.length - 1 ? 'current' : ''}">
          <div>${c.from_name ? html`${c.from_name} → ${c.to_name}` : html`Registered, held by ${c.to_name}`}</div>
          <div class="small">${c.purpose}${c.location ? html` · ${c.location}` : ''}</div>
          <div class="when">${fmtDateTime(c.occurred_at)}</div></li>`)}</ol>
      </section>
    </div>`);

  on(root, 'click', '[data-download]', () => download(`/api/evidence/${e.id}/download`, e.original_filename));

  async function showResult(result) {
    await reload();
    toast(`Integrity check: ${result.result}`, result.result === 'Match' ? '' : 'error');
  }
  on(root, 'click', '[data-verify]', async () => {
    if (canVerifyStored) {
      await showResult(await api.post(`/api/evidence/${e.id}/verify`));
      return;
    }
    openForm({
      title: 'Verify against original file',
      submitLabel: 'Compare hashes',
      body: html`<p style="margin:0">No file is stored for this item. Choose the original file to hash and compare with the registered value.</p>
        ${field({ label: 'File', name: 'file', type: 'file', required: true })}`,
      onSubmit: async (data) => { await showResult(await api.post(`/api/evidence/${e.id}/verify`, data)); },
    });
  });
}
