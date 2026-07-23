import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Debe coincidir con MIN_PASSWORD_LENGTH del front (src/lib/passwordPolicy.ts).
const MIN_PASSWORD_LENGTH = 8

interface ResetPasswordBody {
  user_id: string
  new_password: string
  reactivate?: boolean
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

  // 1 ── Parse + validación de input (400) ─────────────────────────────────────
  let body: ResetPasswordBody
  try {
    body = (await req.json()) as ResetPasswordBody
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const userId = body.user_id
  const newPassword = body.new_password
  const reactivate = body.reactivate === true

  if (!userId || typeof userId !== 'string') {
    return jsonResponse({ error: 'Falta el usuario destino' }, 400)
  }
  if (
    !newPassword ||
    typeof newPassword !== 'string' ||
    newPassword.length < MIN_PASSWORD_LENGTH
  ) {
    return jsonResponse(
      { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` },
      400,
    )
  }

  // 2 ── Admin client (bypassa RLS) ────────────────────────────────────────────
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // 3 ── Verificar token del llamante (401) ────────────────────────────────────
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  const { data: authData, error: authErr } = await adminClient.auth.getUser(token)
  if (authErr || !authData?.user) {
    return jsonResponse({ error: 'No autenticado' }, 401)
  }
  const callerId = authData.user.id

  // 4 ── Perfil del llamante (403 si inválido) ─────────────────────────────────
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('organization_id, role_id')
    .eq('id', callerId)
    .single()
  if (!callerProfile?.organization_id) {
    return jsonResponse({ error: 'Perfil del llamante inválido' }, 403)
  }

  // 5 ── Permiso del llamante: '*' o usuarios.gestionar (403) ───────────────────
  let callerPerms: string[] = []
  if (callerProfile.role_id) {
    const { data: cr } = await adminClient
      .from('roles')
      .select('permissions')
      .eq('id', callerProfile.role_id)
      .single()
    callerPerms = (cr?.permissions ?? []) as string[]
  }
  const callerIsOwner = callerPerms.includes('*')
  const callerCanManage = callerIsOwner || callerPerms.includes('usuarios.gestionar')
  if (!callerCanManage) {
    return jsonResponse({ error: 'No tienes permiso para restablecer contraseñas' }, 403)
  }

  // 6 ── Perfil DESTINO (404 si no existe) ─────────────────────────────────────
  const { data: targetProfile, error: targetErr } = await adminClient
    .from('profiles')
    .select('organization_id, role_id, is_active')
    .eq('id', userId)
    .single()
  if (targetErr || !targetProfile?.organization_id) {
    return jsonResponse({ error: 'Usuario destino no encontrado' }, 404)
  }

  // 7 ── CROSS-ORG GUARD (crítico multi-tenant, 403) ───────────────────────────
  if (targetProfile.organization_id !== callerProfile.organization_id) {
    return jsonResponse(
      { error: 'No puedes restablecer la contraseña de un usuario de otra organización' },
      403,
    )
  }

  // 8 ── Regla del Dueño: solo un Dueño resetea a otro Dueño (403) ──────────────
  let targetPerms: string[] = []
  if (targetProfile.role_id) {
    const { data: tr } = await adminClient
      .from('roles')
      .select('permissions')
      .eq('id', targetProfile.role_id)
      .single()
    targetPerms = (tr?.permissions ?? []) as string[]
  }
  const targetIsOwner = targetPerms.includes('*')
  if (targetIsOwner && !callerIsOwner) {
    return jsonResponse(
      { error: 'Solo el Dueño puede restablecer la contraseña de otro Dueño' },
      403,
    )
  }

  // 9 ── Actualizar la contraseña en auth (500 si falla) ───────────────────────
  const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
    password: newPassword,
  })
  if (updateErr) {
    return jsonResponse(
      { error: updateErr.message ?? 'No se pudo restablecer la contraseña' },
      500,
    )
  }

  // 10 ── Reactivar si se pidió y el destino estaba inactivo ────────────────────
  let reactivated = false
  if (reactivate && targetProfile.is_active === false) {
    const { error: reactErr } = await adminClient
      .from('profiles')
      .update({ is_active: true })
      .eq('id', userId)
    if (reactErr) {
      // La clave YA se cambió; no revertimos. Se informa el fallo parcial.
      return jsonResponse(
        {
          success: true,
          reactivated: false,
          warning: 'La contraseña se restableció, pero no se pudo reactivar el usuario.',
        },
        200,
      )
    }
    reactivated = true
  }

  return jsonResponse({ success: true, reactivated }, 200)
})
