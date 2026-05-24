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
Última fase completada: 07 - Configuración ✅ + hotfix/qa-pre-deploy ✅
  - src/types/config.types.ts: StoreConfig, StoreColorConfig, LabelFields, LabelFormat
  - src/hooks/useConfig.ts: useStoreConfig, useStoreUsers, resolveConfig, DEFAULT_CONFIG
    staleTime: 5min en ambas queries
  - src/hooks/useConfigMutations.ts: updateStore, updateStoreConfig, uploadLogo,
    uploadNequiQR, createUser (Edge Function), updateUserRole, toggleUserActive
  - supabase/functions/create-user/index.ts: Deno Edge Function con admin client
  - ConfigPage.tsx: layout nav w-56 + 5 secciones (Tienda, Usuarios, Productos, Caja, Etiquetas)
  - StoreSection: nombre/dirección/teléfono, logo upload circular, zona horaria
  - UsersSection: lista con avatar gradiente, badges de rol, toggles activo/inactivo, modal crear usuario
  - ProductsSection: drag-and-drop de tallas, color picker nativo, marcas, días devolución
  - CajaSection: motivos de ajuste, métodos de pago checkboxes, QR Nequi upload (con try/catch)
  - EtiquetasSection: formato radio (3 tamaños), campos checkboxes, preview JsBarcode en vivo
  - stores.config (jsonb) centraliza: sizes, colors, brands, return_days_limit,
    adjustment_reasons, payment_methods, nequi_qr_url, label_format, label_fields

Hotfix QA pre-deploy (hotfix/qa-pre-deploy) ✅
  - SEGURIDAD: store_id en useOrderDetail y adjustStock (SELECT + UPDATE)
  - SEGURIDAD: useVariantSearch reescrito con 2 queries server-side + LIMIT 50
  - CONFIG→POS: payment_methods de StoreConfig conectado a PaymentModal
  - CONFIG→Returns: return_days_limit de StoreConfig conectado a ReturnsPage
  - useCustomerSearch extraído a useCustomers.ts (eliminado inline de POSPage)
  - AuthContext: catch en fetchProfile con toast.error + signOut
  - useOrderSearch: toast.error en rutas de error silenciosas
  - CategoriesManager: skeleton loading, tokens border/radius corregidos
  - LabelPrintModal: dimensiones de formato dinámicas desde StoreConfig

Última fase completada: 08 - Bug fixes críticos (v1.1.0) ✅
En progreso: 09 - Parametrización (v1.2)
Versión actual en producción: v1.0.0

Fix de impresión de etiquetas (feature/08-bugfixes-criticos) ✅
  - LabelPrintModal: isValidCode() valida CODE128 antes de renderizar
  - Autogeneración de barcode temporal cuando la variante no tiene; se
    persiste en BD vía useVariantMutations.update
  - useRef en contenedor de impresión + chequeo de montaje antes de
    window.print()
  - Guard contra inyección duplicada del @media print (getElementById)
  - Fallback a '38x25' cuando stores.config.label_format es inválido
  - try/catch en JsBarcode con toast.error agregado por sesión del modal
  - LabelCard usa dimensiones reales del formato configurado (38x25 / 50x30 / 58x40)

Fix de flujo de devoluciones y cambios (feature/08-bugfixes-criticos) ✅
  - useReturnMutations: validación de inputs (returnItems vacío, qty<=0,
    exchangeItems vacío en cambio)
  - Chequeo de auth (profile.store_id / profile.id) antes de tocar BD
  - Pre-check de stock agrega cantidades por variant_id y filtra por
    store_id para defensa en profundidad
  - Rollback compensatorio: DELETE de returns huérfano si return_items falla
  - Rollback compensatorio: DELETE de orden huérfana si order_items de cambio falla
  - Mensaje accionable cuando "devolución se commiteó pero cambio falló"
  - Invalidación ampliada de queries: variants, products, stock-movements,
    orders, inventory, pos-products, returns
  - trim() de notes para que strings vacíos se persistan como NULL

Feature de turno de caja (feature/08-bugfixes-criticos) ✅
  - useCashShift: useCurrentShift (turno abierto del usuario, closed_at IS NULL)
    y useCashShiftSales (suma de ventas cash desde opened_at)
  - useCashShiftMutations: openShift (rechaza si ya hay turno abierto del
    usuario) y closeShift (setea closing_amount, closed_at, closed_by)
  - CashShiftModals: OpenShiftModal (input monto inicial COP) y
    CloseShiftModal (resumen apertura + ventas cash + esperado + contado +
    diferencia sobrante/faltante con colores)
  - Header: badge verde "Turno abierto · HH:mm" + botón "Cerrar turno"
    cuando hay turno; CTA violeta "Abrir turno" cuando no
  - POSPage: bloqueo full-screen "Debes abrir turno para vender" con
    botón "Abrir turno ahora" si el usuario no tiene turno abierto

Tipos de talla configurables + delete de categorías (feature/09-parametrizacion) ✅
  - Migración 004_size_types: products.size_type text NOT NULL DEFAULT 'letter'
  - src/lib/sizeTypes.ts: catálogo letter / pants_co / shoes_co / baby /
    unique / custom + SizeTypeKey, resolveSizeType, isValidSizeType
  - Product type extendido con size_type
  - ProductModal: select "Tipo de talla" (default 'letter')
  - VariantsPanel: selector de talla dinámico según product.size_type;
    'custom' = input libre, otros = <select> con catálogo predefinido;
    preserva tallas legacy fuera del catálogo al editar
  - useCategoryMutations: agregado remove + countProducts;
    delete usa ON DELETE SET NULL de products.category_id;
    invalida queries de products tras delete
  - CategoriesManager: botón papelera + modal de confirmación que muestra
    cuántos productos quedarán sin categoría antes de eliminar

Historial de ventas + reparación de useCreateOrder (feature/10-historial-ventas) ✅
  - useCreateOrder reescrito con validación de inputs (auth, items, qty,
    unit_price), logging detallado y rollback compensatorio: si falla el
    insert de order_items se elimina la orden recién creada para evitar
    huérfanas. Invalidación amplia post-éxito: orders, sales-history,
    variants, products, pos-products, stock-movements, customers, cash-shift
  - src/hooks/useSalesHistory.ts: useSalesHistory (paginado 50/pág con
    filtros server-side), useSalesSummary (revenue, count, ticket promedio,
    devoluciones del período), useSaleDetail (orden + items + cliente +
    devoluciones asociadas)
  - SalesHistoryPage: cards resumen, filtros (búsqueda debounced, presets
    fecha hoy/semana/mes/custom, método pago, estado), tabla con fila
    expandible para detalle inline, paginación anterior/siguiente,
    empty state hacia POS
  - Ruta /ventas/historial dentro de ProtectedRoute + entrada Sidebar
    "Historial" con icono History (visible para admin y seller)
  - ReturnsPage: lee ?orderId=xxx, precarga la orden con validación
    (return_days_limit, items ya devueltos) y salta al paso 2; limpia el
    URL param tras consumirlo

Numeración secuencial + copyable cells + búsqueda mejorada (feature/10-historial-ventas) ✅
  - Migración 005_sequential_order_numbers: orders.order_number int NOT NULL,
    índice único (store_id, order_number), trigger BEFORE INSERT
    assign_order_number con pg_advisory_xact_lock por tienda + backfill
    cronológico de filas existentes
  - Order type extendido con order_number; Insert type lo deja opcional
    porque el trigger lo asigna
  - useSalesHistory/useSaleDetail/useOrderSearch/useOrderDetail fetch
    order_number; useReturnHistory JOIN orders:original_order_id para
    mostrar Ord. #N en el panel de historial
  - useOrderSearch reescrito: mínimo 1 char, debounce 300ms, detecta
    /^#?\d+$/ (numérico → eq order_number) vs texto (≥2 chars → JOIN
    customers full_name/phone). Filtra siempre por store_id como defensa
    en profundidad además de RLS
  - SalesHistoryPage: muestra #order_number (no UUID), celdas copiables
    (#, cliente, total) con CopyableCell + toast.success 1.5s; detalle
    expandido muestra UUID completo + botón "Copiar UUID" para soporte
  - POSPage TicketModal y ReturnsPage (stepper + ticket + search cards
    + historial) muestran #order_number en todos los lugares
  - Search cards de ReturnsPage rediseñadas: avatar 48px con #N grande,
    cliente arriba, fecha+items+total a la derecha; empty state
    "No se encontraron ventas para X" + sugerencia



Reemplazo de Nequi por Addi en métodos de pago (feature/11-payment-methods) ✅
  - Migración 006_payment_methods_cleanup: ADD VALUE 'addi' al enum
    payment_method, UPDATE orders SET 'transfer' WHERE 'nequi', recrear
    enum payment_method_new sin 'nequi', swap de columnas y rename.
    Líneas para supplier_payments y layaway_payments comentadas (tablas
    aún no existen)
  - src/lib/paymentMethods.ts: helper centralizado con label, color
    token, hex y LucideIcon por método; PAYMENT_METHOD_KEYS const,
    migrateLegacyPaymentMethods() convierte arrays con 'nequi' a 'transfer'
  - PaymentMethod type actualizado en database.types.ts: 'cash' | 'card'
    | 'transfer' | 'addi'
  - StoreConfig.nequi_qr_url → payment_qr_url; resolveConfig migra el
    valor legacy al leer; updateStoreConfig limpia la clave legacy del
    jsonb cuando se actualiza payment_qr_url
  - useConfigMutations.uploadNequiQR → uploadPaymentQR, path
    storeId/payment-qr.ext
  - CajaSection: checkboxes con ícono color por método, sección QR
    "QR para pagos" (visible cuando transfer está habilitado), helper
    de migración aplicado al leer config
  - POSPage PaymentModal: cards muestran ícono con color del método;
    transfer → muestra QR si payment_qr_url existe; addi → nota
    "Pago en cuotas con Addi — confirma desde la app del cliente"
  - SalesHistoryPage, ReturnsPage, CustomersPage, ReportsPage: labels
    y filtros actualizados con Addi en lugar de Nequi
  - ReportsPage: PAYMENT_COLORS, DailyBarRow type, Bar de la gráfica
    apilada y pivotDailySales usan 'addi' (color #ec4899 pink)
  - design-system.md y ConfigPage subtitle: referencias a Nequi
    reemplazadas por Addi / "QR para pagos"

## Estado actual del proyecto
Última fase completada: 11 - Reemplazo Nequi → Addi ✅
En progreso: 09 - Parametrización (pausada, falta prompt 2 Addi)
Siguiente: continuar 09 (Addi) + retomar plan en orden
Fase 14 agregada al roadmap: Switcher multi-store para admin