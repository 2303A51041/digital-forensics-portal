import { api, events, field, formObject, html, mount, openForm, request, session, toast } from './core.js';
import auditView from './views/audit.js';
import { caseDetailView, casesView } from './views/cases.js';
import custodyView from './views/custody.js';
import dashboardView from './views/dashboard.js';
import { evidenceDetailView, evidenceView } from './views/evidence.js';
import findingsView from './views/findings.js';
import reportsView from './views/reports.js';
import usersView from './views/users.js';

const app = document.getElementById('app');

const ROUTES = [
  { path: 'dashboard', label: 'Dashboard', view: dashboardView },
  { path: 'cases', label: 'Case Management', view: casesView, detail: caseDetailView },
  { path: 'evidence', label: 'Evidence Registration', view: evidenceView, detail: evidenceDetailView },
  { path: 'custody', label: 'Chain of Custody', view: custodyView },
  { path: 'findings', label: 'Findings & Summaries', view: findingsView },
  { path: 'users', label: 'Users & Access', view: usersView, permission: 'user.manage' },
  { path: 'reports', label: 'Reports Hub', view: reportsView, permission: 'report.view' },
  { path: 'audit', label: 'Audit & Access Logs', view: auditView, permission: 'audit.view' },
];

const allowed = (route) => !route.permission || session.can(route.permission);

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, id] = path.split('/');
  return { name: name || 'dashboard', id, query: new URLSearchParams(query || '') };
}

function renderLogin(message) {
  session.token = null;
  session.user = null;
  mount(app, html`<div class="login"><form class="login-card" id="login">
    <div><h1>Forensics Case Portal</h1><p>Sign in to manage cases and evidence.</p></div>
    ${message ? html`<div class="form-error">${message}</div>` : ''}
    <div class="form-error" id="login-error" hidden></div>
    ${field({ label: 'Username', name: 'username', required: true, attrs: 'autocomplete="username" autofocus' })}
    ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
    <button class="btn primary" type="submit">Sign in</button>
    <div class="demo">Demo users: <code>admin</code>, <code>manager</code>, <code>investigator1</code>, <code>auditor</code>. Password: <code>Forensics@123</code></div>
  </form></div>`);
  const form = app.querySelector('#login');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const { token } = await api.post('/api/auth/login', formObject(new FormData(form)));
      session.token = token;
      await start();
    } catch (err) {
      const box = form.querySelector('#login-error');
      box.textContent = err.message;
      box.hidden = false;
      button.disabled = false;
    }
  });
}

function renderShell() {
  mount(app, html`<div class="shell">
    <aside class="side">
      <div class="brand">Forensics Case Portal<small>Case &amp; evidence management</small></div>
      <nav class="nav" aria-label="Main">${ROUTES.filter(allowed).map((r) => html`<a href="#/${r.path}" data-route="${r.path}">${r.label}</a>`)}</nav>
      <div class="who"><strong>${session.user.full_name}</strong>${session.user.role}
        <div class="links"><button id="change-pw">Change password</button><button id="logout">Sign out</button></div>
      </div>
    </aside>
    <main id="view"></main>
  </div>`);
  app.querySelector('#logout').addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => {});
    location.hash = '';
    renderLogin();
  });
  app.querySelector('#change-pw').addEventListener('click', () => openForm({
    title: 'Change password',
    submitLabel: 'Change password',
    body: html`
      ${field({ label: 'Current password', name: 'current_password', type: 'password', required: true })}
      ${field({ label: 'New password', name: 'new_password', type: 'password', required: true, hint: '8 to 72 characters' })}`,
    onSubmit: async (data) => {
      const { token } = await api.post('/api/auth/change-password', formObject(data));
      session.token = token;
      toast('Password changed');
    },
  }));
}

let navigation = 0;

async function navigate() {
  if (!session.user) return;
  const current = ++navigation;
  const { name, id, query } = parseHash();
  const route = ROUTES.find((r) => r.path === name) ?? ROUTES[0];
  const main = app.querySelector('#view');
  app.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route.path));

  const root = document.createElement('div');
  try {
    if (!allowed(route)) {
      mount(root, html`<div class="panel empty">You do not have access to this screen.</div>`);
    } else {
      const view = id && route.detail ? route.detail : route.view;
      await view(root, { id, query, reload: navigate });
    }
  } catch (err) {
    mount(root, html`<div class="panel empty">${err.message}</div>`);
  }
  if (current === navigation) {
    main.replaceChildren(root);
    window.scrollTo(0, 0);
  }
}

async function start() {
  if (!session.token) return renderLogin();
  try {
    const me = await request('GET', '/api/auth/me');
    session.user = me.user;
    session.matrix = me.permissionMatrix;
  } catch {
    return renderLogin();
  }
  renderShell();
  return navigate();
}

events.onUnauthorized = () => renderLogin('Your session has ended. Please sign in again.');
window.addEventListener('hashchange', navigate);
start();
