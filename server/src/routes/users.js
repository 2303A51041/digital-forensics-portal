import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { HttpError, objectId, oneOf, password, text } from '../lib/util.js';
import { requirePermission } from '../middleware/auth.js';
import { Case, Evidence, FINAL_EVIDENCE_STATUSES, User } from '../models/index.js';
import { INVESTIGATOR, PERMISSIONS, ROLES } from '../permissions.js';

const router = Router();
router.use(requirePermission('user.manage'));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(body) {
  const value = text(body, 'email', { max: 200, label: 'Email' }).toLowerCase();
  if (!EMAIL.test(value)) throw new HttpError(400, 'Email address is not valid');
  return value;
}

async function assertEmailFree(value, exceptId = null) {
  if (await User.exists({ email: value, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) {
    throw new HttpError(409, 'That email is already in use');
  }
}

router.get('/', async (_req, res) => {
  res.json({ users: await User.find().sort({ fullName: 1 }), roles: ROLES, matrix: PERMISSIONS });
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const username = text(body, 'username', { max: 100, label: 'Username' }).toLowerCase();
  if (!/^[\w.-]+$/.test(username)) throw new HttpError(400, 'Username may contain only letters, digits, dot, dash and underscore');
  const fullName = text(body, 'fullName', { max: 200, label: 'Full name' });
  const mail = email(body);
  const role = oneOf(body.role, ROLES, 'Role');
  const passwordHash = await bcrypt.hash(password(body.password), 10);
  if (await User.exists({ username })) throw new HttpError(409, 'That username is already taken');
  await assertEmailFree(mail);

  const user = await User.create({ username, fullName, email: mail, role, passwordHash });
  await audit(req, 'USER_CREATED', 'user', username, `Role: ${role}`);
  res.status(201).json(await User.findById(user._id));
});

router.patch('/:id', async (req, res) => {
  const target = await User.findById(objectId(req.params.id, 'user id'));
  if (!target) throw new HttpError(404, 'User not found');
  const body = req.body ?? {};
  const has = (key) => Object.hasOwn(body, key);
  const role = has('role') ? oneOf(body.role, ROLES, 'Role') : target.role;
  const isActive = has('isActive') ? Boolean(body.isActive) : target.isActive;
  const fullName = has('fullName') ? text(body, 'fullName', { max: 200, label: 'Full name' }) : target.fullName;
  const mail = has('email') ? email(body) : target.email;
  await assertEmailFree(mail, target._id);

  // An admin always remains: nobody can remove their own admin access.
  if (target._id.equals(req.user._id) && (role !== 'Admin' || !isActive)) {
    throw new HttpError(409, 'You cannot remove your own admin access');
  }
  if ((!isActive || role === 'Auditor') && (target.isActive !== isActive || target.role !== role)) {
    const held = await Evidence.countDocuments({ currentCustodian: target._id, status: { $nin: FINAL_EVIDENCE_STATUSES } });
    if (held > 0) throw new HttpError(409, `This user holds ${held} evidence item(s). Transfer custody first.`);
  }
  if (role !== INVESTIGATOR && target.role === INVESTIGATOR) {
    const open = await Case.countDocuments({ 'assignments.user': target._id, status: { $ne: 'Closed' } });
    if (open > 0) throw new HttpError(409, `This investigator is assigned to ${open} open case(s). Reassign them first.`);
  }

  const changes = [];
  if (role !== target.role) changes.push(`role: ${target.role} -> ${role}`);
  if (isActive !== target.isActive) changes.push(isActive ? 'reactivated' : 'deactivated');
  const roleChanged = role !== target.role;
  Object.assign(target, { fullName, email: mail, role, isActive });
  await target.save();
  await audit(req, roleChanged ? 'USER_ROLE_CHANGED' : 'USER_UPDATED', 'user', target.username, changes.join('; '));
  res.json(target);
});

router.post('/:id/reset-password', async (req, res) => {
  const target = await User.findById(objectId(req.params.id, 'user id')).select('+tokenVersion');
  if (!target) throw new HttpError(404, 'User not found');
  target.passwordHash = await bcrypt.hash(password(req.body?.password), 10);
  target.tokenVersion += 1;
  await target.save();
  await audit(req, 'USER_PASSWORD_RESET', 'user', target.username);
  res.status(204).end();
});

export default router;
