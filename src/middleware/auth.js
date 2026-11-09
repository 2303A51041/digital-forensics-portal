import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get } from '../db/index.js';
import { HttpError, id } from '../lib/util.js';
import { can, PERMISSIONS } from '../permissions.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user.id), tv: user.token_version }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  });

/** The user is reloaded per request so role changes and deactivation apply immediately. */
export function authenticate(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentication required');
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session expired, please sign in again');
  }
  const user = get(
    'SELECT id, username, full_name, email, role, is_active, token_version FROM users WHERE id = ?',
    Number(claims.sub),
  );
  if (!user || !user.is_active || user.token_version !== claims.tv) {
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

export const isAssigned = (userId, caseId) =>
  Boolean(get('SELECT 1 AS ok FROM case_assignments WHERE case_id = ? AND user_id = ?', caseId, userId));

/** Loads a case the user may see. Out-of-scope cases return 404 so their existence is not revealed. */
export function loadCase(req, rawId) {
  const caseId = id(rawId, 'case id');
  const row = get('SELECT * FROM cases WHERE id = ?', caseId);
  if (!row || (!can(req.user, 'case.viewAll') && !isAssigned(req.user.id, caseId))) {
    throw new HttpError(404, 'Case not found');
  }
  return row;
}

/** SQL restricting a query on a cases alias to what this user can see. */
export function caseScope(user, alias = 'c') {
  if (can(user, 'case.viewAll')) return { sql: '1 = 1', params: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM case_assignments sa WHERE sa.case_id = ${alias}.id AND sa.user_id = ?)`,
    params: [user.id],
  };
}
