import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';

// Stored under random names so client-supplied filenames never touch the filesystem path.
export const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1, fieldSize: 1024 * 1024 },
});

/** Browsers send UTF-8 filenames, which multipart parsing decodes as latin1. */
export const decodeFilename = (name) => path.basename(Buffer.from(name, 'latin1').toString('utf8'));

export const storedPath = (storageName) => path.join(config.uploadDir, storageName);
