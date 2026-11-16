import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit.js';
import { HttpError, password, text } from '../lib/util.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { User } from '../models/index.js';
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

export const publicUser = (user) => ({
  id: String(user._id),
  username: user.username,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  permissions: permissionsFor(user.role),
});

router.post('/login', loginLimiter, async (req, res) => {
  const username = text(req.body ?? {}, 'username', { max: 100, label: 'Username' }).toLowerCase();
  const pass = String(req.body?.password ?? '');
  const user = await User.findOne({ username }).select('+passwordHash +tokenVersion');
  const matches = await bcrypt.compare(pass, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches || !user.isActive) {
    await audit(req, 'LOGIN_FAILED', 'user', '', `Attempted username: ${username}`, null);
    throw new HttpError(401, 'Invalid username or password');
  }
  user.lastLoginAt = new Date();
  await user.save();
  await audit(req, 'LOGIN_SUCCESS', 'user', user.username, '', user);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user), permissionMatrix: PERMISSIONS });
});

router.post('/logout', authenticate, async (req, res) => {
  await audit(req, 'LOGOUT', 'user', req.user.username);
  res.status(204).end();
});

router.post('/change-password', authenticate, async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash +tokenVersion');
  if (!(await bcrypt.compare(String(req.body?.currentPassword ?? ''), user.passwordHash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(password(req.body?.newPassword), 10);
  user.tokenVersion += 1;
  await user.save();
  await audit(req, 'PASSWORD_CHANGED', 'user', user.username);
  res.json({ token: signToken(user) });
});

export default router;
