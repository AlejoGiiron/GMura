-- ============================================================
-- 018 — Recargo de orden (ej. Addi)
--
-- Objetivo: permitir un recargo manual que el vendedor escribe al cobrar
-- (hoy solo aplica a Addi). Se suma al total y se guarda APARTE para poder
-- reportarlo y, más adelante, decidir cómo tratarlo en devoluciones.
--
--   total = subtotal - discount + surcharge
--
-- Nota: la tabla orders NO tiene un CHECK que relacione subtotal/discount/total
-- (solo CHECK de no-negatividad por columna), así que no hay constraint que
-- ajustar. Se actualiza el COMMENT de la tabla para reflejar la fórmula nueva.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS surcharge numeric(12,2) NOT NULL DEFAULT 0
    CHECK (surcharge >= 0);

COMMENT ON COLUMN public.orders.surcharge IS
  'Recargo adicional (ej. Addi). Se suma al total: total = subtotal - discount + surcharge. Por defecto 0.';

COMMENT ON TABLE public.orders IS
  'Cabecera de venta. total = subtotal - discount + surcharge.';
