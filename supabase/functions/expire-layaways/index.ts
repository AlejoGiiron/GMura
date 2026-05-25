// Edge Function: expire-layaways
//
// Marca como 'expired' todos los separados activos cuya fecha de
// vencimiento ya pasó. Delega en la función SQL expire_overdue_layaways()
// que también dispara el trigger que libera reserved_qty.
//
// Despliegue:
//   supabase functions deploy expire-layaways
//
// Programación (cron) — ver README.md.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async () => {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceKey) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(url, serviceKey)

  const { data, error } = await supabase.rpc('expire_overdue_layaways')

  if (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(
    JSON.stringify({ success: true, expired_count: data ?? 0 }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
