# G-Mura — contexto del proyecto

## Descripción
G-Mura es un sistema POS para tiendas de ropa física.
Maneja inventario por variantes (talla + color),
códigos de barras, devoluciones y CRM de clientes.

## Stack tecnológico
- Frontend: React 18, TypeScript (strict), Tailwind CSS, Vite
- Base de datos: Supabase (PostgreSQL + Auth + Realtime + Storage)
- Estado global: Zustand
- Fetching: React Query (@tanstack/react-query)
- Validación: Zod
- Íconos: lucide-react
- Fechas: date-fns
- Códigos de barras: quagga2 (lectura), JsBarcode (generación)

## Diferencias clave vs un POS de restaurante
- Los productos tienen variantes (talla + color)
- El stock se maneja por variante, no por producto
- No hay mesas, cocina ni delivery
- Los clientes son registrados para historial y CRM
- Las devoluciones y cambios son flujos críticos
- Los códigos de barras son fundamentales para ventas rápidas

## Convenciones de código
- Componentes: PascalCase en archivos .tsx
- Hooks: camelCase con prefijo "use"
- Tipos: PascalCase, sin prefijo I ni T
- Strings UI: en español (Colombia)
- Precios: siempre en COP con Intl.NumberFormat('es-CO')
- Fechas: siempre en zona horaria America/Bogota
- IDs: UUID v4 generados por Supabase

## Patrones establecidos
- Componentes funcionales con React hooks
- No usar any en TypeScript
- Errores de Supabase con react-hot-toast
- Mutaciones de BD en hooks custom (useXMutations)
- Queries de Supabase solo en hooks, nunca en componentes
- Canales Realtime con nombre único:
  supabase.channel("nombre-${Math.random().toString(36).slice(2)}")

## Design system
- Sidebar: slate-900 (#0f172a)
- Acento primario: violeta #8b5cf6
- Fondo principal: blanco / gris muy claro
- Tipografía: Inter
- Precios: JetBrains Mono

## Archivos de diseño
- Los diseños de referencia están en _design/
- Siempre leer el archivo de diseño correspondiente antes de construir una página
- Usar como guía visual, no copiar código directamente
- Convertir siempre a TypeScript estricto y convenciones del proyecto

## Variables de entorno
VITE_GMURA_SUPABASE_URL=
VITE_GMURA_SUPABASE_ANON_KEY=

## Git
- Rama de desarrollo: develop
- Nunca commit directo a main
- Commits en Conventional Commits
- Un commit por funcionalidad completa

## Estado actual del proyecto
Última fase completada: 07 - Configuración ✅
  - src/types/config.types.ts: StoreConfig, StoreColorConfig, LabelFields, LabelFormat
  - src/hooks/useConfig.ts: useStoreConfig, useStoreUsers, resolveConfig, DEFAULT_CONFIG
  - src/hooks/useConfigMutations.ts: updateStore, updateStoreConfig, uploadLogo,
    uploadNequiQR, createUser (Edge Function), updateUserRole, toggleUserActive
  - supabase/functions/create-user/index.ts: Deno Edge Function con admin client
  - ConfigPage.tsx: layout nav w-56 + 5 secciones (Tienda, Usuarios, Productos, Caja, Etiquetas)
  - StoreSection: nombre/dirección/teléfono, logo upload circular, zona horaria
  - UsersSection: lista con avatar gradiente, badges de rol, toggles activo/inactivo, modal crear usuario
  - ProductsSection: drag-and-drop de tallas, color picker nativo, marcas, días devolución
  - CajaSection: motivos de ajuste, métodos de pago checkboxes, QR Nequi upload
  - EtiquetasSection: formato radio (3 tamaños), campos checkboxes, preview JsBarcode en vivo
  - stores.config (jsonb) centraliza: sizes, colors, brands, return_days_limit,
    adjustment_reasons, payment_methods, nequi_qr_url, label_format, label_fields
En progreso: —
Siguiente: merge feature/07-configuracion → develop