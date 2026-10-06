import { describe, it, expect } from 'vitest'
import { buildAdjustReason, computeAdjustment, isValidAdjustDetail } from './stockAdjust'

describe('computeAdjustment — sumar o restar', () => {
  it('positivo suma, negativo resta', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '3', current: 10, reserved: 0 })).toEqual({
      delta: 3, resulting: 13, expectedQty: null, error: null,
    })
    expect(computeAdjustment({ mode: 'delta', qtyInput: '-2', current: 10, reserved: 0 }).resulting).toBe(8)
  })

  it('acepta el signo + explícito', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '+4', current: 1, reserved: 0 }).delta).toBe(4)
  })

  it('no manda expectedQty: un delta conmuta con las ventas concurrentes', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '5', current: 10, reserved: 0 }).expectedQty).toBeNull()
  })

  it('0 no es un ajuste', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '0', current: 10, reserved: 0 }).error).toMatch(/distinta de 0/)
  })

  it('no deja quedar en negativo', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '-11', current: 10, reserved: 0 }).error).toMatch(/negativo/)
  })

  it('no deja quedar por debajo de lo reservado', () => {
    const r = computeAdjustment({ mode: 'delta', qtyInput: '-8', current: 11, reserved: 4 })
    expect(r.resulting).toBe(3)
    expect(r.error).toMatch(/apartado en separados \(4 reservadas\)/)
  })

  it('justo lo reservado sí se puede', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '-7', current: 11, reserved: 4 }).error).toBeNull()
  })
})

describe('computeAdjustment — conteo físico', () => {
  it('el delta es conteo − stock mostrado, y viaja el stock mostrado', () => {
    expect(computeAdjustment({ mode: 'count', qtyInput: '12', current: 10, reserved: 0 })).toEqual({
      delta: 2, resulting: 12, expectedQty: 10, error: null,
    })
    expect(computeAdjustment({ mode: 'count', qtyInput: '7', current: 10, reserved: 0 }).delta).toBe(-3)
  })

  it('si el conteo coincide no hay nada que ajustar', () => {
    expect(computeAdjustment({ mode: 'count', qtyInput: '10', current: 10, reserved: 0 }).error).toMatch(/coincide/)
  })

  it('un conteo negativo no tiene sentido', () => {
    expect(computeAdjustment({ mode: 'count', qtyInput: '-1', current: 10, reserved: 0 }).error).toMatch(/negativo/)
  })

  it('contar menos de lo reservado tampoco', () => {
    expect(computeAdjustment({ mode: 'count', qtyInput: '2', current: 10, reserved: 3 }).error).toMatch(/apartado/)
  })
})

describe('computeAdjustment — entrada', () => {
  it('vacío: sin error todavía (no grita mientras escribe)', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '  ', current: 10, reserved: 0 })).toEqual({
      delta: null, resulting: null, expectedQty: null, error: null,
    })
  })

  it('decimales o texto: error', () => {
    expect(computeAdjustment({ mode: 'delta', qtyInput: '1.5', current: 10, reserved: 0 }).error).toMatch(/entero/)
    expect(computeAdjustment({ mode: 'count', qtyInput: 'doce', current: 10, reserved: 0 }).error).toMatch(/entero/)
  })
})

describe('buildAdjustReason', () => {
  it('antepone el tipo entre corchetes', () => {
    expect(buildAdjustReason('Merma', ' Se manchó en vitrina ')).toBe('[Merma] Se manchó en vitrina')
  })

  it('"Otro" o sin tipo: solo el detalle', () => {
    expect(buildAdjustReason('Otro', 'Error de carga')).toBe('Error de carga')
    expect(buildAdjustReason('', 'Error de carga')).toBe('Error de carga')
  })
})

describe('isValidAdjustDetail', () => {
  it('pide al menos 3 caracteres escritos (la RPC exige lo mismo)', () => {
    expect(isValidAdjustDetail('  ok ')).toBe(false)
    expect(isValidAdjustDetail('roto')).toBe(true)
  })
})
