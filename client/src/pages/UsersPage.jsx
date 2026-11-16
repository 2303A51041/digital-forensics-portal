import { useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Badge, DataTable, ErrorPanel, Field, Loading, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDateTime } from '../utils/format.js';
import { useAsync } from '../utils/useAsync.js';

export default function UsersPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(null); // { kind: 'new' | 'edit' | 'reset' | 'toggle', user? }
  const { data, error, reload } = useAsync(() => api.get('/api/users'), []);

  if (error) return <ErrorPanel error={error} />;
  if (!data) return <Loading />;
  const { users, roles, matrix } = data;
  const close = () => setDialog(null);
  const target = dialog?.user;

  return (
    <>
      <PageHeader title="User Role Management" subtitle="Manage accounts, roles and access">
        <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'new' })}>Add user</button>
      </PageHeader>
      <div className="stack">
        <section className="panel">
          <DataTable
            rows={users}
            columns={[
              { label: 'Name', render: (u) => <>{u.fullName}<div className="small muted">{u.email}</div></> },
              { label: 'Username', render: (u) => <span className="mono">{u.username}</span> },
              { label: 'Role', render: (u) => u.role },
              { label: 'Status', render: (u) => <Badge label={u.isActive ? 'Active' : 'Inactive'} /> },
              { label: 'Last sign-in', render: (u) => <span className="small nowrap">{fmtDateTime(u.lastLoginAt)}</span> },
              {
                label: '',
                render: (u) => (
                  <div className="actions">
                    <button type="button" className="btn sm" onClick={() => setDialog({ kind: 'edit', user: u })}>Edit</button>
                    <button type="button" className="btn sm" onClick={() => setDialog({ kind: 'reset', user: u })}>Reset password</button>
                    {u.id !== me.id && (
                      <button type="button" className={`btn sm ${u.isActive ? 'danger' : ''}`} onClick={() => setDialog({ kind: 'toggle', user: u })}>
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </section>
        <section className="panel">
          <h2>Access control matrix</h2>
          <p className="small muted" style={{ marginTop: -6 }}>Generated from the same permission table the server enforces on every request.</p>
          <div className="table-wrap">
            <table className="matrix">
              <thead><tr><th>Permission</th>{roles.map((r) => <th key={r}>{r}</th>)}</tr></thead>
              <tbody>
                {Object.entries(matrix).map(([key, p]) => (
                  <tr key={key}>
                    <td>{p.label}</td>
                    {roles.map((r) => <td key={r}>{p.roles.includes(r) ? <span aria-label="Allowed">✓</span> : <span className="muted" aria-label="Not allowed">–</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {dialog?.kind === 'new' && (
        <Modal
          title="Add user" submitLabel="Create user" onClose={close}
          onSubmit={async (fd) => { await api.post('/api/users', Object.fromEntries(fd)); toast('User created'); await reload(); }}
        >
          <Field label="Full name" name="fullName" required maxLength={200} />
          <div className="field-row">
            <Field label="Username" name="username" required maxLength={100} pattern="[A-Za-z0-9_.\-]+" title="Letters, digits, dot, dash and underscore" />
            <Field label="Email" name="email" type="email" required />
          </div>
          <div className="field-row">
            <Field label="Role" name="role" type="select" items={roles} defaultValue="Forensic Investigator" required />
            <Field label="Initial password" name="password" type="password" required minLength={8} maxLength={72} hint="8 to 72 characters" autoComplete="new-password" />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'edit' && (
        <Modal
          title={`Edit ${target.username}`} onClose={close}
          onSubmit={async (fd) => { await api.patch(`/api/users/${target.id}`, Object.fromEntries(fd)); toast('User updated'); await reload(); }}
        >
          <Field label="Full name" name="fullName" defaultValue={target.fullName} required maxLength={200} />
          <Field label="Email" name="email" type="email" defaultValue={target.email} required />
          <Field label="Role" name="role" type="select" items={roles} defaultValue={target.role} required />
        </Modal>
      )}
      {dialog?.kind === 'reset' && (
        <Modal
          title={`Reset password for ${target.username}`} submitLabel="Reset password" onClose={close}
          onSubmit={async (fd) => {
            await api.post(`/api/users/${target.id}/reset-password`, Object.fromEntries(fd));
            toast('Password reset');
            if (target.id === me.id) window.location.reload();
          }}
        >
          <Field label="New password" name="password" type="password" required minLength={8} maxLength={72} hint="Signs the user out of all sessions." autoComplete="new-password" />
        </Modal>
      )}
      {dialog?.kind === 'toggle' && (
        <Modal
          title={`${target.isActive ? 'Deactivate' : 'Reactivate'} ${target.fullName}`}
          submitLabel={target.isActive ? 'Deactivate' : 'Reactivate'}
          danger={target.isActive}
          onClose={close}
          onSubmit={async () => {
            await api.patch(`/api/users/${target.id}`, { isActive: !target.isActive });
            toast(target.isActive ? 'User deactivated' : 'User reactivated');
            await reload();
          }}
        >
          <p style={{ margin: 0 }}>
            {target.isActive ? 'This user will be signed out and unable to sign in. Their history is retained.' : 'This user will be able to sign in again.'}
          </p>
        </Modal>
      )}
    </>
  );
}
