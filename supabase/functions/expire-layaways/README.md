# expire-layaways

Edge Function que expira automáticamente los separados (`layaways`)
cuya `expires_at` ya pasó. Internamente llama a la función SQL
`expire_overdue_layaways()` (migración 008), que marca cada fila
como `expired` y dispara el trigger que libera `reserved_qty` en
`variants`.

## Respuesta

```json
{ "success": true, "expired_count": 4 }
```

## Despliegue

```bash
supabase functions deploy expire-layaways
```

La función usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, que ya
están disponibles en el entorno de las Edge Functions de Supabase.

## Programación (cron)

Se sugiere ejecutarla todos los días a las 3:00 AM hora Bogotá
(equivalente a las 8:00 UTC).

### Opción A — Dashboard de Supabase

Edge Functions → `expire-layaways` → pestaña **Cron** → agregar
`0 8 * * *` (UTC).

### Opción B — SQL con `pg_cron` + `pg_net`

```sql
-- Reemplaza [project-ref] y [anon-key] por los valores del proyecto.
SELECT cron.schedule(
  'expire-layaways-daily',
  '0 8 * * *',  -- 3:00 AM Bogotá = 8:00 UTC
  $$
    SELECT net.http_post(
      url     := 'https://[project-ref].supabase.co/functions/v1/expire-layaways',
      headers := '{"Authorization": "Bearer [anon-key]"}'::jsonb
    );
  $$
);
```

Para listar los jobs activos:

```sql
SELECT * FROM cron.job;
```

Para desprogramar:

```sql
SELECT cron.unschedule('expire-layaways-daily');
```

## Fallback en cliente

`LayawaysPage` ejecuta `useExpireOverdueLayaways()` al montar como
red de seguridad: si el cron falla, los usuarios que entren a la
página verán los separados con el estado correcto. La Edge Function
sigue siendo la fuente de verdad para que los separados se expiren
aunque nadie abra la app.
