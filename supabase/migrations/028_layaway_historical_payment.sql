-- ============================================================
-- 028 — Abono histórico en separados (layaway_payments.is_historical)
--
-- PROBLEMA:
--   La Bodega tiene separados VIEJOS donde el cliente ya abonó dinero
--   ANTES de cargar el separado en el sistema. Ese efectivo ya no está
--   en la caja actual. Al cargar el separado necesitamos registrar ese
--   abono para que el SALDO quede correcto (total − abonado), pero SIN
--   que sume al ingreso del turno: contarlo sería doble conteo de un
--   dinero que nunca entró a esta caja.
--
-- SOLUCIÓN:
--   Un flag booleano `is_historical` en layaway_payments. Un abono
--   histórico:
--     · SÍ suma a layaways.paid_amount (trigger sin cambios) → el saldo
--       del separado refleja lo ya abonado y solo se cobra lo que falta.
--     · NO cuenta como ingreso en el cuadre de caja ni en el historial
--       de caja (la capa de aplicación lo excluye por este flag; además
--       se graba con shift_id = NULL).
--
--   Se eligió un flag y no solo shift_id = NULL porque la ruta legacy de
--   useShiftHistory imputa abonos con shift_id NULL a un turno por
--   created_by + ventana de tiempo; un abono histórico cargado hoy sería
--   absorbido por el turno abierto. El flag permite una exclusión
--   explícita e inequívoca en ambas rutas (moderna y legacy).
--
-- ------------------------------------------------------------
-- MODELO CONTABLE (para referencia futura):
--   · Abono HISTÓRICO  → NO cuenta en caja. El dinero entró antes de
--     cargar el separado; contarlo sería doble conteo.
--   · Abono NUEVO      → SÍ cuenta en caja. Es efectivo real que entra
--     ahora, imputado al turno abierto (shift_id).
--   · Al COMPLETAR el separado, la orden de conversión NO cuenta en caja
--     (ya excluida por layaways.converted_order_id) pero SÍ se reconoce
--     en los reportes de ventas por el TOTAL (reconocimiento de la venta,
--     una sola vez).
--   · Resultado: la CAJA cuenta solo el saldo nuevo cobrado; los REPORTES
--     reconocen la venta completa al finalizar. La asimetría es
--     INTENCIONAL: caja = efectivo del día; reportes = venta devengada.
-- ============================================================


-- ============================================================
-- 1. FLAG is_historical
-- ============================================================

ALTER TABLE public.layaway_payments
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.layaway_payments.is_historical IS
  'true = abono recibido ANTES de cargar el separado en el sistema '
  '(dinero que ya no está en esta caja). NO cuenta como ingreso en el '
  'cuadre ni en el historial de caja, pero SÍ suma a layaways.paid_amount '
  '(el saldo del separado). Los abonos normales (efectivo real que entra '
  'ahora) quedan en false. Sin backfill: los abonos existentes SÍ '
  'contaron, por eso conservan el DEFAULT false.';


-- ============================================================
-- 2. ÍNDICE PARCIAL — deliberadamente OMITIDO
-- ============================================================
-- Las consultas de exclusión del cuadre filtran `is_historical = false`
-- (la GRAN MAYORÍA de las filas), y lo hacen SIEMPRE combinadas con
-- shift_id (idx_layaway_payments_shift_id) y store_id, que ya reducen el
-- conjunto a un puñado de filas por turno. Un índice parcial
-- `WHERE is_historical` solo indexaría las filas históricas (útil para
-- BUSCARLAS, no para excluirlas), así que no ayuda a las queries de
-- exclusión. Con la baja cardinalidad esperada de abonos históricos, el
-- filtro residual sobre el resultado ya acotado es despreciable. No se
-- crea índice.


-- ============================================================
-- 3. TRIGGER update_layaway_paid_amount — NO SE TOCA
-- ============================================================
-- El trigger sigue sumando TODOS los abonos (incluido el histórico) a
-- layaways.paid_amount. Esto es CORRECTO Y DELIBERADO: el abono histórico
-- DEBE sumar al saldo para que `total − paid_amount` refleje lo que
-- realmente falta cobrar. La distinción histórico/normal solo importa
-- para el cuadre de caja, que se resuelve en la capa de aplicación
-- filtrando por is_historical. No hay ningún cambio de esquema aquí.


-- ============================================================
-- VERIFICACIÓN (ejecutar manualmente tras aplicar; NO forma parte de la
-- migración transaccional)
-- ============================================================
-- -- 1) La columna existe, es NOT NULL y con default false:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'layaway_payments'
--    AND column_name  = 'is_historical';
-- --> is_historical | boolean | NO | false
--
-- -- 2) Todos los abonos existentes quedaron en false (sin backfill):
-- SELECT is_historical, count(*)
--   FROM public.layaway_payments
--  GROUP BY is_historical;
-- --> solo debe aparecer la fila (false, <total actual>)
--
-- -- 3) El saldo sigue sumando el histórico (smoke test manual):
-- --    Insertá un abono con is_historical = true en un separado de prueba
-- --    y confirmá que layaways.paid_amount subió por ese monto.


-- ============================================================
-- PLAN DE REVERSIÓN
-- ============================================================
-- ADVERTENCIA: si ya se cargaron abonos históricos (is_historical = true),
-- este DROP PIERDE esa marca. Los montos seguirán en paid_amount, así que
-- esos abonos volverían a contarse como ingreso normal en el cuadre →
-- DOBLE CONTEO. Antes de revertir, revisar:
--   SELECT id, layaway_id, amount, created_at
--     FROM public.layaway_payments WHERE is_historical = true;
-- y decidir qué hacer con ellos (p. ej. anular esos abonos).
--
-- Reversión:
--   ALTER TABLE public.layaway_payments DROP COLUMN IF EXISTS is_historical;
