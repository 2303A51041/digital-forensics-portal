import crypto from 'node:crypto';
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
