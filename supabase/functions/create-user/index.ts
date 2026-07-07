import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateUserBody {
  full_name: string
  email: string
  password: string
  role_id: string
  store_ids: string[]
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Un rol es "gestor" (multi-tienda, equivalente al admin legacy) si puede
// gestionar usuarios; el comodín '*' del Dueño también cuenta. Debe coincidir
// con deriveLegacyRole/isManagerRole del front (src/lib/permissions.ts).
function isManager(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('usuarios.gestionar')
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

  const { full_name, email, password, role_id } = body
  const storeIds = Array.isArray(body.store_ids)
    ? body.store_ids.filter((id) => typeof id === 'string' && id.length > 0)
    : []

  if (!full_name || !email || !password || !role_id) {
    return jsonResponse({ error: 'Faltan campos requeridos' }, 400)
  }
  if (storeIds.length === 0) {
    return jsonResponse({ error: 'Debes seleccionar al menos una tienda' }, 400)
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // ── Autorización del llamante ────────────────────────────────────────────────
  // El admin client bypassa RLS, así que verificamos a mano que quien llama
  // tenga usuarios.gestionar y actúe dentro de SU organización.
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: authData, error: authErr } = await adminClient.auth.getUser(token)
  if (authErr || !authData?.user) {
    return jsonResponse({ error: 'No autenticado' }, 401)
  }
  const callerId = authData.user.id

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('organization_id, role_id')
    .eq('id', callerId)
    .single()
  if (!callerProfile?.organization_id) {
    return jsonResponse({ error: 'Perfil del llamante inválido' }, 403)
  }

  let callerPerms: string[] = []
  if (callerProfile.role_id) {
    const { data: cr } = await adminClient
      .from('roles')
      .select('permissions')
      .eq('id', callerProfile.role_id)
      .single()
    callerPerms = (cr?.permissions ?? []) as string[]
  }
  const callerCanManage =
    callerPerms.includes('*') || callerPerms.includes('usuarios.gestionar')
  if (!callerCanManage) {
    return jsonResponse({ error: 'No tienes permiso para crear usuarios' }, 403)
  }

  // ── Rol elegido: existencia, permisos, org ───────────────────────────────────
  const { data: roleRow, error: roleErr } = await adminClient
    .from('roles')
    .select('organization_id, permissions')
    .eq('id', role_id)
    .single()
  if (roleErr || !roleRow) {
    return jsonResponse({ error: 'Rol inválido' }, 400)
  }
  const rolePerms = (roleRow.permissions ?? []) as string[]

  // Solo un Dueño (con '*') puede asignar un rol Dueño.
  if (rolePerms.includes('*') && !callerPerms.includes('*')) {
    return jsonResponse({ error: 'Solo el Dueño puede asignar el rol Dueño' }, 403)
  }

  // Roles no-gestores no llevan multi-tienda: se ignora todo menos la primera.
  const manager = isManager(rolePerms)
  const stores = manager ? storeIds : storeIds.slice(0, 1)
  const baseStoreId = stores[0]

  // ── Tienda base: derivar organization_id + validar coherencia ────────────────
  const { data: storeRow, error: storeErr } = await adminClient
    .from('stores')
    .select('organization_id')
    .eq('id', baseStoreId)
    .single()
  if (storeErr || !storeRow?.organization_id) {
    return jsonResponse({ error: 'Tienda inválida' }, 400)
  }
  const organizationId = storeRow.organization_id as string

  // El rol debe ser de la misma org que la tienda (el trigger igual lo bloquea).
  if (roleRow.organization_id !== organizationId) {
    return jsonResponse(
      { error: 'El rol no pertenece a la organización de la tienda' },
      400,
    )
  }
  // El llamante solo puede crear usuarios dentro de SU organización.
  if (callerProfile.organization_id !== organizationId) {
    return jsonResponse(
      { error: 'No puedes crear usuarios en otra organización' },
      403,
    )
  }

  // Enum legacy derivado del rol (para no dejar profiles.role stale).
  const legacyRole = manager ? 'admin' : 'seller'

  // ── Crear usuario en auth ────────────────────────────────────────────────────
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

  // ── INSERT profile con organization_id + role_id + enum derivado ─────────────
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    email,
    full_name,
    role: legacyRole,
    role_id,
    organization_id: organizationId,
    store_id: baseStoreId,
    current_store_id: baseStoreId,
    is_active: true,
  })
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId)
    return jsonResponse({ error: profileError.message }, 500)
  }

  // ── Gestores multi-tienda: una fila en user_stores por tienda ────────────────
  if (manager) {
    const rows = stores.map((store_id) => ({ user_id: userId, store_id }))
    const { error: accessError } = await adminClient.from('user_stores').insert(rows)
    if (accessError) {
      await adminClient.from('user_stores').delete().eq('user_id', userId)
      await adminClient.from('profiles').delete().eq('id', userId)
      await adminClient.auth.admin.deleteUser(userId)
      return jsonResponse({ error: accessError.message }, 500)
    }
  }

  return jsonResponse({ success: true, user_id: userId }, 200)
})
