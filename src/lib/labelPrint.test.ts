import { describe, it, expect } from 'vitest'
import { buildLabelPrintCss, LABEL_PRINT_CLASS, labelsToPrint } from './labelPrint'
import type { LabelSize } from '@/types/config.types'

/**
 * Quita los comentarios /* ... *\/ antes de asertar: varias reglas se explican
 * en el CSS nombrando justamente lo que NO se debe usar (visibility:hidden,
 * size:auto), y sin esto las aserciones negativas matchean el comentario.
 */
const soloReglas = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const size38: LabelSize = { id: '38x25', name: 'Estándar', width_mm: 38, height_mm: 25 }
const size58: LabelSize = { id: '58x40', name: 'Grande', width_mm: 58, height_mm: 40 }

describe('buildLabelPrintCss', () => {
  const css = soloReglas(buildLabelPrintCss('mi-contenedor', size38))

  it('NO usa position:fixed — un elemento fijo no se fragmenta y manda todo a una hoja', () => {
    // Es el bug que hacía que la impresora de etiquetas sacara solo la primera.
    expect(css).not.toMatch(/position:\s*fixed/)
    expect(css).toMatch(/position:\s*static/)
  })

  it('aísla con display:none y no con visibility:hidden', () => {
    // visibility:hidden deja el layout OCUPANDO ESPACIO: las etiquetas
    // arrancaban después de la app y salían decenas de páginas en blanco.
    expect(css).toMatch(/body > \*:not\(#mi-contenedor\)\s*\{\s*display:\s*none/)
    expect(css).not.toMatch(/visibility:\s*hidden/)
  })

  it('fuerza un salto de página después de cada etiqueta', () => {
    expect(css).toMatch(new RegExp(`\\.${LABEL_PRINT_CLASS}\\s*\\{[^}]*break-after:\\s*page`))
    expect(css).toMatch(new RegExp(`\\.${LABEL_PRINT_CLASS}\\s*\\{[^}]*page-break-after:\\s*always`))
  })

  it('exceptúa la última etiqueta para no dejar una hoja en blanco al final', () => {
    expect(css).toMatch(
      new RegExp(`\\.${LABEL_PRINT_CLASS}:last-child\\s*\\{[^}]*break-after:\\s*auto`),
    )
  })

  it('evita que una etiqueta se parta entre dos páginas', () => {
    expect(css).toMatch(new RegExp(`\\.${LABEL_PRINT_CLASS}\\s*\\{[^}]*break-inside:\\s*avoid`))
  })

  it('fija el tamaño de página al de la etiqueta configurada, no size:auto', () => {
    // Con size:auto la página la decide el driver: si no coincide con la
    // etiqueta física sale mal aunque los saltos estén bien.
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*38mm 25mm/)
    expect(css).not.toMatch(/size:\s*auto/)
  })

  it('el tamaño sale de la configuración de la tienda (no está hardcodeado)', () => {
    expect(soloReglas(buildLabelPrintCss('c', size58))).toMatch(/size:\s*58mm 40mm/)
  })

  it('sin márgenes de página: la etiqueta ocupa la hoja entera', () => {
    expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/)
  })

  it('scopea las reglas al contenedor que recibe', () => {
    const otro = soloReglas(buildLabelPrintCss('otro-id', size38))
    expect(otro).toContain('#otro-id')
    expect(otro).not.toContain('#mi-contenedor')
  })
})

describe('labelsToPrint', () => {
  // Una línea de 3 unidades son 3 etiquetas con la misma raíz de clave.
  const tanda = [
    { key: 'a-0' }, { key: 'a-1' }, { key: 'a-2' },
    { key: 'b-0' },
    { key: 'c-0' }, { key: 'c-1' },
  ]

  it('sin reimpresión puntual devuelve la tanda completa', () => {
    expect(labelsToPrint(tanda, null)).toHaveLength(6)
    expect(labelsToPrint(tanda, null)).toBe(tanda)
  })

  it('imprime UNA sola etiqueta aunque la línea tenga varias unidades', () => {
    // El caso de uso es "se me arruinó una", no "reimprimí las 3".
    const solo = labelsToPrint(tanda, 'a-0')
    expect(solo).toHaveLength(1)
    expect(solo[0].key).toBe('a-0')
  })

  it('no se lleva las hermanas de la misma línea', () => {
    expect(labelsToPrint(tanda, 'c-0').map((l) => l.key)).toEqual(['c-0'])
  })

  it('una clave inexistente no imprime nada (mejor que imprimir la tanda)', () => {
    expect(labelsToPrint(tanda, 'z-0')).toHaveLength(0)
  })

  it('la tanda vacía se mantiene vacía', () => {
    expect(labelsToPrint([], null)).toHaveLength(0)
  })
})
