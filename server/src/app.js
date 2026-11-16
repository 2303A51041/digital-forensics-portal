import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import multer from 'multer';
import { config } from './config.js';
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
  // Only needed when the React dev server (another origin) calls the API directly.
  app.use('/api', cors({ origin: config.clientOrigin, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));

  // Used by Docker HEALTHCHECK and Kubernetes probes: 503 tells them the database is unreachable.
  app.get('/api/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({
      status: connected ? 'ok' : 'degraded',
      database: connected ? 'connected' : 'disconnected',
      uptime: Math.round(process.uptime()),
    });
  });
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

  // In production the built React app is served from the same port as the API.
  const indexFile = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(config.clientDist, { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(indexFile));
  } else {
    app.get('/', (_req, res) => res.type('text').send(
      'API is running. The React app has not been built yet: run "npm run build" and restart, or use "npm run dev" and open http://localhost:5173',
    ));
  }

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, _next) => {
    if (req.file && !req.keepUpload && fs.existsSync(req.file.path)) await removeFile(req.file.path);

    let status = err.status ?? 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than the upload limit' : 'Invalid upload';
    } else if (err instanceof mongoose.Error.ValidationError) {
      status = 400;
      message = Object.values(err.errors).map((e) => e.message).join('; ');
    } else if (err instanceof mongoose.Error.CastError) {
      status = 400;
      message = `Invalid ${err.path}`;
    } else if (err?.code === 11000) {
      status = 409;
      message = 'That record already exists';
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'Request body is not valid JSON';
    }
    if (status === 403 && req.user) {
      await audit(req, 'ACCESS_DENIED', 'route', '', `${req.method} ${req.originalUrl}`).catch((e) => console.error(e));
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
