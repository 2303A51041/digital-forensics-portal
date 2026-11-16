import mongoose from 'mongoose';
import { appendOnly } from './plugins.js';
import { EVIDENCE_STATUSES } from './Evidence.js';

const { ObjectId } = mongoose.Schema.Types;

/** One link in an evidence item's chain of custody. Append-only. */
const custodyEventSchema = new mongoose.Schema({
  evidence: { type: ObjectId, ref: 'Evidence', required: true },
  action: { type: String, enum: ['Registered', 'Transfer'], required: true },
  fromUser: { type: ObjectId, ref: 'User', default: null },
  toUser: { type: ObjectId, ref: 'User', required: true },
  location: { type: String, default: '', maxlength: 200 },
  purpose: { type: String, required: true, maxlength: 500 },
  notes: { type: String, default: '', maxlength: 5000 },
  statusAfter: { type: String, enum: EVIDENCE_STATUSES, required: true },
  occurredAt: { type: Date, required: true },
  recordedBy: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'recordedAt', updatedAt: false } });

custodyEventSchema.index({ evidence: 1, occurredAt: 1 });
custodyEventSchema.index({ occurredAt: -1 });

appendOnly(custodyEventSchema, 'Custody');

export const CustodyEvent = mongoose.model('CustodyEvent', custodyEventSchema);
