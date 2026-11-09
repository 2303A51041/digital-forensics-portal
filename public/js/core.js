// Shared frontend helpers: API client, escaping templates, dialogs and small UI components.

class Safe {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

/** Template tag that escapes every interpolated value unless it is itself html``. */
export const html = (strings, ...values) =>
  new Safe(strings.reduce((out, part, i) => out + part + (i < values.length ? renderValue(values[i]) : ''), ''));

export const session = {
  get token() { try { return sessionStorage.getItem('token'); } catch { return null; } },
  set token(value) {
    try {
      if (value) sessionStorage.setItem('token', value); else sessionStorage.removeItem('token');
    } catch { /* storage unavailable: session lasts until reload */ }
  },
  user: null,
  matrix: null,
  can(permission) { return Boolean(this.user?.permissions.includes(permission)); },
};

export const events = { onUnauthorized: () => {} };

export async function request(method, url, body, { raw = false } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const options = { method, headers };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Could not reach the server');
  }
  if (res.status === 401 && session.token && url !== '/api/auth/login') {
    events.onUnauthorized();
    throw new Error('Your session has ended');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (url, params) => {
    const query = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString() : '';
    return request('GET', query ? `${url}?${query}` : url);
  },
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function download(url, fallbackName) {
  const res = await request('GET', url, undefined, { raw: true });
  const header = res.headers.get('content-disposition') || '';
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = header.match(/filename="([^"]+)"/i);
  const name = encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] : fallbackName;
  saveBlob(await res.blob(), name);
}

export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

export const toastError = (err) => toast(err.message, 'error');

export function mount(el, content) { el.innerHTML = renderValue(content); }

/** Delegated event listener scoped to root. */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) {
      Promise.resolve(handler(event, target)).catch(toastError);
    }
  });
}

// --- Formatting ---
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDate = (value) => (value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export function fmtBytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${i ? value.toFixed(1) : value} ${units[i]}`;
}
export function localInputNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
export const localToIso = (value) => (value ? new Date(value).toISOString() : '');

// --- Components ---
const BADGE_KIND = {
  Open: 'info', 'In Progress': 'info', 'On Hold': 'warn', Closed: '',
  Critical: 'bad', High: 'warn', Medium: 'info', Low: '', Info: '',
  'In Storage': '', 'In Analysis': 'info', 'In Transit': 'warn', Released: 'good', Archived: '',
  Draft: 'warn', Final: 'good', Match: 'good', Mismatch: 'bad', Active: 'good', Inactive: 'bad',
  Computed: 'good', Declared: 'info',
};
export const badge = (label) => (label ? html`<span class="badge ${BADGE_KIND[label] ?? ''}">${label}</span>` : '—');

export function bars(rows) {
  if (!rows.length) return html`<div class="empty">No data yet</div>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return html`<div class="bars">${rows.map((r) => html`
    <div class="bar-row" title="${r.label}: ${r.value}">
      <span class="bar-label">${r.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%"></div></div>
      <span class="bar-value">${r.value}</span>
    </div>`)}</div>`;
}

export function table(columns, rows, emptyText = 'Nothing to show') {
  if (!rows.length) return html`<div class="empty">${emptyText}</div>`;
  return html`<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => html`<th class="${c.num ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((row) => html`<tr>${columns.map((c) => html`<td class="${c.num ? 'num' : ''}">${c.render(row)}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

export function options(items, selected, placeholder) {
  return html`${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ''}${items.map((item) => {
    const [value, label] = Array.isArray(item) ? item : [item, item];
    return html`<option value="${value}" ${String(value) === String(selected ?? '') ? new Safe('selected') : ''}>${label}</option>`;
  })}`;
}

export function field({ label, name, type = 'text', value = '', required = false, hint, items, placeholder, rows = 4, attrs = '' }) {
  const req = required ? new Safe('required') : '';
  const extra = new Safe(attrs);
  let control;
  if (type === 'select') control = html`<select name="${name}" ${req} ${extra}>${options(items, value, placeholder)}</select>`;
  else if (type === 'textarea') control = html`<textarea name="${name}" rows="${rows}" ${req} ${extra}>${value}</textarea>`;
  else control = html`<input name="${name}" type="${type}" value="${value}" placeholder="${placeholder ?? ''}" ${req} ${extra}>`;
  return html`<label class="field"><span>${label}${required ? html` <em>*</em>` : ''}</span>${control}${hint ? html`<small>${hint}</small>` : ''}</label>`;
}

/**
 * Opens a modal form. onSubmit receives the form's FormData. Throwing shows the
 * message inside the dialog and leaves it open with the user's input intact.
 */
export function openForm({ title, body, submitLabel = 'Save', wide = false, onSubmit, danger = false }) {
  const dialog = document.createElement('dialog');
  if (wide) dialog.classList.add('wide');
  mount(dialog, html`<form class="dlg-form" novalidate>
    <div class="dlg-head">${title}</div>
    <div class="dlg-body">${body}<div class="form-error" hidden></div></div>
    <div class="dlg-foot">
      <button type="button" class="btn" data-close>${onSubmit ? 'Cancel' : 'Close'}</button>
      ${onSubmit ? html`<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${submitLabel}</button>` : ''}
    </div></form>`);
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('[data-close]').addEventListener('click', close);
  const form = dialog.querySelector('form');
  const errorBox = dialog.querySelector('.form-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    errorBox.hidden = true;
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type=submit]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      await onSubmit(new FormData(form));
      close();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      button.disabled = false;
      button.textContent = original;
    }
  });
  dialog.showModal();
  return dialog;
}

export const formObject = (formData) => Object.fromEntries(formData.entries());

export const pageHead = (title, subtitle, actions = '') =>
  html`<div class="page-head"><div><h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div><div class="actions no-print">${actions}</div></div>`;

export const shortHash = (e) => (e.sha256
  ? html`<span class="mono" title="SHA-256 ${e.sha256}">${e.sha256.slice(0, 12)}…</span>`
  : html`<span class="mono" title="MD5 ${e.md5}">${e.md5.slice(0, 12)}… <span class="muted">MD5</span></span>`);
