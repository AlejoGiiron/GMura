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
Última fase completada: 06 - Reportes ✅
  - Vistas SQL: daily_sales_summary, product_performance, inventory_status, returns_summary
  - Hooks: useReports, useDailySummary, useInventoryReport (staleTime 5 min)
  - ReportsPage.tsx: selector de período, 6 KPIs con comparación, 4 gráficas Recharts,
    tabla de variantes ordenable, resumen de inventario, exportación Excel (4 hojas)
En progreso: —
Siguiente: 07 - Configuración (ConfigPage) o merge a develop