import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { all, get, run, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { HttpError, id, nowIso, oneOf, password, text } from '../lib/util.js';
import { requirePermission } from '../middleware/auth.js';
import { PERMISSIONS, ROLES } from '../permissions.js';

const router = Router();
router.use(requirePermission('user.manage'));

const USER_FIELDS = 'id, username, full_name, email, role, is_active, created_at, last_login_at';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(body) {
  const value = text(body, 'email', { max: 200, label: 'Email' });
  if (!EMAIL.test(value)) throw new HttpError(400, 'Email address is not valid');
  return value;
}

function assertEmailFree(value, exceptId = 0) {
  if (get('SELECT 1 AS ok FROM users WHERE email = ? AND id <> ?', value, exceptId)) {
    throw new HttpError(409, 'That email is already in use');
  }
}

router.get('/', (_req, res) => {
  res.json({
    users: all(`SELECT ${USER_FIELDS} FROM users ORDER BY full_name`),
    roles: ROLES,
    matrix: PERMISSIONS,
  });
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const username = text(body, 'username', { max: 100, label: 'Username' });
  if (!/^[\w.-]+$/.test(username)) throw new HttpError(400, 'Username may contain only letters, digits, dot, dash and underscore');
  const fullName = text(body, 'full_name', { max: 200, label: 'Full name' });
  const mail = email(body);
  const role = oneOf(body.role, ROLES, 'Role');
  const hash = await bcrypt.hash(password(body.password), 10);
  if (get('SELECT 1 AS ok FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is already taken');
  assertEmailFree(mail);
  const now = nowIso();
  const created = tx(() => {
    const result = run(
      'INSERT INTO users (username, full_name, email, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      username, fullName, mail, hash, role, now, now,
    );
    audit(req, 'USER_CREATED', 'user', username, `Role: ${role}`);
    return get(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, Number(result.lastInsertRowid));
  });
  res.status(201).json(created);
});

router.patch('/:id', (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', id(req.params.id, 'user id'));
  if (!target) throw new HttpError(404, 'User not found');
  const body = req.body ?? {};
  const has = (key) => Object.hasOwn(body, key);
  const role = has('role') ? oneOf(body.role, ROLES, 'Role') : target.role;
  const isActive = has('is_active') ? (body.is_active ? 1 : 0) : target.is_active;
  const fullName = has('full_name') ? text(body, 'full_name', { max: 200, label: 'Full name' }) : target.full_name;
  const mail = has('email') ? email(body) : target.email;
  assertEmailFree(mail, target.id);

  // An admin always remains: nobody can remove their own admin access.
  if (target.id === req.user.id && (role !== 'Admin' || !isActive)) {
    throw new HttpError(409, 'You cannot remove your own admin access');
  }
  if ((!isActive || role === 'Auditor') && (target.is_active !== isActive || target.role !== role)) {
    const { held } = get(
      "SELECT COUNT(*) AS held FROM evidence WHERE current_custodian_id = ? AND status NOT IN ('Released','Archived')", target.id,
    );
    if (held > 0) throw new HttpError(409, `This user holds ${held} evidence item(s). Transfer custody first.`);
  }
  if (role !== 'Forensic Investigator' && target.role === 'Forensic Investigator') {
    const { open } = get(
      "SELECT COUNT(*) AS open FROM case_assignments a JOIN cases c ON c.id = a.case_id WHERE a.user_id = ? AND c.status <> 'Closed'", target.id,
    );
    if (open > 0) throw new HttpError(409, `This investigator is assigned to ${open} open case(s). Reassign them first.`);
  }

  const changes = [];
  if (role !== target.role) changes.push(`role: ${target.role} -> ${role}`);
  if (isActive !== target.is_active) changes.push(isActive ? 'reactivated' : 'deactivated');
  tx(() => {
    run('UPDATE users SET full_name = ?, email = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?',
      fullName, mail, role, isActive, nowIso(), target.id);
    audit(req, role !== target.role ? 'USER_ROLE_CHANGED' : 'USER_UPDATED', 'user', target.username, changes.join('; '));
  });
  res.json(get(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, target.id));
});

router.post('/:id/reset-password', async (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', id(req.params.id, 'user id'));
  if (!target) throw new HttpError(404, 'User not found');
  const hash = await bcrypt.hash(password(req.body?.password), 10);
  tx(() => {
    run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', hash, nowIso(), target.id);
    audit(req, 'USER_PASSWORD_RESET', 'user', target.username);
  });
  res.status(204).end();
});

export default router;
