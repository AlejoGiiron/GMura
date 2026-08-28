import type {
  TransferStatus,
  TransferDestAction,
  TransferDestResolution,
} from '@/types/database.types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers y tokens del módulo de traslados (handoff §0.5, §2.1, §2.2, §2.3).
//
// Los hex viven ACÁ y en ningún otro lado: el mismo sistema de color se repite
// en la franja de la línea, en el badge del candidato y en el desglose del rail,
// y si se duplica se desincroniza.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ SE BORRA EN LA FASE 5b.
 *
 * La pantalla de armar el envío (/traslados/nuevo) todavía no existe: llega en
 * la 5b. Hasta entonces todo camino hacia ella queda oculto, porque un botón que
 * lleva a una página rota en un POS de producción no es un detalle cosmético.
 *
 * La 5a igual entrega el flujo que urgía: RECIBIR. Las tablas y las RPC ya están
 * en producción desde la 041, y hasta ahora no había forma de confirmar un
 * traslado desde la app.
 *
 * Al implementar la 5b: borrar esta constante y sus tres usos en TransfersPage
 * (botón del header, botón del estado vacío, y la acción "Seguir editando" de
 * las filas en borrador).
 */
export const TRANSFER_BUILDER_ENABLED = false

/**
 * Formato de display del número de traslado: TR-0001.
 * Sin prefijos con significado (nada de codificar tienda o año) — handoff §0.5.
 */
export function formatTransferNumber(n: number): string {
  return `TR-${String(n).padStart(4, '0')}`
}

/** `$ 89.000` — signo, espacio, miles con punto, sin decimales (handoff §2.4). */
export function formatTransferMoney(value: number): string {
  return `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value)}`
}

// ── §2.2 Estados de traslado ─────────────────────────────────────────────────

export interface ToneTokens {
  /** Clases del chip completo (fondo + texto + borde). */
  chip: string
  /** Clase del punto de color. */
  dot: string
}

export const TRANSFER_STATUS_TOKENS: Record<TransferStatus, ToneTokens & { label: string }> = {
  // Borrador va gris a propósito: nada pasó todavía.
  draft: {
    label: 'Borrador',
    chip: 'bg-stone-100 text-neutral-600 border-neutral-200',
    dot: 'bg-neutral-400',
  },
  // En tránsito comparte el ámbar de "producto nuevo": los dos significan
  // "algo pendiente de revisión".
  in_transit: {
    label: 'En tránsito',
    chip: 'bg-amber-100 text-amber-700 border-amber-300',
    dot: 'bg-amber-600',
  },
  received: {
    label: 'Recibido',
    chip: 'bg-green-100 text-green-700 border-green-300',
    dot: 'bg-green-600',
  },
  cancelled: {
    label: 'Cancelado',
    chip: 'bg-red-100 text-red-700 border-red-300',
    dot: 'bg-red-600',
  },
}

// ── §2.1 Los cuatro tipos de mapeo ───────────────────────────────────────────
// verde = no toca el catálogo · violeta = agrega dentro de algo que existe ·
// ámbar = crea algo nuevo (revisá) · rojo = falta tu decisión.

export type MappingType = 'exact' | 'newSize' | 'newProduct' | 'undecided'

export const MAPPING_TOKENS: Record<
  MappingType,
  ToneTokens & { label: string; short: string }
> = {
  exact: {
    label: 'Coincidencia exacta',
    short: 'Exacta',
    chip: 'bg-green-100 text-green-700 border-green-300',
    dot: 'bg-green-600',
  },
  newSize: {
    label: 'Nueva talla en ficha',
    short: 'Nueva talla',
    chip: 'bg-violet-100 text-violet-700 border-violet-300',
    dot: 'bg-violet-500',
  },
  newProduct: {
    label: 'Producto nuevo allá',
    short: 'Producto nuevo',
    chip: 'bg-amber-100 text-amber-700 border-amber-300',
    dot: 'bg-amber-600',
  },
  undecided: {
    label: 'Falta decidir destino',
    short: 'Falta decidir',
    chip: 'bg-red-100 text-red-700 border-red-300',
    dot: 'bg-red-600',
  },
}

// ── §2.3 Resolución al recibir ───────────────────────────────────────────────

export type ResolutionKind = 'linked' | 'sizeCreated' | 'newProduct' | 'twin'

export const RESOLUTION_TOKENS: Record<
  ResolutionKind,
  ToneTokens & { label: string; short: string }
> = {
  linked: {
    label: 'Vinculado a ficha existente',
    short: 'Vinculado',
    chip: 'bg-green-100 text-green-700 border-green-300',
    dot: 'bg-green-600',
  },
  sizeCreated: {
    label: 'Talla creada en ficha existente',
    short: 'Talla creada',
    chip: 'bg-violet-100 text-violet-700 border-violet-300',
    dot: 'bg-violet-500',
  },
  newProduct: {
    label: 'Producto creado',
    short: 'Ficha nueva',
    chip: 'bg-amber-100 text-amber-700 border-amber-300',
    dot: 'bg-amber-600',
  },
  // Azul propio: el sistema encontró un equivalente y lo vinculó SOLO, en vez de
  // crear el duplicado que el usuario había pedido. Es un resultado distinto de
  // los tres elegibles y merece color propio.
  twin: {
    label: 'Gemelo encontrado y vinculado',
    short: 'Gemelo',
    chip: 'bg-sky-100 text-sky-700 border-sky-300',
    dot: 'bg-sky-600',
  },
}

/**
 * Cómo se resolvió una línea al recibir (handoff §2.3).
 * `auto_matched` gana sobre `dest_action`: da igual qué se eligió, lo que pasó
 * es que el servidor encontró un gemelo.
 */
export function resolutionKind(
  destAction: TransferDestAction,
  destResolution: TransferDestResolution | null,
): ResolutionKind {
  if (destResolution === 'auto_matched') return 'twin'
  if (destAction === 'map_variant') return 'linked'
  if (destAction === 'map_product') return 'sizeCreated'
  return 'newProduct'
}

/** Tipo de mapeo elegido, para las vistas previas a la recepción. */
export function mappingType(destAction: TransferDestAction | null): MappingType {
  if (destAction === 'map_variant') return 'exact'
  if (destAction === 'map_product') return 'newSize'
  if (destAction === 'create_product') return 'newProduct'
  return 'undecided'
}

// ── Auditoría de quién confirmó (handoff §1.1) ───────────────────────────────

export type ConfirmedBy = 'destination' | 'origin' | 'other'

/**
 * Quién confirmó la recepción, comparando la tienda desde la que se confirmó
 * contra las dos puntas del traslado.
 *
 * Es la columna con más valor operativo de la lista: si después falta
 * mercancía, este dato es lo primero que se mira. Que lo haya confirmado el
 * ORIGEN es la excepción y tiene que salir a la vista.
 */
export function confirmedBy(
  receivedByStoreId: string | null,
  toStoreId: string,
  fromStoreId: string,
): ConfirmedBy | null {
  if (!receivedByStoreId) return null
  if (receivedByStoreId === toStoreId) return 'destination'
  if (receivedByStoreId === fromStoreId) return 'origin'
  return 'other'
}

export const CONFIRMED_BY_LABEL: Record<ConfirmedBy, string> = {
  destination: 'el destino',
  origin: 'el origen',
  other: 'administración',
}
