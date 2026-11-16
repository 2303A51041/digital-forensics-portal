import mongoose from 'mongoose';
import { appendOnly } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * System-wide audit trail. Each entry stores the hash of the entry before it (prevHash) and a hash
 * of its own contents (rowHash), so any later edit or deletion breaks the chain and is detected by
 * "Verify log integrity".
 */
const auditLogSchema = new mongoose.Schema({
  seq: { type: Number, required: true, unique: true },
  occurredAt: { type: Date, required: true },
  user: { type: ObjectId, ref: 'User', default: null },
  username: { type: String, required: true },
  role: { type: String, default: '' },
  action: { type: String, required: true },
  entityType: { type: String, default: '' },
  entityId: { type: String, default: '' },
  details: { type: String, default: '' },
  ip: { type: String, default: '' },
  prevHash: { type: String, required: true },
  rowHash: { type: String, required: true },
}, { versionKey: false });

auditLogSchema.index({ action: 1 });
auditLogSchema.index({ occurredAt: -1 });

appendOnly(auditLogSchema, 'Audit log');

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
