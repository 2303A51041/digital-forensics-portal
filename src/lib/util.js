import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const nowIso = () => new Date().toISOString();

export function hashFile(filePath) {
  const sha256 = crypto.createHash('sha256');
  const md5 = crypto.createHash('md5');
  return pipeline(fs.createReadStream(filePath), async (source) => {
    for await (const chunk of source) {
      sha256.update(chunk);
      md5.update(chunk);
    }
  }).then(() => ({ sha256: sha256.digest('hex'), md5: md5.digest('hex') }));
}

export const removeFile = (filePath) => fs.promises.unlink(filePath).catch(() => {});

// --- Input validation: each helper returns a clean value or throws a 400. ---

export function text(body, field, { required = true, max = 5000, label = field } = {}) {
  const value = body[field] === undefined || body[field] === null ? '' : String(body[field]).trim();
  if (required && !value) throw new HttpError(400, `${label} is required`);
  if (value.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return value;
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `${label} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function id(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
}

/** Parses a timestamp to UTC ISO form and rejects anything in the future. */
export function pastTimestamp(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new HttpError(400, `${label} must be a valid date and time`);
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new HttpError(400, `${label} cannot be in the future`);
  return date.toISOString();
}

export function dateOnly(value, label) {
  if (!value) return null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
  if (!valid) throw new HttpError(400, `${label} must be in YYYY-MM-DD format`);
  return value;
}

export function hashValue(value, algorithm) {
  if (!value) return null;
  const hash = String(value).trim().toLowerCase();
  const pattern = algorithm === 'sha256' ? /^[0-9a-f]{64}$/ : /^[0-9a-f]{32}$/;
  const name = algorithm === 'sha256' ? 'SHA-256 (64 hex characters)' : 'MD5 (32 hex characters)';
  if (!pattern.test(hash)) throw new HttpError(400, `Hash is not a valid ${name}`);
  return hash;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    throw new HttpError(400, 'Password must be 8 to 72 characters');
  }
  return value;
}
