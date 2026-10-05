// Helper compartido para los exports a Excel (exceljs).
//
// Hasta acá cada página armaba su export a mano (ReportsPage, InventoryPage,
// ExpenseHistoryPage) repitiendo el mismo encabezado gris en negrita, la fila
// TOTAL y la descarga por Blob. Esto junta esas tres piezas para los exports
// nuevos. Los existentes siguen como están: migrarlos es otro cambio.
//
// exceljs pesa: se importa SOLO cuando el usuario exporta (createWorkbook).
// Este módulo usa únicamente tipos de exceljs, así que no lo arrastra al bundle.

import type { Workbook, Worksheet, Row } from 'exceljs'

/** Formato de moneda COP sin decimales (el mismo que ExpenseHistoryPage). */
export const EXCEL_MONEY_FMT = '"$"#,##0'

/** Formato de porcentaje con un decimal. El valor va como fracción (0.25). */
export const EXCEL_PERCENT_FMT = '0.0%'

const HEADER_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFF5F4F1' },
}
const BOLD = { bold: true, size: 11 }

export interface ExcelColumn {
  header: string
  key: string
  width: number
  /** Aplica formato de moneda COP a toda la columna. */
  money?: boolean
  /** Aplica formato de porcentaje (el valor debe ser una fracción). */
  percent?: boolean
}

/** Celdas de una fila, por `key` de columna. */
export type ExcelRowValues = Record<string, string | number | null>

/** Carga exceljs bajo demanda y devuelve un libro nuevo. */
export async function createWorkbook(): Promise<Workbook> {
  const { Workbook: WorkbookCtor } = await import('exceljs')
  const wb = new WorkbookCtor()
  wb.creator = 'G-Mura'
  return wb
}

/**
 * Excel rechaza nombres de hoja con []:*?/\ o de más de 31 caracteres
 * (el archivo queda corrupto o exceljs lanza). Se limpian acá.
 */
export function safeSheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, '-').trim()
  return (clean || 'Hoja').slice(0, 31)
}

/** Agrega una hoja con encabezado en negrita + fondo gris y los formatos. */
export function addSheet(wb: Workbook, name: string, columns: ExcelColumn[]): Worksheet {
  const ws = wb.addWorksheet(safeSheetName(name))
  ws.columns = columns.map(({ header, key, width }) => ({ header, key, width }))

  const head = ws.getRow(1)
  head.font = BOLD
  head.fill = HEADER_FILL
  head.commit()

  for (const col of columns) {
    if (col.money) ws.getColumn(col.key).numFmt = EXCEL_MONEY_FMT
    else if (col.percent) ws.getColumn(col.key).numFmt = EXCEL_PERCENT_FMT
  }
  return ws
}

/** Agrega la fila de totales en negrita. */
export function addTotalRow(ws: Worksheet, values: ExcelRowValues): Row {
  const row = ws.addRow(values)
  row.font = BOLD
  return row
}

/** "Bodega Tebaida #1" → "bodega-tebaida-1", para nombres de archivo. */
export function fileSlug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'archivo'
  )
}

/** Escribe el libro y dispara la descarga en el navegador. */
export async function downloadWorkbook(wb: Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
