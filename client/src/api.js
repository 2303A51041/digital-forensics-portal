// Small fetch wrapper: adds the sign-in token, turns error responses into exceptions, and downloads files.

const TOKEN_KEY = 'forensics.token';

export const tokenStore = {
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* storage unavailable: the session lasts until reload */ }
  },
};

let unauthorizedHandler = () => {};
export const onUnauthorized = (handler) => { unauthorizedHandler = handler; };

export async function request(method, url, body, { raw = false } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
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
  if (res.status === 401 && token && url !== '/api/auth/login') {
    unauthorizedHandler();
    throw new Error('Your session has ended');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const withQuery = (url, params) => {
  const query = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : '';
  return query ? `${url}?${query}` : url;
};

export const api = {
  get: (url, params) => request('GET', withQuery(url, params)),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

export function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Downloads a protected file (the token cannot go in a plain link), using the server's filename. */
export async function download(url, params, fallbackName = 'download') {
  const res = await request('GET', withQuery(url, params), undefined, { raw: true });
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1] || match[2]) : fallbackName;
  saveBlob(await res.blob(), name);
}
