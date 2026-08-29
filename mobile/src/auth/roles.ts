// Rol hiyerarşisi yardımcıları (mobil) — web/backend ile birebir.
// Süper Yönetici (super_admin) + Kurucu (is_owner) > Yönetici (admin) >
// Müdür (manager) > İşçi (employee). Bugüne kadar "admin"e açık olan tüm
// arayüz artık super_admin/owner için de açık (isAdminLike). Sistem-geneli
// ayarlar yalnızca süper yöneticiye açık (isSuperAdmin).

type RoleUser = { role?: string; is_owner?: boolean; is_super_admin?: boolean } | null | undefined;

export const isOwner = (u: RoleUser) => !!(u && u.is_owner);

export const isSuperAdmin = (u: RoleUser) =>
  !!(u && (u.is_owner || u.role === "super_admin" || u.is_super_admin === true));

export const isAdminLike = (u: RoleUser) => isSuperAdmin(u) || (!!u && u.role === "admin");

export const isManager = (u: RoleUser) => !!(u && u.role === "manager");

export const roleLabel = (role?: string, is_owner?: boolean) => {
  if (is_owner) return "Kurucu";
  const map: Record<string, string> = {
    super_admin: "Süper Yönetici",
    admin: "Yönetici",
    manager: "Müdür",
    employee: "İşçi",
    user: "İşçi",
  };
  return (role && map[role]) || role || "İşçi";
};
