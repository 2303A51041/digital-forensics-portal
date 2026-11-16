import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

export const Counter = mongoose.model('Counter', counterSchema);

/** Returns the next reference such as DF-2026-0001. The $inc is atomic, so numbers never repeat. */
export async function nextNumber(prefix, date = new Date()) {
  const year = date.getUTCFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `${prefix}-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `${prefix}-${year}-${String(counter.seq).padStart(4, '0')}`;
}
