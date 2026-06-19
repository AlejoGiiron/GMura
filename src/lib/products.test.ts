import { describe, it, expect } from 'vitest'
import { priceRange } from './products'

const v = (price: number, is_active = true) => ({ price, is_active })

describe('priceRange', () => {
  it('una sola variante activa → min === max', () => {
    expect(priceRange([v(50_000)])).toEqual({ min: 50_000, max: 50_000 })
  })

  it('varias variantes con el mismo precio → min === max', () => {
    expect(priceRange([v(50_000), v(50_000), v(50_000)])).toEqual({
      min: 50_000,
      max: 50_000,
    })
  })

  it('varias variantes con precios distintos → rango min–max', () => {
    expect(priceRange([v(60_000), v(40_000), v(50_000)])).toEqual({
      min: 40_000,
      max: 60_000,
    })
  })

  it('sin variantes → null', () => {
    expect(priceRange([])).toBeNull()
  })

  it('sin variantes activas → null', () => {
    expect(priceRange([v(50_000, false), v(70_000, false)])).toBeNull()
  })

  it('ignora variantes inactivas al calcular el rango', () => {
    // La inactiva de 999.000 no debe afectar el máximo.
    expect(priceRange([v(40_000), v(60_000), v(999_000, false)])).toEqual({
      min: 40_000,
      max: 60_000,
    })
  })
})
