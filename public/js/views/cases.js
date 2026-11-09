import { api, badge, field, fmtDate, fmtDateTime, formObject, html, mount, on, openForm, options, pageHead, session, table, toast } from '../core.js';

const STATUSES = ['Open', 'In Progress', 'On Hold', 'Closed'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const TYPES = ['Data Breach', 'Malware', 'Insider Threat', 'Phishing', 'Fraud', 'Intellectual Property Theft', 'Other'];

const caseFields = (c = {}) => html`
  ${field({ label: 'Title', name: 'title', value: c.title, required: true })}
  <div class="field-row">
    ${field({ label: 'Case type', name: 'case_type', type: 'select', items: TYPES, value: c.case_type ?? 'Data Breach', required: true })}
    ${field({ label: 'Priority', name: 'priority', type: 'select', items: PRIORITIES, value: c.priority ?? 'Medium', required: true })}
  </div>
  ${field({ label: 'Due date', name: 'due_date', type: 'date', value: c.due_date ?? '' })}
  ${field({ label: 'Description', name: 'description', type: 'textarea', value: c.description })}`;

export async function casesView(root) {
  const filters = { status: '', priority: '', q: '' };

  mount(root, html`
    ${pageHead('Case Management', 'Create forensic cases and assign investigators',
      session.can('case.create') ? html`<button class="btn primary" data-new>New case</button>` : '')}
    <section class="panel">
      <div class="toolbar">
        <label>Search<input data-filter="q" type="search" placeholder="Title or case number"></label>
        <label>Status<select data-filter="status">${options(STATUSES, '', 'All')}</select></label>
        <label>Priority<select data-filter="priority">${options(PRIORITIES, '', 'All')}</select></label>
      </div>
      <div data-list></div>
    </section>`);

  const list = root.querySelector('[data-list]');
  async function load() {
    const cases = await api.get('/api/cases', filters);
    mount(list, table([
      { label: 'Case No.', render: (c) => html`<a class="nowrap" href="#/cases/${c.id}">${c.case_number}</a>` },
      { label: 'Title', render: (c) => html`${c.title}<div class="small muted">${c.case_type}</div>` },
      { label: 'Priority', render: (c) => badge(c.priority) },
      { label: 'Status', render: (c) => badge(c.status) },
      { label: 'Investigators', render: (c) => c.investigators || html`<span class="muted">Unassigned</span>` },
      { label: 'Evidence', num: true, render: (c) => c.evidence_count },
      { label: 'Due', render: (c) => html`<span class="nowrap">${fmtDate(c.due_date)}</span>` },
    ], cases, 'No cases match these filters'));
  }

  on(root, 'input', '[data-filter]', async (_e, el) => { filters[el.dataset.filter] = el.value; await load(); });
  on(root, 'click', '[data-new]', () => openForm({
    title: 'New forensic case',
    submitLabel: 'Create case',
    body: caseFields(),
    onSubmit: async (data) => {
      const created = await api.post('/api/cases', formObject(data));
      toast(`Created ${created.case_number}`);
      location.hash = `#/cases/${created.id}`;
    },
  }));
  await load();
}

export async function caseDetailView(root, { id, reload }) {
  const [c, investigators] = await Promise.all([
    api.get(`/api/cases/${id}`),
    session.can('case.assign') ? api.get('/api/cases/assignable-investigators') : [],
  ]);
  const canAssign = session.can('case.assign') && c.status !== 'Closed';
  const assignedIds = new Set(c.assignments.map((a) => a.user_id));
  const available = investigators.filter((u) => !assignedIds.has(u.id));

  mount(root, html`
    ${pageHead(`${c.case_number}: ${c.title}`, html`<a href="#/cases">Back to all cases</a>`, html`
      <a class="btn" href="#/findings?case=${c.id}">Findings &amp; summaries</a>
      ${session.can('evidence.register') && c.status !== 'Closed' ? html`<a class="btn" href="#/evidence?register=${c.id}">Register evidence</a>` : ''}
      ${session.can('case.update') ? html`<button class="btn primary" data-edit>Edit case</button>` : ''}`)}
    <div class="grid-side">
      <div class="stack">
        <section class="panel"><h2>Details</h2>
          <dl class="meta">
            <dt>Status</dt><dd>${badge(c.status)}</dd>
            <dt>Priority</dt><dd>${badge(c.priority)}</dd>
            <dt>Type</dt><dd>${c.case_type}</dd>
            <dt>Opened</dt><dd>${fmtDateTime(c.opened_at)}</dd>
            <dt>Due</dt><dd>${fmtDate(c.due_date)}</dd>
            ${c.closed_at ? html`<dt>Closed</dt><dd>${fmtDateTime(c.closed_at)}</dd>` : ''}
            <dt>Description</dt><dd>${c.description || '—'}</dd>
          </dl>
        </section>
        <section class="panel"><h2>Evidence</h2>
          ${table([
            { label: 'No.', render: (e) => html`<a class="nowrap" href="#/evidence/${e.id}">${e.evidence_number}</a>` },
            { label: 'Item', render: (e) => html`${e.item_name}<div class="small muted">${e.evidence_type}</div>` },
            { label: 'Custodian', render: (e) => e.custodian },
            { label: 'Status', render: (e) => badge(e.status) },
          ], c.evidence, 'No evidence registered yet')}
        </section>
      </div>
      <section class="panel"><h2>Assigned investigators</h2>
        ${table([
          { label: 'Name', render: (a) => a.full_name },
          { label: 'Role', render: (a) => a.role_on_case },
          ...(canAssign ? [{ label: '', render: (a) => html`<button class="btn sm danger" data-remove="${a.user_id}" data-name="${a.full_name}">Remove</button>` }] : []),
        ], c.assignments, 'No investigators assigned')}
        ${canAssign ? html`<form data-assign class="stack" style="margin-top:14px">
          ${field({ label: 'Investigator', name: 'user_id', type: 'select', required: true, placeholder: available.length ? 'Select…' : 'Everyone is assigned', items: available.map((u) => [u.id, `${u.full_name} (${u.active_cases} active)`]) })}
          ${field({ label: 'Role on case', name: 'role_on_case', type: 'select', items: ['Support', 'Lead'], value: 'Support' })}
          <button class="btn primary" type="submit">Assign</button>
        </form>` : ''}
      </section>
    </div>`);

  on(root, 'click', '[data-edit]', () => openForm({
    title: `Edit ${c.case_number}`,
    body: html`${caseFields(c)}${field({ label: 'Status', name: 'status', type: 'select', items: STATUSES, value: c.status, required: true })}`,
    onSubmit: async (data) => {
      await api.patch(`/api/cases/${c.id}`, { ...formObject(data), due_date: data.get('due_date') || null });
      toast('Case updated');
      await reload();
    },
  }));
  on(root, 'submit', '[data-assign]', async (event, form) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    await api.put(`/api/cases/${c.id}/assignments`, formObject(new FormData(form)));
    toast('Investigator assigned');
    await reload();
  });
  on(root, 'click', '[data-remove]', (_e, btn) => openForm({
    title: 'Remove investigator',
    submitLabel: 'Remove',
    danger: true,
    body: html`<p style="margin:0">Remove ${btn.dataset.name} from ${c.case_number}?</p>`,
    onSubmit: async () => {
      await api.del(`/api/cases/${c.id}/assignments/${btn.dataset.remove}`);
      toast('Investigator removed');
      await reload();
    },
  }));
}
