import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

let inTransaction = false;

/** Runs fn atomically. Nested calls join the outer transaction. fn must be synchronous. */
export function tx(fn) {
  if (inTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  inTransaction = true;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    inTransaction = false;
  }
}
