import mongoose from 'mongoose';

// Every document is sent to the client with a string `id` instead of `_id` and `__v`.
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

const QUERY_UPDATES = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'];
const QUERY_DELETES = ['deleteOne', 'deleteMany', 'findOneAndDelete'];

/**
 * Records that must never change once written (custody events, access logs, audit logs, summaries).
 * MongoDB has no triggers, so the rule is enforced in Mongoose middleware for every write path the
 * application can use. Edits made outside the app are still caught by the audit hash chain.
 */
export function appendOnly(schema, name) {
  schema.pre(QUERY_UPDATES, async function () { throw new Error(`${name} records are append-only`); });
  schema.pre(QUERY_DELETES, { document: false, query: true }, async function () { throw new Error(`${name} records are append-only`); });
  schema.pre('deleteOne', { document: true, query: false }, async function () { throw new Error(`${name} records are append-only`); });
  schema.pre('save', async function () {
    if (!this.isNew) throw new Error(`${name} records are append-only`);
  });
}

/**
 * Records that can change only through document.save(), so schema validation, `immutable` fields
 * and save hooks always run. They can never be deleted.
 */
export function saveOnlyNoDelete(schema, name) {
  schema.pre(QUERY_UPDATES, async function () { throw new Error(`${name} records must be changed through the application`); });
  schema.pre(QUERY_DELETES, { document: false, query: true }, async function () { throw new Error(`${name} records cannot be deleted`); });
  schema.pre('deleteOne', { document: true, query: false }, async function () { throw new Error(`${name} records cannot be deleted`); });
}
