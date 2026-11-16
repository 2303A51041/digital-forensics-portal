// The eight main screens, in sidebar order. `permission` hides a screen from roles that cannot use it.
export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/cases', label: 'Case Management' },
  { path: '/evidence', label: 'Evidence Registration' },
  { path: '/custody', label: 'Chain of Custody' },
  { path: '/findings', label: 'Findings & Summaries' },
  { path: '/users', label: 'Users & Access', permission: 'user.manage' },
  { path: '/reports', label: 'Reports Hub', permission: 'report.view' },
  { path: '/audit', label: 'Audit & Access Logs', permission: 'audit.view' },
];
