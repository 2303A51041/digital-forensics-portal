import { api, badge, field, fmtDateTime, formObject, html, localInputNow, localToIso, mount, on, openForm, options, pageHead, session, table, toast } from '../core.js';

const STATUSES = ['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived'];

export default async function custodyView(root, { query }) {
  const evidence = await api.get('/api/evidence');
  let selectedId = query.get('evidence') || '';

  mount(root, html`
    ${pageHead('Chain-of-Custody Log Tracker', 'Follow each item from registration to disposition. Custody records cannot be edited or deleted.')}
    <div class="stack">
      <section class="panel">
        <div class="toolbar"><label>Evidence item
          <select data-pick>${options(evidence.map((e) => [e.id, `${e.evidence_number}: ${e.item_name}`]), selectedId, 'Select an item…')}</select>
        </label></div>
        <div data-detail></div>
      </section>
      <section class="panel"><h2>All custody events</h2><div data-events></div></section>
    </div>`);

  const detail = root.querySelector('[data-detail]');
  const eventsBox = root.querySelector('[data-events]');
  const currentItem = () => evidence.find((e) => String(e.id) === String(selectedId));

  function canTransfer(item) {
    if (!session.can('custody.transfer') || ['Released', 'Archived'].includes(item.status)) return false;
    return session.user.role !== 'Forensic Investigator' || item.current_custodian_id === session.user.id;
  }

  async function loadEvents() {
    const rows = await api.get('/api/custody');
    mount(eventsBox, table([
      { label: 'Evidence', render: (c) => html`<a class="nowrap" href="#/evidence/${c.evidence_id}">${c.evidence_number}</a><div class="small muted">${c.case_number}</div>` },
      { label: 'Action', render: (c) => c.action },
      { label: 'From', render: (c) => c.from_name || '—' },
      { label: 'To', render: (c) => c.to_name },
      { label: 'Purpose', render: (c) => c.purpose },
      { label: 'Location', render: (c) => c.location || '—' },
      { label: 'Occurred', render: (c) => html`<span class="nowrap small">${fmtDateTime(c.occurred_at)}</span>` },
      { label: 'Recorded by', render: (c) => c.recorded_by_name },
    ], rows, 'No custody events yet'));
  }

  async function loadDetail() {
    const item = currentItem();
    if (!item) {
      mount(detail, html`<div class="empty">Select an evidence item to see its timeline and record a transfer.</div>`);
      return;
    }
    const full = await api.get(`/api/evidence/${item.id}`);
    Object.assign(item, { status: full.status, custodian: full.custodian, current_custodian_id: full.current_custodian_id });
    mount(detail, html`
      <div class="panel-head">
        <div><strong>Current custodian: ${full.custodian}</strong> ${badge(full.status)}
          <div class="small muted">${full.storage_location || 'No location recorded'}</div></div>
        ${canTransfer(full) ? html`<button class="btn primary" data-transfer>Record transfer</button>` : ''}
      </div>
      <ol class="timeline">${full.custody.map((c, i) => html`<li class="${i === full.custody.length - 1 ? 'current' : ''}">
        <div><strong>${c.action}</strong>: ${c.from_name ? html`${c.from_name} → ${c.to_name}` : c.to_name} ${badge(c.status_after)}</div>
        <div class="small">${c.purpose}${c.location ? html` · ${c.location}` : ''}</div>
        ${c.notes ? html`<div class="small muted">${c.notes}</div>` : ''}
        <div class="when">${fmtDateTime(c.occurred_at)}, recorded by ${c.recorded_by_name}</div></li>`)}</ol>`);
  }

  on(root, 'change', '[data-pick]', async (_e, el) => { selectedId = el.value; await loadDetail(); });
  on(root, 'click', '[data-transfer]', async () => {
    const item = currentItem();
    const recipients = await api.get(`/api/evidence/${item.id}/recipients`);
    const defaultTime = localInputNow();
    openForm({
      title: `Transfer ${item.evidence_number}`,
      submitLabel: 'Record transfer',
      body: html`
        ${field({ label: 'Transfer to', name: 'to_user_id', type: 'select', required: true, placeholder: 'Select recipient…', items: recipients.map((u) => [u.id, `${u.full_name} (${u.role})`]), hint: 'Investigators must be assigned to this case to receive evidence.' })}
        ${field({ label: 'Purpose', name: 'purpose', required: true, placeholder: 'e.g. Examination of disk image' })}
        <div class="field-row">
          ${field({ label: 'New location', name: 'location', required: true, value: item.storage_location })}
          ${field({ label: 'Status after transfer', name: 'status', type: 'select', items: STATUSES, value: item.status, required: true })}
        </div>
        ${field({ label: 'Occurred at', name: 'occurred_at', type: 'datetime-local', value: defaultTime, required: true })}
        ${field({ label: 'Notes', name: 'notes', type: 'textarea', rows: 2 })}
        <small class="muted">This entry is permanent. Released and Archived are final statuses.</small>`,
      onSubmit: async (data) => {
        // The picker has minute precision; an untouched default lets the server record the exact time.
        const touched = data.get('occurred_at') !== defaultTime;
        await api.post(`/api/evidence/${item.id}/transfer`, {
          ...formObject(data),
          occurred_at: touched ? localToIso(data.get('occurred_at')) : undefined,
        });
        toast('Transfer recorded');
        await Promise.all([loadDetail(), loadEvents()]);
      },
    });
  });

  await Promise.all([loadDetail(), loadEvents()]);
}
