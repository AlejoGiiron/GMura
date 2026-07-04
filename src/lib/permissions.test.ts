import { describe, it, expect } from 'vitest'
import { hasPermission, isManagerRole, deriveLegacyRole } from './permissions'

describe('hasPermission', () => {
  it('devuelve true cuando el permiso está presente', () => {
    expect(hasPermission(['pos.usar', 'clientes.gestionar'], 'pos.usar')).toBe(true)
  })

  it('devuelve false cuando el permiso está ausente', () => {
    expect(hasPermission(['pos.usar', 'inventario.ver'], 'productos.gestionar')).toBe(
      false,
    )
  })

  it("el comodín '*' concede cualquier permiso (incluido uno inventado)", () => {
    expect(hasPermission(['*'], 'productos.gestionar')).toBe(true)
    expect(hasPermission(['*'], 'xyz.no.existe.123')).toBe(true)
  })

  it('array vacío → false para todo', () => {
    expect(hasPermission([], 'pos.usar')).toBe(false)
    expect(hasPermission([], '*')).toBe(false)
  })

  it("'*' junto a otros permisos también concede todo", () => {
    expect(hasPermission(['pos.usar', '*'], 'compras.gestionar')).toBe(true)
  })
})

describe('isManagerRole', () => {
  it('true si tiene usuarios.gestionar', () => {
    expect(isManagerRole(['pos.usar', 'usuarios.gestionar'])).toBe(true)
  })
  it('true si tiene el comodín (Dueño)', () => {
    expect(isManagerRole(['*'])).toBe(true)
  })
  it('false para un vendedor', () => {
    expect(isManagerRole(['pos.usar', 'separados.gestionar'])).toBe(false)
  })
})

describe('deriveLegacyRole', () => {
  it("rol con usuarios.gestionar → 'admin'", () => {
    expect(deriveLegacyRole(['pos.usar', 'usuarios.gestionar'])).toBe('admin')
  })
  it("Dueño ('*') → 'admin'", () => {
    expect(deriveLegacyRole(['*'])).toBe('admin')
  })
  it("rol operativo → 'seller'", () => {
    expect(deriveLegacyRole(['pos.usar', 'inventario.ver'])).toBe('seller')
  })
  it("array vacío → 'seller'", () => {
    expect(deriveLegacyRole([])).toBe('seller')
  })
})
