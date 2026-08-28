import { describe, it, expect } from 'vitest'
import {
  formatTransferNumber,
  formatTransferMoney,
  confirmedBy,
  resolutionKind,
  mappingType,
  RESOLUTION_TOKENS,
  MAPPING_TOKENS,
  TRANSFER_STATUS_TOKENS,
} from './transfers'

describe('formatTransferNumber', () => {
  it('rellena a 4 dígitos con el prefijo TR-', () => {
    expect(formatTransferNumber(1)).toBe('TR-0001')
    expect(formatTransferNumber(42)).toBe('TR-0042')
    expect(formatTransferNumber(1337)).toBe('TR-1337')
  })

  it('no trunca cuando el número pasa de 4 dígitos', () => {
    expect(formatTransferNumber(12345)).toBe('TR-12345')
  })
})

describe('formatTransferMoney', () => {
  it('usa signo, espacio, miles con punto y sin decimales', () => {
    expect(formatTransferMoney(89000)).toBe('$ 89.000')
    expect(formatTransferMoney(1204000)).toBe('$ 1.204.000')
    expect(formatTransferMoney(0)).toBe('$ 0')
  })

  it('redondea a pesos (no muestra centavos)', () => {
    expect(formatTransferMoney(89000.4)).toBe('$ 89.000')
  })
})

describe('confirmedBy', () => {
  const DESTINO = 'store-destino'
  const ORIGEN = 'store-origen'

  it('sin recepción todavía devuelve null', () => {
    expect(confirmedBy(null, DESTINO, ORIGEN)).toBeNull()
  })

  it('confirmado desde el destino es el caso normal', () => {
    expect(confirmedBy(DESTINO, DESTINO, ORIGEN)).toBe('destination')
  })

  it('confirmado desde el origen es la EXCEPCIÓN que la UI marca en ámbar', () => {
    expect(confirmedBy(ORIGEN, DESTINO, ORIGEN)).toBe('origin')
  })

  it('confirmado desde una tercera tienda (un admin) se distingue de las dos', () => {
    expect(confirmedBy('store-tercera', DESTINO, ORIGEN)).toBe('other')
  })
})

describe('resolutionKind', () => {
  it('auto_matched GANA sobre la acción elegida: lo que pasó es que hubo gemelo', () => {
    // Los tres dest_action posibles, todos con auto_matched, dan 'twin'.
    expect(resolutionKind('create_product', 'auto_matched')).toBe('twin')
    expect(resolutionKind('map_product', 'auto_matched')).toBe('twin')
    expect(resolutionKind('map_variant', 'auto_matched')).toBe('twin')
  })

  it('as_chosen refleja la acción que eligió quien envió', () => {
    expect(resolutionKind('map_variant', 'as_chosen')).toBe('linked')
    expect(resolutionKind('map_product', 'as_chosen')).toBe('sizeCreated')
    expect(resolutionKind('create_product', 'as_chosen')).toBe('newProduct')
  })
})

describe('mappingType', () => {
  it('mapea cada dest_action a su tipo de color', () => {
    expect(mappingType('map_variant')).toBe('exact')
    expect(mappingType('map_product')).toBe('newSize')
    expect(mappingType('create_product')).toBe('newProduct')
  })

  it('null (estado local de la pantalla 2) es "falta decidir"', () => {
    expect(mappingType(null)).toBe('undecided')
  })
})

describe('tokens de color', () => {
  it('el gemelo tiene color propio: no comparte con ninguno de los tres elegibles', () => {
    const otros = [
      RESOLUTION_TOKENS.linked.chip,
      RESOLUTION_TOKENS.sizeCreated.chip,
      RESOLUTION_TOKENS.newProduct.chip,
    ]
    expect(otros).not.toContain(RESOLUTION_TOKENS.twin.chip)
  })

  it('los cuatro tipos de mapeo son visualmente distintos entre sí', () => {
    const chips = Object.values(MAPPING_TOKENS).map((t) => t.chip)
    expect(new Set(chips).size).toBe(4)
  })

  it('los cuatro estados de traslado son visualmente distintos entre sí', () => {
    const chips = Object.values(TRANSFER_STATUS_TOKENS).map((t) => t.chip)
    expect(new Set(chips).size).toBe(4)
  })

  it('todas las etiquetas cortas son más cortas que las largas', () => {
    for (const t of Object.values(RESOLUTION_TOKENS)) {
      expect(t.short.length).toBeLessThanOrEqual(t.label.length)
    }
  })
})
