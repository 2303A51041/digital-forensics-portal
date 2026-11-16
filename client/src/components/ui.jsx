// Small presentational components shared by every screen.
import { toOptions } from '../utils/format.js';

const BADGE_KIND = {
  Open: 'info', 'In Progress': 'warn', 'On Hold': 'mute', Closed: 'good',
  Low: 'mute', Medium: 'info', High: 'warn', Critical: 'bad', Info: 'mute',
  'In Storage': 'mute', 'In Analysis': 'warn', 'In Transit': 'info', Released: 'good', Archived: 'mute',
  Draft: 'warn', Final: 'good', Match: 'good', Mismatch: 'bad', Computed: 'good', Declared: 'info',
  Active: 'good', Inactive: 'bad',
};

export function Badge({ label }) {
  if (!label) return '—';
  return <span className={`badge ${BADGE_KIND[label] ?? ''}`}>{label}</span>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/** columns: [{ label, render(row), num }] */
export function DataTable({ columns, rows, empty = 'Nothing to show', rowKey = (r) => r.id }) {
  if (!rows?.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((c, i) => <th key={i} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={rowKey(row) ?? r}>
              {columns.map((c, i) => <td key={i} className={c.num ? 'num' : ''}>{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Uncontrolled form field, read back through FormData when the form is submitted. */
export function Field({ label, name, type = 'text', defaultValue, required, hint, items, placeholder, rows = 4, className, ...rest }) {
  let control;
  if (type === 'select') {
    control = (
      <select name={name} defaultValue={defaultValue ?? ''} required={required} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {toOptions(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (type === 'textarea') {
    control = <textarea name={name} defaultValue={defaultValue ?? ''} required={required} rows={rows} placeholder={placeholder} {...rest} />;
  } else {
    control = <input name={name} type={type} defaultValue={defaultValue ?? undefined} required={required} placeholder={placeholder} className={className} {...rest} />;
  }
  return (
    <label className="field">
      <span>{label}{required && <em> *</em>}</span>
      {control}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** A filter dropdown with an "All" option. */
export function FilterSelect({ label, value, onChange, items, allLabel = 'All' }) {
  return (
    <label>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {toOptions(items).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs no-print" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === active} className={t.key === active ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ text = 'Loading…' }) {
  return <div className="empty">{text}</div>;
}

export function ErrorPanel({ error }) {
  return <div className="panel empty">{error?.message ?? String(error)}</div>;
}
