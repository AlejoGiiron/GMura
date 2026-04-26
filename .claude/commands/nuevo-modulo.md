---
description: Genera el scaffold completo de un módulo: página, hooks de datos y registro en el router.
argument-hint: <nombre-modulo>
---

Crea un módulo nuevo llamado **$ARGUMENTS** en el proyecto gmura:

## 1. Página — `src/pages/{Nombre}Page.tsx`

Componente funcional en PascalCase con:
- Encabezado con nombre del módulo en español
- **Estado de carga:** skeleton con la forma aproximada del contenido,
  no un spinner genérico centrado
- **Estado vacío:** mensaje útil en español que oriente al usuario
- Sin comentarios genéricos

## 2. Hook de lectura — `src/hooks/use{Nombre}.ts`

Con React Query (`useQuery`) que:
- Llama al helper correspondiente de `src/lib/supabase-helpers.ts`
  (créalo si no existe)
- Devuelve `{ data, isLoading, error }`
- Tipado estrictamente con los tipos de `src/types/database.types.ts`
- Sin `any`

## 3. Hook de mutaciones — `src/hooks/use{Nombre}Mutaciones.ts`

Archivo separado con `useMutation` que exponga:
- `crear(data: TablesInsert<'nombre_tabla'>)` — inserta e invalida la query
- `actualizar(data: TablesUpdate<'nombre_tabla'> & { id: string })` — ídem
- `eliminar(id: string)` — elimina e invalida la query
- Cada mutación muestra `toast.error()` en `onError`
  y `toast.success()` en `onSuccess`

## 4. Router — `src/App.tsx`

Añade la ruta `/nombre-en-kebab-case` dentro del bloque
`<ProtectedRoute>` → `<AppLayout>` existente.
Si es solo admin, anídalo en `<ProtectedRoute allowedRoles={['admin']}>`.

## 5. Sidebar — `src/components/layout/Sidebar.tsx`

Agrega la entrada a `NAV_ITEMS` con el ícono de lucide-react más apropiado
y el label en español. Si es admin-only, marca `adminOnly: true`.

## Convenciones obligatorias
- TypeScript strict — sin `any`
- Strings de UI en español (Colombia)
- Precios en COP con `Intl.NumberFormat('es-CO')`
- Errores de Supabase con `toast.error()` de react-hot-toast
- Queries de Supabase solo en hooks, nunca en componentes directamente
- Si el módulo toca variantes: siempre usar `variant_id`, nunca solo `product_id`