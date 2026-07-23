import { describe, it, expect } from 'vitest'
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
  validatePasswordChange,
  generateReadablePassword,
} from './passwordPolicy'

describe('validatePasswordStrength', () => {
  it('rechaza vacío', () => {
    expect(validatePasswordStrength('').ok).toBe(false)
  })

  it('rechaza por debajo del mínimo', () => {
    const r = validatePasswordStrength('1234567') // 7
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('acepta justo en el mínimo', () => {
    expect(validatePasswordStrength('12345678').ok).toBe(true) // 8
  })

  it('acepta más largo', () => {
    expect(validatePasswordStrength('claveSegura123').ok).toBe(true)
  })
})

describe('validatePasswordChange', () => {
  const base = { current: 'viejaClave1', next: 'nuevaClave1', confirm: 'nuevaClave1' }

  it('acepta un cambio válido', () => {
    expect(validatePasswordChange(base).ok).toBe(true)
  })

  it('rechaza nueva demasiado corta antes que nada', () => {
    const r = validatePasswordChange({ current: 'viejaClave1', next: 'corta', confirm: 'corta' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('rechaza si la confirmación no coincide', () => {
    const r = validatePasswordChange({ ...base, confirm: 'otraCosa123' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/confirmación/i)
  })

  it('rechaza si la nueva es igual a la actual', () => {
    const r = validatePasswordChange({ current: 'mismaClave1', next: 'mismaClave1', confirm: 'mismaClave1' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/distinta/i)
  })

  it('prioriza fuerza sobre coincidencia (nueva corta y además no coincide)', () => {
    const r = validatePasswordChange({ current: 'viejaClave1', next: 'abc', confirm: 'xyz' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(MIN_PASSWORD_LENGTH))
  })
})

describe('generateReadablePassword', () => {
  it('respeta el largo pedido', () => {
    expect(generateReadablePassword(10)).toHaveLength(10)
  })

  it('nunca baja del mínimo de política', () => {
    expect(generateReadablePassword(3).length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
  })

  it('solo usa caracteres legibles (sin 0/O/1/l/I)', () => {
    const pw = generateReadablePassword(64)
    expect(pw).toMatch(/^[a-hj-km-zA-HJ-NP-Z2-9]+$/)
    expect(pw).not.toMatch(/[0O1lI]/)
  })

  it('la clave generada pasa la política', () => {
    expect(validatePasswordStrength(generateReadablePassword()).ok).toBe(true)
  })
})
