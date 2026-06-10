-- ============================================================
-- 017 — Separar devoluciones en el cuadre de caja
--
-- Objetivo: poder categorizar el dinero de devoluciones aparte de ventas y
-- egresos, SIN cambiar el cálculo del cuadre (solo la presentación).
--
-- Salidas (reembolsos en efectivo) → cash_expenses.kind = 'return'
-- Entradas (diferencia cobrada en un cambio) → orders.return_id apunta a la
--   devolución que las originó (presencia = no es una venta pura).
--
-- Elección kind text + CHECK (no ENUM): cash_expenses ya usa CHECK constraints
-- (amount > 0, reason no vacío), el set es chico y, si más adelante se agrega
-- 'supplier_payment', basta cambiar el CHECK (vs ALTER TYPE ... ADD VALUE, que
-- no corre dentro de una transacción en algunas versiones de Postgres).
-- ============================================================


-- ── 1. cash_expenses: categoría + traza a la devolución ───────────────────────
ALTER TABLE public.cash_expenses
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense'
    CHECK (kind IN ('expense', 'return'));

ALTER TABLE public.cash_expenses
  ADD COLUMN IF NOT EXISTS return_id uuid
    REFERENCES public.returns(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cash_expenses.kind IS
  'Categoría del egreso: ''expense'' (gasto/pago normal) o ''return''
   (reembolso de una devolución/cambio). Se muestra aparte en el cuadre.';
COMMENT ON COLUMN public.cash_expenses.return_id IS
  'Devolución que originó el reembolso (si kind = ''return'').';


-- ── 2. orders: marcar las órdenes que son diferencia de un cambio ─────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS return_id uuid
    REFERENCES public.returns(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.return_id IS
  'Si la orden es la diferencia cobrada en un cambio, apunta a la devolución.
   Presencia = ingreso por devolución (no una venta pura); se muestra en la
   sección Devoluciones del cuadre, no en Ventas.';


-- ── 3. Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cash_expenses_kind
  ON public.cash_expenses(kind);

CREATE INDEX IF NOT EXISTS idx_orders_return_id
  ON public.orders(return_id) WHERE return_id IS NOT NULL;


-- ── 4. Backfill de salidas históricas (solo cash_expenses, por prefijo) ───────
-- Las entradas (orders.return_id) NO se backfillean: no hay señal confiable
-- para identificar retroactivamente qué órdenes viejas fueron diferencias de
-- cambio. Se aplica solo hacia adelante.
UPDATE public.cash_expenses
   SET kind = 'return'
 WHERE kind = 'expense'
   AND reason LIKE 'Devolución%';


-- RLS: sin cambios (solo se agregaron columnas; las políticas de cash_expenses
-- y orders siguen igual).


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Columnas creadas:
--      SELECT kind, count(*) FROM cash_expenses GROUP BY kind;   -- expense / return
--      SELECT count(*) FROM orders WHERE return_id IS NOT NULL;  -- 0 (forward-only)
-- 2. Backfill correcto:
--      SELECT reason, kind FROM cash_expenses WHERE reason LIKE 'Devolución%' LIMIT 5;
--      -- todas deben tener kind = 'return'
-- ============================================================
