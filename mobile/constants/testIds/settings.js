// Dalga 3 — Ayarlar + Admin panelleri testID'leri.
export const SETTINGS = {
  open: 'profile-settings-open',
  screen: 'settings-screen',
  back: 'settings-back',
  digestEnabled: 'settings-digest-enabled',
  digestDetailed: 'settings-digest-detailed',
  digestSkipWeekend: 'settings-digest-skip-weekend',
  digestHourInc: 'settings-digest-hour-inc',
  digestHourDec: 'settings-digest-hour-dec',
  digestSave: 'settings-digest-save',
  navUsers: 'settings-nav-users',
  navAnnouncements: 'settings-nav-announcements',
  navCompanies: 'settings-nav-companies',
  navLicenses: 'settings-nav-licenses',
  navPermissions: 'settings-nav-permissions',
  navSuperAdmins: 'settings-nav-super-admins',
  navClientLogs: 'settings-nav-client-logs',
};

// Frontend Hata Radarı ekranı (yalnızca süper yönetici).
export const CLIENTLOGS = {
  screen: 'client-logs-screen',
  list: 'client-logs-list',
  clear: 'client-logs-clear',
  empty: 'client-logs-empty',
  refresh: 'client-logs-refresh',
};

// Süper Yönetici paneli (yalnızca süper yönetici).
export const SUPERADMIN = {
  screen: 'super-admins-screen',
  list: 'super-admins-list',
  adminRow: (id) => `super-admin-caps-${id}`,
  capViewTasks: (id) => `super-cap-view-tasks-${id}`,
  capCreateCompany: (id) => `super-cap-create-company-${id}`,
  extraCompany: (id, cid) => `super-extra-company-${id}-${cid}`,
  grantHours: (id) => `super-grant-hours-${id}`,
  promote: (id) => `super-promote-${id}`,
  revoke: (id) => `super-revoke-${id}`,
};

// Mobil Kullanıcı Detay ekranı (admin → Kullanıcılar → kişi).
export const USER_DETAIL = {
  screen: 'user-detail-screen',
  edit: 'user-detail-edit',
  delete: 'user-detail-delete',
  quota: 'user-detail-quota',
  summary: 'user-detail-summary',
};

export const ADMIN = {
  userItem: 'admin-user-item',
  userAdd: 'admin-user-add',
  userDelete: 'admin-user-delete',
  userSave: 'admin-user-save',
  fUsername: 'admin-user-username',
  fPassword: 'admin-user-password',
  fRole: 'admin-user-role',
  fCompany: 'admin-user-company',

  annItem: 'admin-ann-item',
  annAdd: 'admin-ann-add',
  annDelete: 'admin-ann-delete',
  annSave: 'admin-ann-save',
  fAnnTitle: 'admin-ann-title',
  fAnnMessage: 'admin-ann-message',
  fAnnSeverity: 'admin-ann-severity',

  compItem: 'admin-company-item',
  compAdd: 'admin-company-add',
  compDelete: 'admin-company-delete',
  compSave: 'admin-company-save',
  fCompName: 'admin-company-name',

  licItem: 'admin-license-item',
  licGenerate: 'admin-license-generate',
  licDelete: 'admin-license-delete',
  fLicType: 'admin-license-type',
  fLicCount: 'admin-license-count',

  mvItem: 'admin-mv-item',
  mvAdd: 'admin-mv-add',
  mvDelete: 'admin-mv-delete',
  fMvManager: 'admin-mv-manager',
  fMvEmployee: 'admin-mv-employee',
};
