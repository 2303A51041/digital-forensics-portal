export const fmtDateTime = (value) =>
  (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Date-only strings (YYYY-MM-DD) are shown as that calendar day, not shifted by time zone. */
export const fmtDate = (value) => {
  if (!value) return '—';
  const date = typeof value === 'string' && value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

export function fmtBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
  return `${size.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Current local time in the format a datetime-local input expects. */
export function localInputNow() {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const localToIso = (value) => (value ? new Date(value).toISOString() : '');

export const shortHash = (e) => (e.sha256 ? `SHA-256 ${e.sha256.slice(0, 12)}…` : e.md5 ? `MD5 ${e.md5.slice(0, 12)}…` : '—');

/** Turns ['A', 'B'] or [['1', 'A'], ['2', 'B']] into [{ value, label }]. */
export const toOptions = (items = []) =>
  items.map((item) => (Array.isArray(item) ? { value: String(item[0]), label: item[1] } : { value: String(item), label: item }));
