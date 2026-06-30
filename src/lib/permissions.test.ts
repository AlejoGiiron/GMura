import { describe, it, expect } from 'vitest'
import { hasPermission } from './permissions'

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
