export const ROLES = ['Admin', 'Forensic Investigator', 'Case Manager', 'Auditor'];
export const INVESTIGATOR = 'Forensic Investigator';

const A = 'Admin', F = INVESTIGATOR, M = 'Case Manager', U = 'Auditor';

/** Single source of truth for access control; the UI renders this same matrix. */
export const PERMISSIONS = {
  'case.create':        { label: 'Create cases',                       roles: [A, M] },
  'case.assign':        { label: 'Assign investigators',               roles: [A, M] },
  'case.update':        { label: 'Update case details and status',     roles: [A, M] },
  'case.viewAll':       { label: 'View all cases (otherwise assigned only)', roles: [A, M, U] },
  'evidence.register':  { label: 'Register evidence',                  roles: [A, M, F] },
  'evidence.download':  { label: 'Download evidence files',            roles: [A, M, F] },
  'evidence.verify':    { label: 'Verify evidence integrity',          roles: [A, M, F, U] },
  'custody.transfer':   { label: 'Record custody transfers',           roles: [A, M, F] },
  'finding.write':      { label: 'Write findings',                     roles: [A, F] },
  'finding.finalize':   { label: 'Finalize findings',                  roles: [A, M, F] },
  'summary.generate':   { label: 'Generate case summaries',            roles: [A, M, F] },
  'report.view':        { label: 'View and export reports',            roles: [A, M, U] },
  'audit.view':         { label: 'View audit and access logs',         roles: [A, U] },
  'user.manage':        { label: 'Manage users and roles',             roles: [A] },
};

export const can = (user, permission) => PERMISSIONS[permission].roles.includes(user.role);

export const permissionsFor = (role) =>
  Object.keys(PERMISSIONS).filter((key) => PERMISSIONS[key].roles.includes(role));
