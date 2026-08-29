// Rol hiyerarşisi yardımcıları (web) — backend acting_role/effective_role ile
// birebir. Süper Yönetici (super_admin) + Kurucu (is_owner), Yönetici (admin),
// Müdür (manager), İşçi (employee).
//
// KURAL: Bugüne kadar "yönetici" (admin) için açık olan tüm UI, artık
// super_admin/owner için de açık olmalı (isAdminLike). Sistem-geneli ayarlar
// ise yalnızca süper yöneticiye açıktır (isSuperAdmin).

export const isOwner = (u) => !!(u && u.is_owner);

export const isSuperAdmin = (u) =>
  !!(u && (u.is_owner || u.role === "super_admin" || u.is_super_admin === true));

// admin VEYA super_admin/owner — mevcut "Yönetici" arayüzü bu tiere açık.
export const isAdminLike = (u) => isSuperAdmin(u) || (u && u.role === "admin");

export const isManager = (u) => !!(u && u.role === "manager");

export const adminCaps = (u) => (u && u.admin_caps) || {};

export const roleLabel = (role, is_owner) => {
  if (is_owner) return "Kurucu";
  const map = {
    super_admin: "Süper Yönetici",
    admin: "Yönetici",
    manager: "Müdür",
    employee: "İşçi",
    user: "İşçi",
  };
  return map[role] || role || "İşçi";
};
