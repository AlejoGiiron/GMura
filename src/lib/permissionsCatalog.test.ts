import { describe, it, expect } from 'vitest'
import { ALL_PERMISSIONS, CATALOG_KEYS } from './permissionsCatalog'

describe('permissionsCatalog', () => {
  it('cubre EXACTAMENTE los 17 permisos canónicos (sin huérfanos ni sobrantes)', () => {
    expect([...CATALOG_KEYS].sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  it('la lista canónica tiene 17 permisos', () => {
    expect(ALL_PERMISSIONS.length).toBe(17)
  })

  it('no hay permisos duplicados en el catálogo', () => {
    expect(new Set(CATALOG_KEYS).size).toBe(CATALOG_KEYS.length)
  })

  it("no incluye el comodín '*' (es especial, no editable)", () => {
    expect(CATALOG_KEYS).not.toContain('*')
    expect(ALL_PERMISSIONS as readonly string[]).not.toContain('*')
  })
})
