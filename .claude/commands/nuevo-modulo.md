# Crear nuevo módulo completo

Nombre del módulo: $ARGUMENTS

1. Lee src/design-system.md antes de escribir código
2. Crea src/pages/[Nombre]Page.tsx con:
   - Layout consistente con el resto del panel
   - Skeleton mientras carga
   - Estado vacío con mensaje útil
   - Manejo de errores con toast
3. Crea src/hooks/use[Nombre].ts con:
   - Query con React Query
   - Mutaciones: create, update, delete
   - Tipado desde database.types.ts
4. Agrega ruta en src/App.tsx con ProtectedRoute
5. Agrega link en Sidebar con ícono de lucide-react
6. Genera SQL si el módulo requiere tabla nueva

Convenciones obligatorias del CLAUDE.md antes de escribir.