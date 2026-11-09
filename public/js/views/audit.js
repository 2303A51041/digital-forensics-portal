import { api, fmtDateTime, html, mount, on, options, pageHead, table, toast } from '../core.js';

const TABS = {
  system: {
    url: '/api/audit/logs',
    label: 'System audit log',
    columns: [
      { label: 'When', render: (r) => html`<span class="nowrap small">${fmtDateTime(r.occurred_at)}</span>` },
      { label: 'User', render: (r) => html`${r.username}<div class="small muted">${r.role}</div>` },
      { label: 'Action', render: (r) => html`<span class="mono">${r.action}</span>` },
      { label: 'Entity', render: (r) => html`<span class="nowrap">${r.entity_id || r.entity_type || '—'}</span>` },
      { label: 'Details', render: (r) => r.details || '—' },
      { label: 'IP', render: (r) => html`<span class="mono">${r.ip_address || '—'}</span>` },
    ],
  },
  access: {
    url: '/api/audit/evidence-access',
    label: 'Evidence access log',
    columns: [
      { label: 'When', render: (r) => html`<span class="nowrap small">${fmtDateTime(r.accessed_at)}</span>` },
      { label: 'User', render: (r) => r.full_name },
      { label: 'Action', render: (r) => r.action },
      { label: 'Evidence', render: (r) => html`<a class="nowrap" href="#/evidence/${r.evidence_id}">${r.evidence_number}</a><div class="small muted">${r.item_name}</div>` },
      { label: 'Detail', render: (r) => r.detail || '—' },
      { label: 'IP', render: (r) => html`<span class="mono">${r.ip_address || '—'}</span>` },
    ],
  },
};

export default async function auditView(root) {
  let tab = 'system';
  let params = {};
  let page = 1;

  mount(root, html`
    ${pageHead('Audit & Access Logs', 'Append-only record of system activity and evidence access', html`<button class="btn primary" data-chain>Verify log integrity</button>`)}
    <div data-chain-result></div>
    <section class="panel">
      <div class="tabs" role="tablist">${Object.entries(TABS).map(([key, t]) => html`<button role="tab" class="${key === tab ? 'active' : ''}" data-tab="${key}">${t.label}</button>`)}</div>
      <div class="toolbar">
        <label>Search<input type="search" data-param="q" placeholder="User, reference or detail"></label>
        <label>Action<select data-param="action" data-actions></select></label>
        <label>From<input type="date" data-param="from"></label>
        <label>To<input type="date" data-param="to"></label>
      </div>
      <div data-rows></div>
    </section>`);

  const rowsBox = root.querySelector('[data-rows]');
  const actionSelect = root.querySelector('[data-actions]');

  async function load() {
    const data = await api.get(TABS[tab].url, { ...params, page });
    const selected = params.action ?? '';
    mount(actionSelect, options(data.actions, selected, 'All'));
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    mount(rowsBox, html`
      ${table(TABS[tab].columns, data.rows, 'No log entries match these filters')}
      <div class="pager">
        <span class="small muted">${data.total} entries · page ${data.page} of ${pages}</span>
        <div class="actions">
          <button class="btn sm" data-page="${page - 1}" ${page <= 1 ? html`disabled` : ''}>Previous</button>
          <button class="btn sm" data-page="${page + 1}" ${page >= pages ? html`disabled` : ''}>Next</button>
        </div>
      </div>`);
  }

  on(root, 'click', '[data-tab]', async (_e, btn) => {
    tab = btn.dataset.tab;
    params = {};
    page = 1;
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    root.querySelectorAll('[data-param]').forEach((el) => { el.value = ''; });
    await load();
  });
  on(root, 'input', '[data-param]', async (_e, el) => {
    params[el.dataset.param] = el.value;
    page = 1;
    await load();
  });
  on(root, 'click', '[data-page]', async (_e, btn) => { page = Number(btn.dataset.page); await load(); });
  on(root, 'click', '[data-chain]', async () => {
    const result = await api.post('/api/audit/verify-chain');
    mount(root.querySelector('[data-chain-result]'), result.valid
      ? html`<div class="notice good">Log integrity verified: all ${result.checked} entries are intact.</div>`
      : html`<div class="notice bad">Log integrity failure at entry ${result.firstBrokenId}: ${result.reason}.</div>`);
    toast(result.valid ? 'Audit chain is intact' : 'Audit chain is broken', result.valid ? '' : 'error');
    await load();
  });

  await load();
}
