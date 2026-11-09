import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// A generated secret keeps fresh installs from sharing a publicly known default.
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir,
  uploadDir,
  dbPath: path.join(dataDir, 'forensics.db'),
  jwtSecret: loadJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024,
  seedDemo: process.env.SEED_DEMO !== 'false',
};
