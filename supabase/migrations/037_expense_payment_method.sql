-- ============================================================
-- 037 — Método de pago del egreso
--
-- BUG: cash_expenses no registraba CÓMO se pagó el gasto, así que el cuadre
-- restaba TODO egreso del efectivo esperado. Un gasto pagado por transferencia
-- (o tarjeta) no sale del cajón → la caja quedaba con un FALTANTE falso por ese
-- monto (caso real: Armenia, gasto de $200.000 pagado por transferencia).
--
-- Con payment_method, solo los egresos en EFECTIVO afectan el efectivo esperado;
-- los demás quedan registrados en el historial de gastos (siguen siendo gasto
-- del negocio) pero no tocan el cuadre.
--
-- Elección text + CHECK (no el ENUM payment_method): mismo criterio que la 017
-- para `kind` — la tabla ya usa CHECK constraints, el set de métodos válidos de
-- un EGRESO es más chico que el de una venta ('addi' y 'credit' no aplican: no
-- se le fía a un gasto) y ampliarlo no requiere ALTER TYPE.
--
-- Backfill: el DEFAULT 'cash' deja las filas históricas exactamente como el
-- cuadre las venía contando (todas como efectivo) → ningún cierre ya impreso
-- cambia de resultado. Si un gasto viejo se pagó por transferencia, hay que
-- corregirlo a mano (ver scripts/fix-expense-payment-method.sql).
--
-- El trigger register_supplier_payment_as_expense (011) NO se toca: solo crea
-- un cash_expense cuando el pago al proveedor es en efectivo, así que el
-- DEFAULT 'cash' ya es el valor correcto para esas filas. Igual el reembolso de
-- una devolución (kind='return'), que solo se registra si es en efectivo.
-- ============================================================


-- ── 1. Columna ────────────────────────────────────────────────────────────────
ALTER TABLE public.cash_expenses
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'card', 'transfer'));

COMMENT ON COLUMN public.cash_expenses.payment_method IS
  'Cómo se pagó el egreso: ''cash'' (sale del cajón → afecta el cuadre),
   ''card'' o ''transfer'' (no sale del cajón → queda en el historial de gastos
   pero NO se resta del efectivo esperado).';


-- ── 2. Índice ─────────────────────────────────────────────────────────────────
-- El cuadre filtra/agrupa por método dentro de un turno; el índice compuesto
-- sirve tanto al cierre (por shift_id) como al historial por método.
CREATE INDEX IF NOT EXISTS idx_cash_expenses_shift_method
  ON public.cash_expenses(shift_id, payment_method);


-- RLS: sin cambios (solo se agregó una columna; las políticas de cash_expenses
-- siguen igual: SELECT/INSERT por store_id, DELETE solo admin, sin UPDATE).


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Columna creada con el default correcto:
--      SELECT payment_method, count(*), sum(amount)
--        FROM cash_expenses GROUP BY payment_method;
--      -- esperado: una sola fila 'cash' con TODO el histórico
-- 2. El CHECK rechaza métodos inválidos:
--      INSERT ... payment_method = 'addi';   -- debe fallar (23514)
-- 3. Tras corregir un gasto a 'transfer', el "Esperado" de ese turno debe subir
--    exactamente por el monto corregido.
-- ============================================================
