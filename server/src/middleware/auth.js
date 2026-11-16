import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError, objectId } from '../lib/util.js';
import { Case, User } from '../models/index.js';
import { can, PERMISSIONS } from '../permissions.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion ?? 0 }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });

/** The user is reloaded on every request so role changes and deactivation apply immediately. */
export async function authenticate(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentication required');
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session expired, please sign in again');
  }
  const user = /^[0-9a-f]{24}$/i.test(claims.sub ?? '') ? await User.findById(claims.sub).select('+tokenVersion') : null;
  if (!user || !user.isActive || user.tokenVersion !== claims.tv) {
    throw new HttpError(401, 'Session is no longer valid');
  }
  req.user = user;
  next();
}

export const requirePermission = (permission) => {
  if (!PERMISSIONS[permission]) throw new Error(`Unknown permission: ${permission}`);
  return (req, _res, next) => {
    if (!can(req.user, permission)) throw new HttpError(403, 'You do not have permission to perform this action');
    next();
  };
};

export const isAssigned = (caseDoc, userId) =>
  caseDoc.assignments.some((a) => String(a.user?._id ?? a.user) === String(userId));

/** MongoDB filter restricting cases to those this user may see. */
export const caseScope = (user) => (can(user, 'case.viewAll') ? {} : { 'assignments.user': user._id });

/** Case ids the user may see, or null when the user may see every case. */
export async function visibleCaseIds(user) {
  if (can(user, 'case.viewAll')) return null;
  return (await Case.find(caseScope(user)).select('_id').lean()).map((c) => c._id);
}

/** Adds a "case is visible" condition to a filter on a collection with a `case` field. */
export async function scopeByCase(user, filter = {}, field = 'case') {
  const ids = await visibleCaseIds(user);
  if (!ids) return filter;
  const visible = { $in: ids };
  if (filter[field]) return { ...filter, $and: [{ [field]: filter[field] }, { [field]: visible }] };
  return { ...filter, [field]: visible };
}

/** Loads a case the user may see. Out-of-scope cases return 404 so their existence is not revealed. */
export async function loadCase(req, rawId) {
  const caseId = objectId(rawId, 'case id');
  const doc = await Case.findById(caseId);
  if (!doc || (!can(req.user, 'case.viewAll') && !isAssigned(doc, req.user._id))) {
    throw new HttpError(404, 'Case not found');
  }
  return doc;
}
