import { describe, it, expect } from 'vitest'
import {
  deriveLabelStyle,
  findLabelSize,
  newLabelSizeId,
  DEFAULT_LABEL_SIZES,
  MIN_FACTOR,
  MAX_FACTOR,
  MIN_BARCODE_H,
} from './labelSizes'
import type { LabelSize } from '@/types/config.types'

const size = (width_mm: number, height_mm: number): LabelSize => ({
  id: 'x',
  name: 'x',
  width_mm,
  height_mm,
})

describe('deriveLabelStyle', () => {
  it('38×25 → factor 1.0 y medidas idénticas a las históricas (no-regresión)', () => {
    const s = deriveLabelStyle(size(38, 25))
    expect(s.factor).toBe(1)
    expect(s.width).toBe('38mm')
    expect(s.height).toBe('25mm')
    expect(s.padding).toBe('1mm 1.5mm')
    expect(s.border).toBe('0.3mm solid #ccc')
    expect(s.nameFs).toBe('5.5pt')
    expect(s.detailFs).toBe('4.5pt')
    expect(s.skuFs).toBe('4pt')
    expect(s.priceFs).toBe('6.5pt')
    expect(s.barcodeHeight).toBe(24)
    expect(s.barcodeWidth).toBe(1)
  })

  it('50×30 → factor 1.2', () => {
    const s = deriveLabelStyle(size(50, 30))
    expect(s.factor).toBeCloseTo(1.2, 5)
    expect(s.width).toBe('50mm')
    expect(s.height).toBe('30mm')
  })

  it('50×30 (factor ≠ 1) escala padding y border explícitamente', () => {
    const s = deriveLabelStyle(size(50, 30))
    // padding base '1mm 1.5mm' × 1.2 = '1.2mm 1.8mm'
    expect(s.padding).toBe('1.2mm 1.8mm')
    // border base '0.3mm' × 1.2 = '0.36mm'
    expect(s.border).toBe('0.36mm solid #ccc')
    // fuentes base × 1.2
    expect(s.nameFs).toBe('6.6pt')
    expect(s.priceFs).toBe('7.8pt')
  })

  it('58×40 → factor ≈ 1.526 (limitado por el ancho)', () => {
    const s = deriveLabelStyle(size(58, 40))
    expect(s.factor).toBeCloseTo(1.5263, 3)
  })

  it('tamaño diminuto → factor piso (MIN_FACTOR)', () => {
    const s = deriveLabelStyle(size(10, 8))
    expect(s.factor).toBe(MIN_FACTOR)
  })

  it('tamaño enorme → factor techo (MAX_FACTOR)', () => {
    const s = deriveLabelStyle(size(200, 200))
    expect(s.factor).toBe(MAX_FACTOR)
  })

  it('barcodeWidth ≥ 1 y barcodeHeight ≥ MIN_BARCODE_H incluso en el tamaño más chico', () => {
    const s = deriveLabelStyle(size(10, 8))
    expect(s.barcodeWidth).toBeGreaterThanOrEqual(1)
    expect(s.barcodeHeight).toBeGreaterThanOrEqual(MIN_BARCODE_H)
  })

  it('monotonía: a mayor tamaño, las fuentes no encogen', () => {
    const small = parseFloat(deriveLabelStyle(size(38, 25)).nameFs)
    const mid = parseFloat(deriveLabelStyle(size(50, 30)).nameFs)
    const big = parseFloat(deriveLabelStyle(size(58, 40)).nameFs)
    expect(mid).toBeGreaterThanOrEqual(small)
    expect(big).toBeGreaterThanOrEqual(mid)
  })
})

describe('findLabelSize', () => {
  it('encuentra un tamaño existente por id', () => {
    expect(findLabelSize(DEFAULT_LABEL_SIZES, '50x30')?.name).toBe('Mediana')
  })

  it('devuelve undefined si el id no existe', () => {
    expect(findLabelSize(DEFAULT_LABEL_SIZES, 'ghost')).toBeUndefined()
  })

  it('devuelve undefined con id null/undefined', () => {
    expect(findLabelSize(DEFAULT_LABEL_SIZES, null)).toBeUndefined()
    expect(findLabelSize(DEFAULT_LABEL_SIZES, undefined)).toBeUndefined()
  })
})

describe('newLabelSizeId', () => {
  it('genera un id opaco con formato ls_ + 8 hex', () => {
    expect(newLabelSizeId()).toMatch(/^ls_[0-9a-f]{8}$/)
  })

  it('genera ids distintos en llamadas sucesivas', () => {
    expect(newLabelSizeId()).not.toBe(newLabelSizeId())
  })
})
