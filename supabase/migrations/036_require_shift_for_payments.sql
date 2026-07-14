-- ============================================================
-- 036 — Garantía dura: un pago normal DEBE tener turno (shift_id)
--
-- Contexto (Fase 2 de fix/require-shift-for-money):
--   La Fase 1 puso guards en las mutations y la UX (botón deshabilitado +
--   aviso). Falta la garantía a nivel BD: que sea IMPOSIBLE insertar un abono
--   de separado o de fiado sin turno, salvo que sea HISTÓRICO (#3C), que por
--   diseño va con shift_id NULL (dinero recibido antes de cargar el registro).
--
-- Qué hace:
--   CHECK (is_historical IS TRUE OR shift_id IS NOT NULL) en:
--     · layaway_payments
--     · credit_payments
--   Un pago histórico puede no tener turno; cualquier otro DEBE tenerlo.
--
-- POR QUÉ **NOT VALID** (no un CHECK seco):
--   Existen filas PRE-026 legítimas con shift_id NULL e is_historical=false
--   (cuando la columna shift_id ni existía; el cuadre viejo las imputa por
--   ventana de tiempo). Un CHECK validado de inmediato las rechazaría y la
--   migración fallaría. NOT VALID enforza la regla SOLO en filas nuevas
--   (INSERT/UPDATE) y NO revalida el histórico → cierra la fuga hacia adelante
--   sin tocar los datos viejos. NO se ejecuta VALIDATE CONSTRAINT a propósito.
--
-- NULL-safety (lógica de 3 valores): un CHECK solo RECHAZA cuando evalúa a
--   FALSE. `is_historical IS TRUE` da FALSE cuando is_historical es false o NULL
--   (no NULL), así que un pago no-histórico sin turno evalúa a
--   FALSE OR (NULL IS NOT NULL=FALSE) = FALSE → rechazado. Correcto.
--
-- orders: NO se toca (ver nota al final). Los guards de la Fase 1 + la UX
--   cubren las mutations; un CHECK en orders.shift_id sería demasiado amplio
--   (ventas legacy, órdenes de cambio de $0, conversiones de separado…).
--
-- Idempotente (DROP CONSTRAINT IF EXISTS + ADD). Atómica (BEGIN/COMMIT).
-- Requiere: fases 026 (shift_id) y 028/029 (is_historical) aplicadas.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. layaway_payments — abono de separado
-- ------------------------------------------------------------
ALTER TABLE public.layaway_payments
  DROP CONSTRAINT IF EXISTS layaway_payments_shift_required;

ALTER TABLE public.layaway_payments
  ADD CONSTRAINT layaway_payments_shift_required
  CHECK (is_historical IS TRUE OR shift_id IS NOT NULL)
  NOT VALID;

COMMENT ON CONSTRAINT layaway_payments_shift_required ON public.layaway_payments IS
  'Un abono normal exige turno (shift_id). Solo el abono histórico (is_historical=true) puede ir con shift_id NULL. NOT VALID: aplica a filas nuevas; el histórico pre-026 con NULL queda grandfathered.';

-- ------------------------------------------------------------
-- 2. credit_payments — abono de fiado (cartera)
-- ------------------------------------------------------------
ALTER TABLE public.credit_payments
  DROP CONSTRAINT IF EXISTS credit_payments_shift_required;

ALTER TABLE public.credit_payments
  ADD CONSTRAINT credit_payments_shift_required
  CHECK (is_historical IS TRUE OR shift_id IS NOT NULL)
  NOT VALID;

COMMENT ON CONSTRAINT credit_payments_shift_required ON public.credit_payments IS
  'Un abono de fiado normal exige turno (shift_id). Solo el abono histórico (is_historical=true) puede ir con shift_id NULL. NOT VALID: aplica a filas nuevas; el histórico pre-029 con NULL queda grandfathered.';

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (manual — NO corre con la migración)
-- ============================================================
-- ── 1. Los dos CHECK existen y están NOT VALID (convalidated = false) ──
--   SELECT conrelid::regclass AS tabla, conname, convalidated
--     FROM pg_constraint
--    WHERE conname IN ('layaway_payments_shift_required',
--                      'credit_payments_shift_required');
--   -- ESPERADO: 2 filas, convalidated = false (NOT VALID → solo filas nuevas).
--
-- ── 2. Las filas VIEJAS con NULL siguen ahí (NOT VALID no las tocó) ──
--   SELECT count(*) FROM public.layaway_payments
--    WHERE shift_id IS NULL AND is_historical = false;
--   -- ESPERADO: el mismo conteo que antes de la migración (no se rechazaron).
--
-- ── 3. Un INSERT nuevo SIN turno y NO histórico → RECHAZADO ──
--   INSERT INTO public.layaway_payments
--     (layaway_id, store_id, amount, payment_method, created_by,
--      shift_id, is_historical)
--   VALUES ('<layaway>', '<store>', 1000, 'cash', '<user>', NULL, false);
--   -- ESPERADO: ERROR  new row violates check constraint
--   --           "layaway_payments_shift_required"
--
-- ── 4. Un INSERT HISTÓRICO sin turno → PERMITIDO (#3C intacto) ──
--   INSERT INTO public.layaway_payments
--     (layaway_id, store_id, amount, payment_method, created_by,
--      shift_id, is_historical)
--   VALUES ('<layaway>', '<store>', 1000, 'cash', '<user>', NULL, true);
--   -- ESPERADO: INSERT 0 1 (el histórico puede no tener turno).
--   -- (limpiar los INSERT de prueba con DELETE tras verificar)
-- ============================================================


-- ============================================================
-- PLAN DE REVERSIÓN (rollback manual)
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.layaway_payments
--     DROP CONSTRAINT IF EXISTS layaway_payments_shift_required;
--   ALTER TABLE public.credit_payments
--     DROP CONSTRAINT IF EXISTS credit_payments_shift_required;
-- COMMIT;
-- ============================================================


-- ============================================================
-- NOTA — ¿por qué NO un CHECK en orders.shift_id?
-- ============================================================
-- orders tiene varios casos LEGÍTIMOS con shift_id NULL que un CHECK rompería:
--   · Ventas históricas pre-026 (NULL a propósito; el cuadre las imputa por
--     ventana de tiempo).
--   · Órdenes de CAMBIO de $0 (mismo valor) y devoluciones no-efectivo: no
--     mueven caja, pueden crearse sin turno (la Fase 1 solo exige turno cuando
--     la orden de cambio COBRA diferencia).
--   · Órdenes de conversión de separado (el dinero ya entró como abonos).
-- Un CHECK condicionado a todos esos casos sería frágil y de alto riesgo. Las
-- ventas directas ya están cubiertas por el bloqueo full-screen del POS + el
-- guard de useCreateOrder; las de cambio, por el guard de useReturnMutations.
-- Si en el futuro se quiere endurecer orders, hacerlo con un CHECK acotado a
-- (is_credit / return_id / converted) y en su propia migración.
-- ============================================================
