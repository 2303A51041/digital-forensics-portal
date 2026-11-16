import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const rootDir = path.resolve(serverDir, '..');

// The .env file lives at the project root so the server and client share one settings file.
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'server/data');
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
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/forensics_db',
  dataDir,
  uploadDir,
  clientDist: path.join(rootDir, 'client', 'dist'),
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: loadJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024,
  seedDemo: process.env.SEED_DEMO !== 'false',
};
