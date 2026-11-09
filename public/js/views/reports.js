import { api, download, fmtDateTime, html, mount, on, options, pageHead } from '../core.js';

const REPORTS = [
  { type: 'case-status', label: 'Case Status', filters: ['status', 'priority', 'dates'] },
  { type: 'evidence-register', label: 'Evidence Register', filters: ['case', 'evidenceStatus', 'dates'] },
  { type: 'investigator-workload', label: 'Investigator Workload', filters: [] },
  { type: 'chain-of-custody', label: 'Chain of Custody', filters: ['case', 'dates'] },
];

const HASH_COLUMNS = new Set(['sha256', 'md5']);
const TIME_COLUMNS = new Set(['collected_at', 'registered_at', 'occurred_at']);
const NUMERIC = (value) => typeof value === 'number';

export default async function reportsView(root) {
  const cases = await api.get('/api/cases');
  let active = REPORTS[0];
  let params = {};

  const filterControls = {
    status: html`<label>Status<select data-param="status">${options(['Open', 'In Progress', 'On Hold', 'Closed'], '', 'All')}</select></label>`,
    priority: html`<label>Priority<select data-param="priority">${options(['Low', 'Medium', 'High', 'Critical'], '', 'All')}</select></label>`,
    evidenceStatus: html`<label>Status<select data-param="status">${options(['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived'], '', 'All')}</select></label>`,
    case: html`<label>Case<select data-param="case_id">${options(cases.map((c) => [c.id, c.case_number]), '', 'All')}</select></label>`,
    dates: html`<label>From<input type="date" data-param="from"></label><label>To<input type="date" data-param="to"></label>`,
  };

  mount(root, html`
    ${pageHead('Reports Hub', 'Preview, print, or export the mandatory reports', html`
      <button class="btn" data-csv>Export CSV</button>
      <button class="btn primary" data-print>Print / Save PDF</button>`)}
    <section class="panel">
      <div class="tabs no-print" role="tablist">${REPORTS.map((r, i) => html`<button role="tab" class="${i === 0 ? 'active' : ''}" data-tab="${r.type}">${r.label}</button>`)}</div>
      <div class="toolbar no-print" data-filters></div>
      <div data-report></div>
    </section>`);

  const filtersBox = root.querySelector('[data-filters]');
  const reportBox = root.querySelector('[data-report]');

  function renderFilters() {
    mount(filtersBox, active.filters.map((key) => filterControls[key]));
  }

  async function load() {
    const report = await api.get(`/api/reports/${active.type}`, params);
    mount(reportBox, html`
      <div class="print-only"><h1>${report.title}</h1><div>Generated ${fmtDateTime(report.generated_at)} by ${report.generated_by}</div></div>
      <div class="small muted no-print" style="margin-bottom:8px">${report.rows.length} rows</div>
      ${report.rows.length ? html`<div class="table-wrap"><table>
        <thead><tr>${report.columns.map((c) => html`<th>${c.label}</th>`)}</tr></thead>
        <tbody>${report.rows.map((row) => html`<tr>${report.columns.map((c) => {
          const value = row[c.key];
          if (value === null || value === '') return html`<td>—</td>`;
          if (HASH_COLUMNS.has(c.key)) {
            return html`<td class="hash"><span class="no-print nowrap" title="${value}">${value.slice(0, 10)}…</span><span class="print-only">${value}</span></td>`;
          }
          if (TIME_COLUMNS.has(c.key)) return html`<td class="nowrap">${value.slice(0, 16).replace('T', ' ')}</td>`;
          return html`<td class="${NUMERIC(value) ? 'num' : ''}">${value}</td>`;
        })}</tr>`)}</tbody>
      </table></div>` : html`<div class="empty">No rows match these filters</div>`}`);
  }

  on(root, 'click', '[data-tab]', async (_e, btn) => {
    active = REPORTS.find((r) => r.type === btn.dataset.tab);
    params = {};
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    renderFilters();
    await load();
  });
  on(root, 'change', '[data-param]', async (_e, el) => { params[el.dataset.param] = el.value; await load(); });
  on(root, 'click', '[data-csv]', () => {
    const query = new URLSearchParams(Object.entries({ ...params, format: 'csv' }).filter(([, v]) => v));
    return download(`/api/reports/${active.type}?${query}`, `${active.type}.csv`);
  });
  on(root, 'click', '[data-print]', () => window.print());

  renderFilters();
  await load();
}
