import { useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import { Field } from '../components/ui.jsx';
import { fmtBytes, localInputNow, localToIso } from '../utils/format.js';
import { canHashInBrowser, sha256OfFile } from '../utils/hash.js';
import { EVIDENCE_TYPES } from './caseOptions.js';
import styles from './RegisterEvidenceModal.module.css';

/**
 * Evidence registration form. Choosing a file computes its SHA-256 in the browser straight away and
 * fills it in; on upload the server hashes the file again and refuses it if the values differ.
 */
export default function RegisterEvidenceModal({ cases, presetCaseId = '', onClose, onRegistered }) {
  const [hashState, setHashState] = useState({ status: 'idle' });
  const [sha256, setSha256] = useState('');

  async function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      setHashState({ status: 'idle' });
      setSha256('');
      return;
    }
    setHashState({ status: 'hashing', name: file.name, size: file.size });
    try {
      const hash = await sha256OfFile(file);
      setSha256(hash);
      setHashState({ status: 'done', name: file.name, size: file.size });
    } catch (err) {
      setSha256('');
      setHashState({ status: 'skipped', name: file.name, size: file.size, message: err.message });
    }
  }

  async function submit(data) {
    if (hashState.status === 'hashing') throw new Error('Wait for the SHA-256 hash to finish.');
    data.set('collectedAt', localToIso(data.get('collectedAt')));
    if (!data.get('file')?.size) data.delete('file');
    const created = await api.post('/api/evidence', data);
    onRegistered(created);
  }

  return (
    <Modal title="Register evidence" submitLabel="Register evidence" wide onClose={onClose} onSubmit={submit}>
      <Field
        label="Case" name="caseId" type="select" required defaultValue={presetCaseId} placeholder="Select a case…"
        items={cases.map((c) => [c.id, `${c.caseNumber}: ${c.title}`])}
      />
      <div className="field-row">
        <Field label="Item name" name="itemName" required maxLength={200} />
        <Field label="Evidence type" name="evidenceType" type="select" items={EVIDENCE_TYPES} defaultValue="Disk Image" required />
      </div>
      <Field label="Source" name="source" required maxLength={500} placeholder="Device, host, serial number or location acquired from" />
      <div className="field-row">
        <Field label="Collected at" name="collectedAt" type="datetime-local" defaultValue={localInputNow()} required />
        <Field label="Storage location" name="storageLocation" placeholder="e.g. Evidence Vault A, Shelf 2" maxLength={200} />
      </div>
      <Field label="Description" name="description" type="textarea" rows={3} />
      <Field
        label="Evidence file" name="file" type="file" onChange={onFileChange}
        hint={canHashInBrowser()
          ? 'The SHA-256 hash is generated in your browser as soon as you choose a file. The server checks it again on upload and also records the MD5.'
          : 'The server computes SHA-256 and MD5 when the file is uploaded.'}
      />
      {hashState.status !== 'idle' && (
        <div className={`${styles.hashBox} ${hashState.status === 'done' ? styles.done : ''}`} aria-live="polite">
          <div className="small">{hashState.name} ({fmtBytes(hashState.size)})</div>
          {hashState.status === 'hashing' && <div>Generating SHA-256…</div>}
          {hashState.status === 'done' && <div><strong>SHA-256 generated.</strong> It will be verified by the server on upload.</div>}
          {hashState.status === 'skipped' && <div>{hashState.message}</div>}
        </div>
      )}
      <div className="field-row">
        <Field
          label="SHA-256" name="sha256" placeholder="64 hex characters" className="hash" spellCheck={false}
          value={sha256} onChange={(e) => setSha256(e.target.value)} readOnly={hashState.status === 'done'}
        />
        <Field label="MD5" name="md5" placeholder="32 hex characters" className="hash" spellCheck={false} />
      </div>
      <small className="muted">For items too large to upload, or physical items, skip the file and enter at least one hash from your acquisition tool.</small>
    </Modal>
  );
}
