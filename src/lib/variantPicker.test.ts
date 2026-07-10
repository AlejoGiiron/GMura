import { describe, it, expect } from 'vitest'
import {
  pickerSizes,
  pickerColors,
  sizeHasStock,
  colorHasStock,
  comboHasStock,
  matchVariant,
  initialPickerSelection,
  reconcileColorForSize,
  reconcileSizeForColor,
  type PickerVariant,
} from './variantPicker'

// Helper para construir variantes concisas.
const v = (size: string | null, color: string | null, stock: number): PickerVariant => ({
  size,
  color,
  stock_qty: stock,
})

// ── Matriz DISPERSA estilo STIL ROTOS ──────────────────────────────────────────
// GRIS solo existe en talla 32; la talla 32 solo pares con {AZUL OSCURO, GRIS}.
const sparse: PickerVariant[] = [
  v('28', 'AZUL MEDIO', 2),
  v('32', 'AZUL OSCURO', 4),
  v('32', 'GRIS', 1),
  v('34', 'AZUL CLARO', 1),
  v('34', 'NEGRO', 2),
  v('36', 'MOSTAZA', 1),
]

describe('variantPicker — matriz dispersa (STIL ROTOS)', () => {
  it('la talla 32 se habilita porque tiene stock en algún color (sin cruzar con el color elegido)', () => {
    expect(sizeHasStock(sparse, '32')).toBe(true)
  })

  it('el color GRIS se habilita porque existe con stock (aunque solo en talla 32)', () => {
    expect(colorHasStock(sparse, 'GRIS')).toBe(true)
  })

  it('la celda 32/GRIS es ALCANZABLE: al elegir GRIS, la talla se autoajusta a 32', () => {
    // Estado inicial cae en la primera combinación con stock (28/AZUL MEDIO).
    const init = initialPickerSelection(sparse)
    expect(init).toEqual({ size: '28', color: 'AZUL MEDIO' })
    // El usuario hace click en GRIS: la talla actual (28) no forma combo con GRIS,
    // así que se reajusta a 32 → la celda queda seleccionable con stock.
    const size = reconcileSizeForColor(sparse, 'GRIS', init.size)
    expect(size).toBe('32')
    expect(comboHasStock(sparse, size, 'GRIS')).toBe(true)
  })

  it('al elegir la talla 32, el color se autoajusta a uno válido (AZUL OSCURO o GRIS)', () => {
    // Selección inicial 28/AZUL MEDIO; al pasar a talla 32 el color AZUL MEDIO
    // no existe en 32, se reajusta al primer color con stock de la talla 32.
    const color = reconcileColorForSize(sparse, '32', 'AZUL MEDIO')
    expect(['AZUL OSCURO', 'GRIS']).toContain(color)
    expect(comboHasStock(sparse, '32', color)).toBe(true)
  })

  it('mantiene el color actual si ya forma una combinación válida con la nueva talla', () => {
    // 34/AZUL CLARO existe con stock → al elegir 34 con AZUL CLARO no se cambia.
    expect(reconcileColorForSize(sparse, '34', 'AZUL CLARO')).toBe('AZUL CLARO')
  })

  it('expone las tallas y colores presentes preservando el orden', () => {
    expect(pickerSizes(sparse)).toEqual(['28', '32', '34', '36'])
    expect(pickerColors(sparse)).toEqual([
      'AZUL MEDIO',
      'AZUL OSCURO',
      'GRIS',
      'AZUL CLARO',
      'NEGRO',
      'MOSTAZA',
    ])
  })
})

// ── Matriz COMPLETA (regresión: no romper lo que andaba) ────────────────────────
const full: PickerVariant[] = [
  v('S', 'ROJO', 3),
  v('S', 'AZUL', 2),
  v('M', 'ROJO', 1),
  v('M', 'AZUL', 4),
]

describe('variantPicker — matriz completa', () => {
  it('todas las tallas y colores con stock quedan habilitados', () => {
    expect(sizeHasStock(full, 'S')).toBe(true)
    expect(sizeHasStock(full, 'M')).toBe(true)
    expect(colorHasStock(full, 'ROJO')).toBe(true)
    expect(colorHasStock(full, 'AZUL')).toBe(true)
  })

  it('cambiar de talla conserva el color elegido (todas las combinaciones existen)', () => {
    expect(reconcileColorForSize(full, 'M', 'ROJO')).toBe('ROJO')
    expect(reconcileSizeForColor(full, 'AZUL', 'S')).toBe('S')
  })

  it('la selección inicial cae en la primera combinación con stock', () => {
    expect(initialPickerSelection(full)).toEqual({ size: 'S', color: 'ROJO' })
  })
})

// ── Producto de UNA sola variante ───────────────────────────────────────────────
describe('variantPicker — una sola variante', () => {
  const single = [v('U', 'NEGRO', 5)]

  it('la selección inicial la auto-selecciona', () => {
    expect(initialPickerSelection(single)).toEqual({ size: 'U', color: 'NEGRO' })
  })

  it('su talla y color están habilitados y la combinación tiene stock', () => {
    expect(sizeHasStock(single, 'U')).toBe(true)
    expect(colorHasStock(single, 'NEGRO')).toBe(true)
    expect(comboHasStock(single, 'U', 'NEGRO')).toBe(true)
  })
})

// ── Disponible 0 / 100% reservado sigue deshabilitado ───────────────────────────
describe('variantPicker — stock/disponible 0 sigue no vendible', () => {
  // OEXSEL DRIL 34/GRIS 100% reservada (disponible 0); hay otra talla con stock.
  const withReserved: PickerVariant[] = [
    v('32', 'GRIS', 2),
    v('34', 'GRIS', 0), // todo reservado → disponible 0
    v('34', 'NEGRO', 0), // sin stock
  ]

  it('una talla cuyas variantes están todas en disponible 0 queda deshabilitada', () => {
    expect(sizeHasStock(withReserved, '34')).toBe(false)
    expect(sizeHasStock(withReserved, '32')).toBe(true)
  })

  it('la combinación 34/GRIS (reservada) NO tiene stock disponible', () => {
    expect(comboHasStock(withReserved, '34', 'GRIS')).toBe(false)
  })

  it('el color GRIS sigue habilitado porque existe con stock en la talla 32', () => {
    expect(colorHasStock(withReserved, 'GRIS')).toBe(true)
  })

  it('la selección inicial evita la celda sin stock y cae en 32/GRIS', () => {
    expect(initialPickerSelection(withReserved)).toEqual({ size: '32', color: 'GRIS' })
  })

  it('cuando NINGUNA variante tiene stock, la selección inicial es una celda real (todo deshabilitado)', () => {
    const dead = [v('S', 'ROJO', 0), v('M', 'AZUL', 0)]
    expect(initialPickerSelection(dead)).toEqual({ size: 'S', color: 'ROJO' })
    expect(sizeHasStock(dead, 'S')).toBe(false)
  })
})

// ── Ejes ausentes (solo talla, o solo color) ────────────────────────────────────
describe('variantPicker — ejes parciales', () => {
  it('producto solo con tallas: color se mantiene null y matchVariant ignora el color', () => {
    const sizesOnly = [v('S', null, 2), v('M', null, 0)]
    expect(initialPickerSelection(sizesOnly)).toEqual({ size: 'S', color: null })
    expect(reconcileColorForSize(sizesOnly, 'S', null)).toBeNull()
    expect(matchVariant(sizesOnly, 'S', null)?.stock_qty).toBe(2)
  })

  it('producto solo con colores: talla se mantiene null', () => {
    const colorsOnly = [v(null, 'ROJO', 0), v(null, 'AZUL', 3)]
    expect(initialPickerSelection(colorsOnly)).toEqual({ size: null, color: 'AZUL' })
    expect(reconcileSizeForColor(colorsOnly, 'AZUL', null)).toBeNull()
  })
})
