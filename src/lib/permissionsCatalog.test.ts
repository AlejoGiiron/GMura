import { describe, it, expect } from 'vitest'
import { ALL_PERMISSIONS, CATALOG_KEYS } from './permissionsCatalog'

describe('permissionsCatalog', () => {
  it('cubre EXACTAMENTE los 19 permisos canónicos (sin huérfanos ni sobrantes)', () => {
    expect([...CATALOG_KEYS].sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  it('la lista canónica tiene 19 permisos', () => {
    expect(ALL_PERMISSIONS.length).toBe(19)
  })

  it('incluye ventas.regalo (permiso de la 027)', () => {
    expect(ALL_PERMISSIONS as readonly string[]).toContain('ventas.regalo')
    expect(CATALOG_KEYS).toContain('ventas.regalo')
  })

  it('incluye ventas.fiar (permiso de la 029)', () => {
    expect(ALL_PERMISSIONS as readonly string[]).toContain('ventas.fiar')
    expect(CATALOG_KEYS).toContain('ventas.fiar')
  })

  it('no hay permisos duplicados en el catálogo', () => {
    expect(new Set(CATALOG_KEYS).size).toBe(CATALOG_KEYS.length)
  })

  it("no incluye el comodín '*' (es especial, no editable)", () => {
    expect(CATALOG_KEYS).not.toContain('*')
    expect(ALL_PERMISSIONS as readonly string[]).not.toContain('*')
  })
})
