import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { NAV_ITEMS } from '../routes.js';
import styles from './Layout.module.css';
import Modal from './Modal.jsx';
import { Field } from './ui.jsx';

export default function Layout() {
  const { user, can, logout, changePassword } = useAuth();
  const { toast } = useToast();
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <div className={styles.brand}>Forensics Case Portal<small>Case &amp; evidence management</small></div>
        <nav className={styles.nav} aria-label="Main">
          {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? styles.active : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.who}>
          <strong>{user.fullName}</strong>{user.role}
          <div className={styles.links}>
            <button type="button" onClick={() => setChangingPassword(true)}>Change password</button>
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className={styles.main}><Outlet /></main>

      {changingPassword && (
        <Modal
          title="Change password"
          submitLabel="Change password"
          onClose={() => setChangingPassword(false)}
          onSubmit={async (data) => {
            await changePassword(data.get('currentPassword'), data.get('newPassword'));
            toast('Password changed');
          }}
        >
          <Field label="Current password" name="currentPassword" type="password" required autoComplete="current-password" />
          <Field label="New password" name="newPassword" type="password" required hint="8 to 72 characters" autoComplete="new-password" />
        </Modal>
      )}
    </div>
  );
}
