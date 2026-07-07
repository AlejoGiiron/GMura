-- ============================================================
-- 026 — Turno de caja POR TIENDA (estado compartido)
--
-- Contexto del incidente:
--   Hoy el turno es "por usuario" (useCurrentShift filtra por opened_by).
--   Había un turno abierto en una tienda; otro usuario de la MISMA tienda no
--   lo veía (no era suyo) y abrió un SEGUNDO turno → se creó un separado en el
--   turno equivocado. El turno debe ser DE LA TIENDA: si ya hay uno abierto,
--   todos los usuarios de esa tienda ven y operan sobre ese mismo turno.
--
-- Qué hace esta migración (solo SQL; los hooks son código aparte):
--   1. shift_id (nullable) en orders y layaway_payments → imputación DIRECTA de
--      ventas/abonos al turno (reemplaza la heurística tiempo + created_by).
--   2. Guard: aborta TODA la migración si alguna tienda tiene >1 turno abierto
--      (datos inconsistentes rompen el índice único).
--   3. Índice único parcial cash_shifts(store_id) WHERE closed_at IS NULL →
--      garantía a nivel BD de "máximo un turno abierto por tienda" (cierra la
--      carrera al abrir).
--   4. Cierre de turno: de opener-or-admin a has_permission('pos.usar'), porque
--      el turno es de la tienda (quien puede operar la caja puede cerrarlo).
--
-- Multi-tenancy (020-025): el aislamiento sigue por store_id = get_my_store_id().
--   shift_id NO es eje de seguridad → NO se tocan las políticas de datos de
--   orders/layaway_payments. Solo cambia el gating de AUTORÍA del cierre.
--
-- Atómica (BEGIN/COMMIT): el guard del bloque 2 aborta antes del índice.
-- Idempotente donde se puede (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- NO backfill de shift_id (histórico queda NULL, se imputa por tiempo — mismo
--   criterio que 017 con orders.return_id). NO toca TypeScript.
-- Requiere: fases 001-025 aplicadas.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. shift_id en orders y layaway_payments (nullable, sin backfill)
--    ON DELETE SET NULL: si se borra un turno, la venta/abono no se pierde;
--    solo queda sin imputar (el cuadre viejo la reconstruye por tiempo).
--    Las ventas/abonos HISTÓRICOS quedan con shift_id NULL a propósito: no hay
--    señal confiable para asignarles un turno retroactivamente. El cuadro nuevo
--    imputará por shift_id lo que la app grabe de aquí en adelante, y por la
--    ventana de tiempo lo antiguo (forward-only, igual que 017).
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shift_id uuid
    REFERENCES public.cash_shifts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.shift_id IS
  'Turno de caja en el que se registró la venta (imputación directa al cuadre).
   NULL en ventas históricas anteriores a la migración 026 (se imputan por
   ventana de tiempo). ON DELETE SET NULL: no se pierde la venta si se borra el turno.';

ALTER TABLE public.layaway_payments
  ADD COLUMN IF NOT EXISTS shift_id uuid
    REFERENCES public.cash_shifts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.layaway_payments.shift_id IS
  'Turno de caja en el que se cobró el abono de separado (imputación directa al
   cuadre). NULL en abonos históricos anteriores a 026 (se imputan por ventana
   de tiempo). ON DELETE SET NULL.';

CREATE INDEX IF NOT EXISTS idx_orders_shift_id
  ON public.orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_layaway_payments_shift_id
  ON public.layaway_payments(shift_id);

-- NOTA: NO se tocan las políticas RLS de orders ni layaway_payments. El
-- diagnóstico confirmó que el aislamiento sigue por store_id = get_my_store_id()
-- y que shift_id no participa del control de acceso.


-- ------------------------------------------------------------
-- 2. GUARD — abortar si hay >1 turno abierto por tienda
--    El índice único parcial del bloque 3 NO puede crearse si ya existen datos
--    que lo violan (dos turnos abiertos en la misma tienda). En vez de dejar que
--    falle de forma opaca al construir el índice, verificamos primero y abortamos
--    con un mensaje accionable. Esto protege PRODUCCIÓN (turnos colgados) — en el
--    lab se limpian los turnos abiertos duplicados antes de aplicar.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tiendas integer;
BEGIN
  SELECT count(*) INTO v_tiendas
    FROM (
      SELECT store_id
        FROM public.cash_shifts
       WHERE closed_at IS NULL
       GROUP BY store_id
      HAVING count(*) > 1
    ) t;

  IF v_tiendas > 0 THEN
    RAISE EXCEPTION
      'Migración 026 abortada: % tienda(s) tienen MÁS DE UN turno abierto (closed_at IS NULL). El índice "un turno abierto por tienda" no puede activarse sobre datos inconsistentes. Cierra o limpia los turnos colgados y vuelve a aplicar. Diagnóstico: SELECT store_id, count(*) FROM public.cash_shifts WHERE closed_at IS NULL GROUP BY store_id HAVING count(*) > 1;',
      v_tiendas;
  END IF;

  RAISE NOTICE 'Guard OK: ninguna tienda tiene más de un turno abierto. Se puede crear el índice único.';
END;
$$;


-- ------------------------------------------------------------
-- 3. Índice único parcial — máximo un turno abierto por tienda
--    Garantía a nivel BD (no dependemos del pre-check en JS, que tiene ventana
--    de carrera). Un segundo INSERT con closed_at IS NULL en la misma tienda
--    falla con 23505 (unique_violation) → los hooks lo traducen a "Ya hay un
--    turno abierto en esta tienda". Los turnos CERRADOS (closed_at NOT NULL) no
--    entran al índice, así que puede haber muchos históricos por tienda.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_one_open_per_store
  ON public.cash_shifts (store_id)
  WHERE closed_at IS NULL;

COMMENT ON INDEX public.uq_cash_shifts_one_open_per_store IS
  'Un único turno abierto (closed_at IS NULL) por tienda. Defensa real contra la
   carrera al abrir un segundo turno simultáneo en la misma tienda.';


-- ------------------------------------------------------------
-- 4. Política de cierre — de opener-or-admin a permiso de caja
--    Original (001): store_id = get_my_store_id()
--                    AND (opened_by = auth.uid() OR get_my_role() = 'admin')
--    Con el turno compartido por tienda, quien abrió puede no estar; cualquiera
--    que pueda operar la caja de la tienda debe poder cerrar el turno.
--    Nueva: store_id = get_my_store_id() AND has_permission('pos.usar').
--    Se CONSERVA store_id = get_my_store_id() (aislamiento intacto); solo cambia
--    el gating de AUTORÍA. La política original tenía solo USING (sin WITH CHECK),
--    se mantiene igual (en UPDATE, Postgres reutiliza USING como WITH CHECK; el
--    cierre no cambia store_id, así que la fila resultante sigue satisfaciéndola).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "cash_shifts_update" ON public.cash_shifts;
CREATE POLICY "cash_shifts_update"
  ON public.cash_shifts FOR UPDATE
  USING (
    store_id = get_my_store_id()
    AND has_permission('pos.usar')
  );


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (manual — NO se ejecuta con la migración)
-- ============================================================
-- ── 4.1 shift_id existe en ambas tablas, nullable, FK ON DELETE SET NULL ──
--   SELECT table_name, column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public'
--      AND column_name='shift_id'
--      AND table_name IN ('orders','layaway_payments');
--   -- ESPERADO: 2 filas, is_nullable = 'YES'
--
--   SELECT conname, confdeltype   -- confdeltype 'n' = SET NULL
--     FROM pg_constraint
--    WHERE contype='f'
--      AND conrelid IN ('public.orders'::regclass,'public.layaway_payments'::regclass)
--      AND confrelid = 'public.cash_shifts'::regclass;
--   -- ESPERADO: 2 FKs con confdeltype = 'n'
--
-- ── 4.2 El índice único parcial existe ──
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename='cash_shifts' AND indexname='uq_cash_shifts_one_open_per_store';
--   -- ESPERADO: 1 fila, indexdef con "UNIQUE" y "WHERE (closed_at IS NULL)"
--
-- ── 4.3 Abrir un 2º turno en una tienda con turno abierto → 23505 ──
--   -- (como postgres, para probar solo el índice; usar un store con 0 abiertos)
--   INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount)
--     VALUES ('<store_id>', '<user_uuid>', 10000);   -- 1º: OK
--   INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount)
--     VALUES ('<store_id>', '<otro_user_uuid>', 20000); -- 2º misma tienda
--   -- ESPERADO: ERROR 23505 duplicate key value violates unique constraint
--   --           "uq_cash_shifts_one_open_per_store"
--   -- (limpiar: DELETE del turno de prueba o cerrarlo)
--
-- ── 4.4 Un NO-opener con pos.usar puede cerrar el turno de la tienda ──
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" = '{"sub":"<vendedor_uuid_distinto_al_opener>","role":"authenticated"}';
--   UPDATE public.cash_shifts
--      SET closing_amount = 0, closed_at = now(), closed_by = '<vendedor_uuid>'
--    WHERE id = '<turno_abierto_de_su_tienda>';
--   -- ESPERADO: 1 fila afectada (antes fallaba por no ser opener ni admin).
--   -- Un usuario SIN pos.usar o de OTRA tienda → 0 filas (RLS lo filtra).
-- ============================================================


-- ============================================================
-- PLAN DE REVERSIÓN (rollback manual — ejecutar en una transacción)
-- ============================================================
-- BEGIN;
--   -- 4. Restaurar la política de cierre original (opener-or-admin)
--   DROP POLICY IF EXISTS "cash_shifts_update" ON public.cash_shifts;
--   CREATE POLICY "cash_shifts_update"
--     ON public.cash_shifts FOR UPDATE
--     USING (
--       store_id = get_my_store_id()
--       AND (opened_by = auth.uid() OR get_my_role() = 'admin')
--     );
--
--   -- 3. Quitar el índice único parcial
--   DROP INDEX IF EXISTS public.uq_cash_shifts_one_open_per_store;
--
--   -- 1. Quitar shift_id (los índices caen con la columna)
--   DROP INDEX IF EXISTS public.idx_orders_shift_id;
--   DROP INDEX IF EXISTS public.idx_layaway_payments_shift_id;
--   ALTER TABLE public.orders            DROP COLUMN IF EXISTS shift_id;
--   ALTER TABLE public.layaway_payments  DROP COLUMN IF EXISTS shift_id;
-- COMMIT;
-- NOTA: al revertir, los hooks deben volver a la detección por opened_by y al
--   cuadre por ventana de tiempo (paso de código, aparte).
-- ============================================================
