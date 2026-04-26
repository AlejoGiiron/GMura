# Crear nueva tabla en Supabase

Nombre y propósito: $ARGUMENTS

1. SQL completo con:
   - id UUID DEFAULT gen_random_uuid()
   - store_id FK a stores
   - created_at, updated_at TIMESTAMPTZ
   - RLS habilitado
   - Políticas por store_id
   - Trigger updated_at
   - Índices necesarios
2. Tipos en src/types/database.types.ts
3. Helpers en src/lib/supabase-helpers.ts