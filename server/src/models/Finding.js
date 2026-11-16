import mongoose from 'mongoose';
import { saveOnlyNoDelete } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

export const SEVERITIES = ['Info', 'Low', 'Medium', 'High', 'Critical'];

const findingSchema = new mongoose.Schema({
  case: { type: ObjectId, ref: 'Case', required: true, immutable: true },
  evidence: { type: ObjectId, ref: 'Evidence', default: null },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  details: { type: String, required: true, maxlength: 20000 },
  severity: { type: String, enum: SEVERITIES, default: 'Medium' },
  status: { type: String, enum: ['Draft', 'Final'], default: 'Draft' },
  author: { type: ObjectId, ref: 'User', required: true, immutable: true },
  finalizedAt: { type: Date, default: null },
  attachment: {
    storageName: { type: String, immutable: true },
    originalName: { type: String, immutable: true },
    sha256: { type: String, immutable: true },
  },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      delete ret._id;
      if (ret.attachment) delete ret.attachment.storageName;
      return ret;
    },
  },
});

findingSchema.index({ case: 1, createdAt: -1 });

// A finalized finding is locked permanently: remember the loaded state and refuse any later save.
findingSchema.post('init', function () {
  this.$locals.lockedFinal = this.status === 'Final';
});
findingSchema.pre('save', async function () {
  if (!this.isNew && this.$locals.lockedFinal) throw new Error('Finalized findings are immutable');
});

saveOnlyNoDelete(findingSchema, 'Finding');

export const Finding = mongoose.model('Finding', findingSchema);
