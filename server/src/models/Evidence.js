import mongoose from 'mongoose';
import { saveOnlyNoDelete } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

export const EVIDENCE_STATUSES = ['In Storage', 'In Analysis', 'In Transit', 'Released', 'Archived'];
export const FINAL_EVIDENCE_STATUSES = ['Released', 'Archived'];
export const EVIDENCE_TYPES = ['Disk Image', 'Memory Dump', 'Log File', 'Network Capture', 'Email', 'Mobile Extraction',
  'Physical Device', 'Removable Media', 'Document', 'Other'];

const evidenceSchema = new mongoose.Schema({
  evidenceNumber: { type: String, required: true, unique: true, immutable: true },
  case: { type: ObjectId, ref: 'Case', required: true, immutable: true },
  itemName: { type: String, required: true, trim: true, maxlength: 200 },
  evidenceType: { type: String, required: true, trim: true, maxlength: 100 },
  source: { type: String, required: true, trim: true, maxlength: 500 },
  description: { type: String, default: '', maxlength: 5000 },
  storageLocation: { type: String, default: '', maxlength: 200 },
  collectedAt: { type: Date, required: true, immutable: true },
  registeredBy: { type: ObjectId, ref: 'User', required: true, immutable: true },
  // Hash values are fixed at registration and can never be changed.
  sha256: { type: String, default: null, immutable: true, match: /^[0-9a-f]{64}$/ },
  md5: { type: String, default: null, immutable: true, match: /^[0-9a-f]{32}$/ },
  hashOrigin: { type: String, enum: ['Computed', 'Declared'], required: true, immutable: true },
  file: {
    storageName: { type: String, immutable: true },
    originalName: { type: String, immutable: true },
    mimeType: { type: String, immutable: true },
    size: { type: Number, immutable: true },
  },
  currentCustodian: { type: ObjectId, ref: 'User', required: true },
  status: { type: String, enum: EVIDENCE_STATUSES, default: 'In Storage' },
  lastVerifiedAt: { type: Date, default: null },
  lastVerifyResult: { type: String, enum: ['Match', 'Mismatch', null], default: null },
}, {
  timestamps: { createdAt: 'registeredAt', updatedAt: 'updatedAt' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    // The random storage name is an internal detail; clients only need to know a file exists.
    transform: (_doc, ret) => {
      delete ret._id;
      ret.hasFile = Boolean(ret.file?.storageName);
      if (ret.file) delete ret.file.storageName;
      return ret;
    },
  },
});

evidenceSchema.pre('validate', async function () {
  if (!this.sha256 && !this.md5) this.invalidate('sha256', 'A SHA-256 or MD5 hash is required');
});

evidenceSchema.index({ case: 1 });
evidenceSchema.index({ currentCustodian: 1, status: 1 });

saveOnlyNoDelete(evidenceSchema, 'Evidence');

export const Evidence = mongoose.model('Evidence', evidenceSchema);
