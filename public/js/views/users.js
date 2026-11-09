import { api, badge, field, fmtDateTime, formObject, html, mount, on, openForm, pageHead, session, table, toast } from '../core.js';

export default async function usersView(root, { reload }) {
  const { users, roles, matrix } = await api.get('/api/users');

  mount(root, html`
    ${pageHead('User Role Management', 'Manage accounts, roles and access', html`<button class="btn primary" data-new>Add user</button>`)}
    <div class="stack">
      <section class="panel">
        ${table([
          { label: 'Name', render: (u) => html`${u.full_name}<div class="small muted">${u.email}</div>` },
          { label: 'Username', render: (u) => html`<span class="mono">${u.username}</span>` },
          { label: 'Role', render: (u) => u.role },
          { label: 'Status', render: (u) => badge(u.is_active ? 'Active' : 'Inactive') },
          { label: 'Last sign-in', render: (u) => html`<span class="small nowrap">${fmtDateTime(u.last_login_at)}</span>` },
          { label: '', render: (u) => html`<div class="actions">
            <button class="btn sm" data-edit="${u.id}">Edit</button>
            <button class="btn sm" data-reset="${u.id}">Reset password</button>
            ${u.id !== session.user.id ? html`<button class="btn sm ${u.is_active ? 'danger' : ''}" data-toggle="${u.id}">${u.is_active ? 'Deactivate' : 'Reactivate'}</button>` : ''}
          </div>` },
        ], users)}
      </section>
      <section class="panel"><h2>Access control matrix</h2>
        <div class="table-wrap"><table class="matrix">
          <thead><tr><th>Permission</th>${roles.map((r) => html`<th>${r}</th>`)}</tr></thead>
          <tbody>${Object.values(matrix).map((p) => html`<tr><td>${p.label}</td>${roles.map((r) => html`<td>${p.roles.includes(r) ? html`<span aria-label="Allowed">✓</span>` : html`<span class="muted" aria-label="Not allowed">–</span>`}</td>`)}</tr>`)}</tbody>
        </table></div>
      </section>
    </div>`);

  const byId = (value) => users.find((u) => String(u.id) === String(value));

  on(root, 'click', '[data-new]', () => openForm({
    title: 'Add user',
    submitLabel: 'Create user',
    body: html`
      ${field({ label: 'Full name', name: 'full_name', required: true })}
      <div class="field-row">
        ${field({ label: 'Username', name: 'username', required: true })}
        ${field({ label: 'Email', name: 'email', type: 'email', required: true })}
      </div>
      <div class="field-row">
        ${field({ label: 'Role', name: 'role', type: 'select', items: roles, value: 'Forensic Investigator', required: true })}
        ${field({ label: 'Initial password', name: 'password', type: 'password', required: true, hint: '8 to 72 characters', attrs: 'autocomplete="new-password"' })}
      </div>`,
    onSubmit: async (data) => {
      await api.post('/api/users', formObject(data));
      toast('User created');
      await reload();
    },
  }));

  on(root, 'click', '[data-edit]', (_e, b) => {
    const user = byId(b.dataset.edit);
    openForm({
      title: `Edit ${user.username}`,
      body: html`
        ${field({ label: 'Full name', name: 'full_name', value: user.full_name, required: true })}
        ${field({ label: 'Email', name: 'email', type: 'email', value: user.email, required: true })}
        ${field({ label: 'Role', name: 'role', type: 'select', items: roles, value: user.role, required: true })}`,
      onSubmit: async (data) => {
        await api.patch(`/api/users/${user.id}`, formObject(data));
        toast('User updated');
        await reload();
      },
    });
  });

  on(root, 'click', '[data-reset]', (_e, b) => {
    const user = byId(b.dataset.reset);
    openForm({
      title: `Reset password for ${user.username}`,
      submitLabel: 'Reset password',
      body: field({ label: 'New password', name: 'password', type: 'password', required: true, hint: 'Signs the user out of all sessions.', attrs: 'autocomplete="new-password"' }),
      onSubmit: async (data) => {
        await api.post(`/api/users/${user.id}/reset-password`, formObject(data));
        toast('Password reset');
        if (user.id === session.user.id) location.reload();
      },
    });
  });

  on(root, 'click', '[data-toggle]', (_e, b) => {
    const user = byId(b.dataset.toggle);
    const activate = !user.is_active;
    openForm({
      title: `${activate ? 'Reactivate' : 'Deactivate'} ${user.full_name}`,
      submitLabel: activate ? 'Reactivate' : 'Deactivate',
      danger: !activate,
      body: html`<p style="margin:0">${activate ? 'This user will be able to sign in again.' : 'This user will be signed out and unable to sign in. Their history is retained.'}</p>`,
      onSubmit: async () => {
        await api.patch(`/api/users/${user.id}`, { is_active: activate });
        toast(activate ? 'User reactivated' : 'User deactivated');
        await reload();
      },
    });
  });
}
