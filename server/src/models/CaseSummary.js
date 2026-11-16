import mongoose from 'mongoose';
import { appendOnly } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

/** A versioned snapshot of a case. New versions are added; old ones are never changed. */
const caseSummarySchema = new mongoose.Schema({
  case: { type: ObjectId, ref: 'Case', required: true },
  version: { type: Number, required: true },
  content: { type: String, required: true },
  generatedBy: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: 'generatedAt', updatedAt: false } });

caseSummarySchema.index({ case: 1, version: 1 }, { unique: true });

appendOnly(caseSummarySchema, 'Case summary');

export const CaseSummary = mongoose.model('CaseSummary', caseSummarySchema);
