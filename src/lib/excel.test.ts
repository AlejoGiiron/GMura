import { describe, it, expect } from 'vitest'
import { Workbook } from 'exceljs'
import {
  addSheet,
  addTotalRow,
  createWorkbook,
  EXCEL_MONEY_FMT,
  EXCEL_PERCENT_FMT,
  fileSlug,
  safeSheetName,
} from './excel'

describe('addSheet', () => {
  it('arma el encabezado en negrita con fondo gris', () => {
    const wb = new Workbook()
    const ws = addSheet(wb, 'Ventas', [
      { header: 'Categoría', key: 'cat', width: 20 },
      { header: 'Unidades', key: 'uds', width: 10 },
    ])
    const head = ws.getRow(1)
    expect(head.getCell(1).value).toBe('Categoría')
    expect(head.getCell(2).value).toBe('Unidades')
    expect(head.font?.bold).toBe(true)
    expect(head.getCell(1).fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FFF5F4F1' } })
  })

  it('aplica formato $ a las columnas de plata y % a las de porcentaje', () => {
    const wb = new Workbook()
    const ws = addSheet(wb, 'Ventas', [
      { header: 'Categoría', key: 'cat', width: 20 },
      { header: 'Ventas', key: 'monto', width: 14, money: true },
      { header: '%', key: 'pct', width: 8, percent: true },
    ])
    ws.addRow({ cat: 'PANTALON DAMA', monto: 1_234_000, pct: 0.25 })
    expect(ws.getColumn('monto').numFmt).toBe(EXCEL_MONEY_FMT)
    expect(ws.getColumn('pct').numFmt).toBe(EXCEL_PERCENT_FMT)
    expect(ws.getColumn('cat').numFmt).toBeUndefined()
    // El valor queda numérico (no texto formateado): Excel puede sumarlo.
    expect(ws.getRow(2).getCell(2).value).toBe(1_234_000)
  })
})

describe('addTotalRow', () => {
  it('agrega la fila de totales en negrita, después de los datos', () => {
    const wb = new Workbook()
    const ws = addSheet(wb, 'Ventas', [
      { header: 'Categoría', key: 'cat', width: 20 },
      { header: 'Unidades', key: 'uds', width: 10 },
    ])
    ws.addRow({ cat: 'A', uds: 3 })
    ws.addRow({ cat: 'B', uds: 4 })
    const total = addTotalRow(ws, { cat: 'TOTAL', uds: 7 })
    expect(total.number).toBe(4)
    expect(total.font?.bold).toBe(true)
    expect(total.getCell(2).value).toBe(7)
  })
})

describe('safeSheetName', () => {
  it('reemplaza los caracteres que Excel prohíbe', () => {
    expect(safeSheetName('Ventas 01/09 [A]')).toBe('Ventas 01-09 -A-')
  })

  it('corta a 31 caracteres', () => {
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31)
  })

  it('nunca devuelve un nombre vacío', () => {
    expect(safeSheetName('   ')).toBe('Hoja')
  })
})

describe('fileSlug', () => {
  it('saca acentos, mayúsculas y símbolos', () => {
    expect(fileSlug('La bodega del Jeans - Tebaida')).toBe('la-bodega-del-jeans-tebaida')
    expect(fileSlug('Categorías & Tallas')).toBe('categorias-tallas')
  })

  it('cae a "archivo" si no queda nada', () => {
    expect(fileSlug('***')).toBe('archivo')
  })
})

describe('createWorkbook', () => {
  it('carga exceljs y devuelve un libro firmado por G-Mura', async () => {
    const wb = await createWorkbook()
    expect(wb.creator).toBe('G-Mura')
  })
})
