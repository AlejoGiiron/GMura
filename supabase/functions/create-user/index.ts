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
  store_id: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as CreateUserBody
    const { full_name, email, password, role, store_id } = body

    if (!full_name || !email || !password || !role || !store_id) {
      throw new Error('Faltan campos requeridos')
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (userError) throw userError

    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userData.user.id,
      email,
      full_name,
      role,
      store_id,
      is_active: true,
    })

    if (profileError) {
      await adminClient.auth.admin.deleteUser(userData.user.id)
      throw profileError
    }

    return new Response(JSON.stringify({ success: true, user_id: userData.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
