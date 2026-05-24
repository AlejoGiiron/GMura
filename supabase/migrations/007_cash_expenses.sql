-- ============================================================
-- 007 — Egresos de caja durante un turno
--
-- Cada gasto queda asociado al turno (shift_id) y al usuario
-- que lo registró. Inmutables: solo INSERT (sellers + admin) y
-- DELETE (admin). No hay UPDATE para mantener trazabilidad.
-- ============================================================

CREATE TABLE public.cash_expenses (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id    uuid        NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  store_id    uuid        NOT NULL REFERENCES public.stores(id)      ON DELETE CASCADE,
  amount      numeric(12,2) NOT NULL,
  reason      text        NOT NULL,
  notes       text,
  created_by  uuid        NOT NULL REFERENCES public.profiles(id)    ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cash_expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT cash_expenses_reason_non_empty CHECK (length(trim(reason)) > 0)
);

CREATE INDEX idx_cash_expenses_shift_id ON public.cash_expenses(shift_id);
CREATE INDEX idx_cash_expenses_store_id ON public.cash_expenses(store_id);

ALTER TABLE public.cash_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_expenses_select"
  ON public.cash_expenses FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "cash_expenses_insert"
  ON public.cash_expenses FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

CREATE POLICY "cash_expenses_delete_admin"
  ON public.cash_expenses FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');

COMMENT ON TABLE public.cash_expenses IS
  'Egresos de caja durante un turno. Cada gasto está asociado al turno y al usuario que lo registró. Inmutables: solo INSERT y DELETE (admin).';
