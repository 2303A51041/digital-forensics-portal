import mongoose from 'mongoose';
import { appendOnly } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

export const ACCESS_ACTIONS = ['View', 'Download', 'Verify', 'Transfer', 'Register'];

/** Every time someone views, downloads, verifies, transfers or registers an evidence item. Append-only. */
const accessLogSchema = new mongoose.Schema({
  evidence: { type: ObjectId, ref: 'Evidence', required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  action: { type: String, enum: ACCESS_ACTIONS, required: true },
  detail: { type: String, default: '' },
  ip: { type: String, default: '' },
}, { timestamps: { createdAt: 'accessedAt', updatedAt: false } });

accessLogSchema.index({ evidence: 1, accessedAt: -1 });
accessLogSchema.index({ accessedAt: -1 });

appendOnly(accessLogSchema, 'Evidence access log');

export const AccessLog = mongoose.model('AccessLog', accessLogSchema);
