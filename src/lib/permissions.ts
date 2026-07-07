/**
 * Lógica pura de permisos RBAC (sin React ni red, testeable).
 *
 * Los permisos del usuario salen del array `roles.permissions` de su rol.
 * El comodín '*' (rol Dueño) concede cualquier permiso.
 *
 * IMPORTANTE: esto es solo EXPERIENCIA de UI. La seguridad real la impone el
 * RLS en la base de datos (has_permission en las políticas). El front nunca
 * debe asumir que ocultar un botón protege algo.
 */
export function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes('*') || permissions.includes(perm)
}

/**
 * Un rol es "gestor" (multi-tienda, equivalente al admin legacy) si puede
 * gestionar usuarios. El comodín '*' del Dueño también cuenta.
 */
export function isManagerRole(permissions: string[]): boolean {
  return hasPermission(permissions, 'usuarios.gestionar')
}

/**
 * Deriva el enum legacy (admin/seller) a partir de los permisos del rol RBAC.
 * Se usa para NO dejar stale la columna profiles.role mientras el enum y el
 * role_id coexisten. Un rol con usuarios.gestionar (o '*') → 'admin'; si no,
 * 'seller'.
 */
export function deriveLegacyRole(permissions: string[]): 'admin' | 'seller' {
  return isManagerRole(permissions) ? 'admin' : 'seller'
}
