import { useEffect, useRef, useState } from 'react';
import styles from './Modal.module.css';

/**
 * A dialog that wraps a form. onSubmit receives the form's FormData; if it throws, the error is shown
 * inside the dialog and the dialog stays open. Without onSubmit it is a read-only dialog.
 */
export default function Modal({ title, children, onClose, onSubmit, submitLabel = 'Save', wide = false, danger = false }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.open && dialog.close();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!onSubmit) return onClose();
    setBusy(true);
    setError('');
    try {
      await onSubmit(new FormData(event.currentTarget));
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.wide : ''}`} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.head}>{title}</div>
        <div className={styles.body}>
          {error && <div className="form-error" role="alert">{error}</div>}
          {children}
        </div>
        <div className={styles.foot}>
          <button type="button" className="btn" onClick={onClose}>{onSubmit ? 'Cancel' : 'Close'}</button>
          {onSubmit && <button type="submit" className={`btn primary ${danger ? styles.danger : ''}`} disabled={busy}>{busy ? 'Working…' : submitLabel}</button>}
        </div>
      </form>
    </dialog>
  );
}
