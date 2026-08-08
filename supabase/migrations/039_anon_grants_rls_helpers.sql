-- ============================================================
-- 039 — Fix de sesión: los helpers de RLS deben ser ejecutables por `anon`
--
-- ── EL BUG DE PRODUCCIÓN (el usuario "entra y lo saca") ──────────────────────
--
-- Síntoma reportado en Armenia (2026-08-08): un vendedor inicia sesión y la app
-- lo devuelve al login. En los logs de Postgres:
--
--     permission denied for function get_my_organization_id   (SQLSTATE 42501)
--     User: authenticator   Command: BIND
--     Query: WITH pgrst_source AS (SELECT profiles.*, ... LEFT JOIN LATERAL
--            (SELECT roles_1.name, roles_1.permissions FROM roles ...) ...)
--
-- Esa query es exactamente el fetchProfile de AuthContext
-- (`profiles` + join embebido a `roles`).
--
-- Causa raíz: la migración 020 hizo
--     REVOKE EXECUTE ON FUNCTION get_my_organization_id() FROM public, anon;
-- pero la política `roles_select_org` (021) la INVOCA y, como toda política de
-- este esquema, aplica al rol `{public}` — o sea también a `anon`.
--
-- Cuando PostgREST recibe una petición SIN JWT válido (token vencido, o la
-- carrera entre getSession() y onAuthStateChange al abrir la app) ejecuta la
-- consulta como `anon`. Entonces, en vez de degradar a "0 filas" —que es como
-- se comporta el RLS normalmente, porque auth.uid() es NULL— revienta con un
-- 42501 duro. El catch de fetchProfile lo interpretaba como sesión inválida y
-- cerraba sesión. De ahí el "entra y lo saca".
--
-- Reproducción exacta (confirmada contra producción antes de escribir esto):
--     BEGIN; SET LOCAL ROLE anon;
--       <la query del log>            -- ERROR: permission denied ...
--     ROLLBACK;
--
-- El arreglo es devolverle a `anon` el EXECUTE sobre los helpers que las
-- políticas invocan. NO abre datos: las tres funciones se apoyan en auth.uid(),
-- que para `anon` es NULL, así que devuelven NULL/false y la política evalúa a
-- falso → 0 filas. Es precisamente el comportamiento que ya tienen
-- get_my_store_id() y get_my_role(), que sí conservan el EXECUTE de PUBLIC.
-- La inconsistencia entre unos helpers y otros ERA el bug.
--
-- Auditadas TODAS las funciones citadas por CUALQUIER política de `public`:
-- faltaban exactamente estas tres.
--
-- Atómica (BEGIN/COMMIT) e idempotente. No toca datos, tablas ni políticas.
-- Requiere: 020-025 aplicadas.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Helpers de RLS ejecutables por `anon`
--
--    Se otorga a `anon` explícitamente en vez de a PUBLIC: es el único rol que
--    falta y así el GRANT dice a quién habilita y por qué.
--
--    Seguridad: las tres son SECURITY DEFINER y filtran por auth.uid(), que
--    para `anon` es NULL →
--      get_my_organization_id() → NULL
--      has_permission(x)        → false
--      is_store_in_my_org(x)    → false
--    Ninguna devuelve datos sin sesión; solo dejan de abortar la consulta.
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_my_organization_id() TO anon;
GRANT EXECUTE ON FUNCTION public.has_permission(text)     TO anon;
GRANT EXECUTE ON FUNCTION public.is_store_in_my_org(uuid) TO anon;


-- ------------------------------------------------------------
-- 2. Red de seguridad GENÉRICA contra este mismo bug.
--
--    No basta con arreglar las tres funciones de hoy: el defecto reaparece en
--    cuanto alguien escriba una política nueva que invoque un helper sin
--    EXECUTE para `anon`, y no se nota hasta que a un usuario real lo saca la
--    app. Así que se descubren TODAS las funciones citadas por CUALQUIER
--    política de `public` y se exige el grant. Si falta una, esta migración
--    falla al aplicarse en vez de dejar el hueco abierto.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  WITH pol AS (
    SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
      FROM pg_policies WHERE schemaname = 'public'
  ), fns AS (
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  )
  SELECT string_agg(DISTINCT f.proname, ', ') INTO v_missing
    FROM fns f
    JOIN pol ON pol.expr ~ ('\m' || f.proname || '\s*\(')
   WHERE NOT has_function_privilege('anon', f.oid, 'EXECUTE');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Estas funciones se usan en políticas RLS pero anon no puede ejecutarlas; una petición sin JWT válido abortaría con 42501 en vez de devolver 0 filas: %',
      v_missing;
  END IF;
  RAISE NOTICE 'OK: toda función usada en políticas es ejecutable por anon (degradan a 0 filas).';
END;
$$;


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. El fetchProfile ya NO revienta sin sesión: debe devolver 0, no 42501.
--   BEGIN; SET LOCAL ROLE anon;
--     WITH pgrst_source AS (
--       SELECT profiles.*, row_to_json(r.*)::jsonb AS rbac_role
--         FROM profiles
--         LEFT JOIN LATERAL (
--           SELECT roles_1.name, roles_1.permissions FROM roles AS roles_1
--            WHERE roles_1.id = profiles.role_id LIMIT 1
--         ) AS r ON TRUE
--        WHERE profiles.id = '<uid>' LIMIT 1
--     ) SELECT count(*) FROM pgrst_source;      -- ESPERADO: 0 (antes: ERROR 42501)
--   ROLLBACK;
--
-- 2. Con sesión válida sigue devolviendo su fila:
--   BEGIN; SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
--     SELECT count(*) FROM profiles WHERE id = '<uid>';   -- ESPERADO: 1
--   ROLLBACK;
--
-- 3. Sin sesión no se filtra NADA (el grant no abre datos):
--   BEGIN; SET LOCAL ROLE anon;
--     SELECT get_my_organization_id();          -- ESPERADO: NULL
--     SELECT has_permission('usuarios.gestionar');  -- ESPERADO: false
--     SELECT count(*) FROM profiles;            -- ESPERADO: 0
--   ROLLBACK;
-- ============================================================
