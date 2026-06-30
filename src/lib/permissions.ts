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
