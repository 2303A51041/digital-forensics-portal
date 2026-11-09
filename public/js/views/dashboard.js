import { api, badge, bars, fmtDate, fmtDateTime, html, mount, pageHead, session, table } from '../core.js';

const inOrder = (rows, order) => order.map((label) => ({ label, value: rows.find((r) => r.label === label)?.value ?? 0 }));

export default async function dashboardView(root) {
  const d = await api.get('/api/dashboard');
  const s = d.stats;
  const tiles = [
    ['Active cases', s.active_cases, '#/cases', false],
    ['Overdue cases', s.overdue_cases, '#/cases', s.overdue_cases > 0],
    ['Evidence items', s.evidence_items, '#/evidence', false],
    ['Integrity failures', s.integrity_failures, '#/evidence', s.integrity_failures > 0],
    ['Transfers, last 7 days', s.transfers_7d, '#/custody', false],
    ['Draft findings', s.draft_findings, '#/findings', false],
  ];

  mount(root, html`
    ${pageHead('Dashboard', session.can('case.viewAll') ? 'Overview of all forensic casework' : 'Overview of your assigned cases')}
    <div class="stats">${tiles.map(([label, value, href, alert]) => html`
      <a class="stat ${alert ? 'alert' : ''}" href="${href}"><b>${value}</b><span>${label}</span></a>`)}</div>
    <div class="stack">
      <div class="${d.workload ? 'grid-3' : 'grid-2'}">
        <section class="panel"><h2>Cases by status</h2>${bars(inOrder(d.cases_by_status, ['Open', 'In Progress', 'On Hold', 'Closed']))}</section>
        <section class="panel"><h2>Evidence by status</h2>${bars(inOrder(d.evidence_by_status, ['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived']))}</section>
        ${d.workload ? html`<section class="panel"><h2>Active cases per investigator</h2>${bars(d.workload)}</section>` : ''}
      </div>
      <div class="grid-2">
        <section class="panel"><h2>Upcoming deadlines</h2>
          ${table([
            { label: 'Case', render: (c) => html`<a href="#/cases/${c.id}">${c.case_number}</a><div class="small muted">${c.title}</div>` },
            { label: 'Priority', render: (c) => badge(c.priority) },
            { label: 'Due', render: (c) => html`<span class="nowrap">${fmtDate(c.due_date)}</span>` },
          ], d.deadlines, 'No upcoming deadlines')}
        </section>
        <section class="panel"><h2>Recent custody activity</h2>
          ${table([
            { label: 'Evidence', render: (e) => html`<span class="nowrap">${e.evidence_number}</span>` },
            { label: 'Movement', render: (e) => (e.from_name ? html`${e.from_name} → ${e.to_name}` : html`Registered by ${e.to_name}`) },
            { label: 'When', render: (e) => html`<span class="nowrap small">${fmtDateTime(e.occurred_at)}</span>` },
          ], d.recent_custody, 'No custody activity yet')}
        </section>
      </div>
    </div>`);
}
