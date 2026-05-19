export const SIZE_TYPES = {
  letter: {
    label: 'Letras (XS-XXL)',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  },
  pants_co: {
    label: 'Pantalón Colombia',
    sizes: ['28', '30', '32', '34', '36', '38', '40', '42'],
  },
  shoes_co: {
    label: 'Calzado Colombia',
    sizes: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44'],
  },
  baby: {
    label: 'Bebé',
    sizes: ['0-3m', '3-6m', '6-9m', '9-12m', '12-18m', '18-24m'],
  },
  unique: {
    label: 'Talla única',
    sizes: ['Única'],
  },
  custom: {
    label: 'Personalizada',
    sizes: [] as string[],
  },
} as const

export type SizeTypeKey = keyof typeof SIZE_TYPES

export const DEFAULT_SIZE_TYPE: SizeTypeKey = 'letter'

export function isValidSizeType(value: string | null | undefined): value is SizeTypeKey {
  return !!value && value in SIZE_TYPES
}

export function resolveSizeType(value: string | null | undefined): SizeTypeKey {
  return isValidSizeType(value) ? value : DEFAULT_SIZE_TYPE
}
