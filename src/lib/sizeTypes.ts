import type { SizeTypeConfig } from '@/types/config.types'

// Catálogo por defecto de tipos de talla. A partir de la fase 15.1 los tipos
// de talla viven en stores.config.size_types y son gestionables desde
// Configuración. Esta lista solo se usa como fallback/seed cuando la tienda
// aún no tiene tipos configurados.
export const DEFAULT_SIZE_TYPES: SizeTypeConfig[] = [
  { id: 'letter', label: 'Letras (XS-XXL)', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] },
  { id: 'pants_men', label: 'Pantalón Hombre', sizes: ['28', '30', '32', '34', '36', '38', '40', '42'] },
  { id: 'pants_women', label: 'Pantalón Mujer', sizes: ['2', '4', '6', '8', '10', '12', '14', '16'] },
  { id: 'shoes_men', label: 'Calzado Hombre', sizes: ['38', '39', '40', '41', '42', '43', '44'] },
  { id: 'shoes_women', label: 'Calzado Mujer', sizes: ['34', '35', '36', '37', '38', '39', '40'] },
  { id: 'baby', label: 'Bebé', sizes: ['0-3m', '3-6m', '6-9m', '9-12m', '12-18m', '18-24m'] },
  { id: 'kids', label: 'Niños', sizes: ['2', '4', '6', '8', '10', '12', '14'] },
  { id: 'unique', label: 'Talla única', sizes: ['Única'] },
  { id: 'custom', label: 'Personalizada', sizes: [] },
]

export const DEFAULT_SIZE_TYPE_ID = 'letter'
export const CUSTOM_SIZE_TYPE_ID = 'custom'

// Resuelve el tipo de talla configurado a partir de su id. Devuelve undefined
// si el id no existe en la lista (ej. productos legacy con un tipo eliminado).
export function findSizeType(
  types: SizeTypeConfig[],
  id: string | null | undefined,
): SizeTypeConfig | undefined {
  if (!id) return undefined
  return types.find((t) => t.id === id)
}

// Un tipo se trata como "personalizado" (input libre de talla) cuando es el
// tipo custom, cuando no existe en la config, o cuando no define tallas.
export function isCustomSizeType(
  types: SizeTypeConfig[],
  id: string | null | undefined,
): boolean {
  if (id === CUSTOM_SIZE_TYPE_ID) return true
  const found = findSizeType(types, id)
  return !found || found.sizes.length === 0
}

// Genera un id estable y opaco para un tipo de talla nuevo. Los productos
// referencian el tipo por id, por lo que nunca debe cambiar al renombrar.
export function newSizeTypeId(): string {
  return `st_${crypto.randomUUID().slice(0, 8)}`
}
