import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { audit } from './lib/audit.js';
import { HttpError, removeFile } from './lib/util.js';
import { authenticate } from './middleware/auth.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import caseRoutes from './routes/cases.js';
import custodyRoutes from './routes/custody.js';
import dashboardRoutes from './routes/dashboard.js';
import evidenceRoutes from './routes/evidence.js';
import findingRoutes from './routes/findings.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    // The portal is commonly reached over plain HTTP on a local network.
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', authenticate, dashboardRoutes);
  app.use('/api/cases', authenticate, caseRoutes);
  app.use('/api/evidence', authenticate, evidenceRoutes);
  app.use('/api/custody', authenticate, custodyRoutes);
  app.use('/api/findings', authenticate, findingRoutes);
  app.use('/api/users', authenticate, userRoutes);
  app.use('/api/reports', authenticate, reportRoutes);
  app.use('/api/audit', authenticate, auditRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use(express.static(path.resolve('public')));

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, _next) => {
    if (req.file && !req.keepUpload && fs.existsSync(req.file.path)) await removeFile(req.file.path);

    let status = err.status ?? 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than the upload limit' : 'Invalid upload';
    }
    if (status === 403 && req.user) {
      try {
        audit(req, 'ACCESS_DENIED', 'route', '', `${req.method} ${req.originalUrl}`);
      } catch (auditError) {
        console.error(auditError);
      }
    }
    if (status >= 500) {
      console.error(err);
      message = 'Internal server error';
    }
    if (res.headersSent) return res.destroy();
    res.status(status).json({ error: message });
  });

  return app;
}
