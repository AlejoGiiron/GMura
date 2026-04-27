---
description: Construye una pantalla nueva siguiendo el sistema visual de G-Mura.
argument-hint: <nombre-pantalla> [descripcion-breve]
---

Antes de escribir una sola línea de código, lee obligatoriamente:
- CLAUDE.md
- src/CLAUDE.md
- src/design-system.md ← sistema visual completo del proyecto
- src/types/database.types.ts
- src/lib/supabase-helpers.ts
- src/lib/formatters.ts

Construye la pantalla **$ARGUMENTS**.

## Requisitos visuales obligatorios (extraídos de src/design-system.md)

### Layout
- Estructura: sidebar slate-900 fijo + header + área de contenido
- Fondo principal: #f8f7f5
- Cards de contenido: bg-white con border border-stone-200
- Padding estándar de secciones: p-6

### Tipografía
- Títulos de página: Bricolage Grotesque, text-xl font-semibold
- Texto de UI: Geist UI, text-sm
- Precios: ui-monospace, usar fmtCOP() de src/lib/formatters.ts

### Componentes — usar clases exactas del design system
- Botón primario: bg-violet-600 hover:bg-violet-700 text-white
- Botón secundario: bg-white border border-stone-200 hover:bg-stone-50
- Input: border border-stone-200 rounded-lg focus:ring-2 focus:ring-violet-500
- Badge sin stock: bg-red-50 text-red-600 border border-red-200
- Badge stock bajo: bg-amber-50 text-amber-600 border border-amber-200
- Badge normal: bg-emerald-50 text-emerald-600 border border-emerald-200

### Estados obligatorios
- Carga: skeleton con animate-pulse en forma del contenido real
- Vacío: ícono lucide-react centrado + título + descripción útil en español
- Error: toast.error() de react-hot-toast

### Patrones G-Mura
- Variantes siempre muestran talla + color juntos
- Stock siempre por variant_id, nunca por product_id
- Fechas en America/Bogota con date-fns
- Textos de UI en español Colombia
- Sin any en TypeScript

## Estructura a crear

1. src/pages/{Nombre}Page.tsx
2. src/hooks/use{Nombre}.ts (React Query)
3. src/hooks/use{Nombre}Mutaciones.ts (mutaciones)
4. Componentes en src/components/{modulo}/ si aplica

## Al terminar

- Corre tsc --noEmit y muestra el resultado
- Ejecuta /project:commit