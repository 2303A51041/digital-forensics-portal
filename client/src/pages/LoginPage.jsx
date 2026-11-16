import { useState } from 'react';
import { Field } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { login, notice } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await login(data.get('username'), data.get('password'));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div>
          <h1>Forensics Case Portal</h1>
          <p>Sign in to manage cases and evidence.</p>
        </div>
        {notice && <div className="form-error">{notice}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <Field label="Username" name="username" required autoComplete="username" autoFocus />
        <Field label="Password" name="password" type="password" required autoComplete="current-password" />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className={styles.demo}>
          Demo users: <code>admin</code>, <code>manager</code>, <code>investigator1</code>, <code>auditor</code>. Password: <code>Forensics@123</code>
        </div>
      </form>
    </div>
  );
}
