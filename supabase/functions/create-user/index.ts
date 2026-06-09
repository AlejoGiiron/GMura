import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateUserBody {
  full_name: string
  email: string
  password: string
  role: 'admin' | 'seller'
  store_ids: string[]
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Validación de input (errores 400) ───────────────────────────────────────
  let body: CreateUserBody
  try {
    body = (await req.json()) as CreateUserBody
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const { full_name, email, password, role } = body
  const storeIds = Array.isArray(body.store_ids)
    ? body.store_ids.filter((id) => typeof id === 'string' && id.length > 0)
    : []

  if (!full_name || !email || !password || !role) {
    return jsonResponse({ error: 'Faltan campos requeridos' }, 400)
  }
  if (role !== 'admin' && role !== 'seller') {
    return jsonResponse({ error: 'Rol inválido' }, 400)
  }
  if (storeIds.length === 0) {
    return jsonResponse({ error: 'Debes seleccionar al menos una tienda' }, 400)
  }

  // Un vendedor NO debe tener multi-tienda: se ignora todo menos la primera.
  const stores = role === 'seller' ? storeIds.slice(0, 1) : storeIds
  const baseStoreId = stores[0]

  // ── Operaciones con admin client (errores internos → 500) ────────────────────
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // 1. Crear usuario en auth
  const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userError || !userData?.user) {
    return jsonResponse(
      { error: userError?.message ?? 'No se pudo crear el usuario' },
      500,
    )
  }
  const userId = userData.user.id

  // 2. INSERT profiles: store_id (base) + current_store_id (activa inicial)
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    email,
    full_name,
    role,
    store_id: baseStoreId,
    current_store_id: baseStoreId,
    is_active: true,
  })
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId)
    return jsonResponse({ error: profileError.message }, 500)
  }

  // 3. Admin multi-tienda: una fila en user_stores por cada tienda (incluida la
  //    base, para que get_my_stores las liste todas). Los vendedores no usan
  //    user_stores.
  if (role === 'admin') {
    const rows = stores.map((store_id) => ({ user_id: userId, store_id }))
    const { error: accessError } = await adminClient.from('user_stores').insert(rows)
    if (accessError) {
      // Rollback completo para no dejar huérfanos.
      await adminClient.from('user_stores').delete().eq('user_id', userId)
      await adminClient.from('profiles').delete().eq('id', userId)
      await adminClient.auth.admin.deleteUser(userId)
      return jsonResponse({ error: accessError.message }, 500)
    }
  }

  return jsonResponse({ success: true, user_id: userId }, 200)
})
