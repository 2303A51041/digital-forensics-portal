import mongoose from 'mongoose';
import { saveOnlyNoDelete } from './plugins.js';

const { ObjectId } = mongoose.Schema.Types;

export const CASE_STATUSES = ['Open', 'In Progress', 'On Hold', 'Closed'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const CASE_TYPES = ['Data Breach', 'Malware', 'Insider Threat', 'Phishing', 'Fraud', 'Intellectual Property Theft', 'Other'];

const assignmentSchema = new mongoose.Schema({
  user: { type: ObjectId, ref: 'User', required: true },
  roleOnCase: { type: String, enum: ['Lead', 'Support'], default: 'Support' },
  assignedBy: { type: ObjectId, ref: 'User', required: true },
  assignedAt: { type: Date, default: Date.now },
}, { _id: false });

const caseSchema = new mongoose.Schema({
  caseNumber: { type: String, required: true, unique: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 5000 },
  caseType: { type: String, required: true, trim: true, maxlength: 100 },
  priority: { type: String, enum: PRIORITIES, default: 'Medium' },
  status: { type: String, enum: CASE_STATUSES, default: 'Open' },
  assignments: { type: [assignmentSchema], default: [] },
  createdBy: { type: ObjectId, ref: 'User', required: true, immutable: true },
  openedAt: { type: Date, default: Date.now, immutable: true },
  dueDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

caseSchema.index({ 'assignments.user': 1 });
caseSchema.index({ status: 1, priority: 1 });

/** The lead investigator, or null if the case has no lead yet. */
caseSchema.virtual('leadInvestigator').get(function () {
  return this.assignments?.find((a) => a.roleOnCase === 'Lead')?.user ?? null;
});

saveOnlyNoDelete(caseSchema, 'Case');

export const Case = mongoose.model('Case', caseSchema);
