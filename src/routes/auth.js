import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { get, run, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { HttpError, nowIso, password, text } from '../lib/util.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { PERMISSIONS, permissionsFor } from '../permissions.js';

const router = Router();

// Compared against when the username is unknown, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed sign-in attempts. Try again in 15 minutes.' },
});

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  full_name: user.full_name,
  email: user.email,
  role: user.role,
  permissions: permissionsFor(user.role),
});

router.post('/login', loginLimiter, async (req, res) => {
  const username = text(req.body ?? {}, 'username', { max: 100, label: 'Username' });
  const pass = String(req.body?.password ?? '');
  const user = get('SELECT * FROM users WHERE username = ?', username);
  const matches = await bcrypt.compare(pass, user?.password_hash ?? DUMMY_HASH);
  if (!user || !matches || !user.is_active) {
    audit(req, 'LOGIN_FAILED', 'user', '', `Attempted username: ${username}`, null);
    throw new HttpError(401, 'Invalid username or password');
  }
  tx(() => {
    run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
    audit(req, 'LOGIN_SUCCESS', 'user', user.id, '', user);
  });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user), permissionMatrix: PERMISSIONS });
});

router.post('/logout', authenticate, (req, res) => {
  audit(req, 'LOGOUT', 'user', req.user.id);
  res.status(204).end();
});

router.post('/change-password', authenticate, async (req, res) => {
  const current = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!(await bcrypt.compare(String(req.body?.current_password ?? ''), current.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  const hash = await bcrypt.hash(password(req.body?.new_password), 10);
  tx(() => {
    run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?',
      hash, nowIso(), req.user.id);
    audit(req, 'PASSWORD_CHANGED', 'user', req.user.id);
  });
  const fresh = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ token: signToken(fresh) });
});

export default router;
