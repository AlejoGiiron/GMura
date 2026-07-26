-- ============================================================
-- Corrección puntual: gasto histórico que NO se pagó en efectivo
--
-- La migración 037 dejó todos los gastos previos en payment_method = 'cash'
-- (así los venía contando el cuadre). Si uno se pagó por transferencia o
-- tarjeta, hay que corregirlo a mano con este script.
--
-- Correr en el SQL editor de Supabase (o con psql como owner): cash_expenses NO
-- tiene política de UPDATE, así que la app no puede hacerlo — es deliberado, la
-- tabla es inmutable para conservar la trazabilidad. Esto es una excepción
-- administrativa.
--
-- OJO: si el turno del gasto YA se cerró, corregir el método cambia el
-- "Esperado" de ese turno y por lo tanto su diferencia (el cuadre se recalcula
-- al reimprimir). Es lo correcto —el dinero nunca salió del cajón— pero deja
-- de coincidir con el ticket impreso ese día. Anotarlo en backups/REGISTRO.md.
-- ============================================================


-- ── 1. Ubicar el gasto (ajusta los filtros) ───────────────────────────────────
SELECT e.id,
       e.created_at,
       e.reason,
       e.notes,
       e.amount,
       e.payment_method,
       e.kind,
       s.name        AS tienda,
       p.full_name   AS registrado_por,
       sh.closed_at  AS turno_cerrado_en
  FROM cash_expenses e
  JOIN stores       s  ON s.id  = e.store_id
  JOIN profiles     p  ON p.id  = e.created_by
  JOIN cash_shifts  sh ON sh.id = e.shift_id
 WHERE s.name ILIKE '%ARMENIA%'
   AND e.created_at >= '2026-07-25T00:00:00-05:00'
   AND e.amount = 200000
 ORDER BY e.created_at DESC;


-- ── 2. Corregir (reemplaza el UUID por el id que devolvió la consulta 1) ──────
-- Descomentar y ejecutar UNA fila a la vez; el RETURNING confirma el cambio.
--
-- UPDATE cash_expenses
--    SET payment_method = 'transfer'
--  WHERE id = '00000000-0000-0000-0000-000000000000'
-- RETURNING id, reason, amount, payment_method;


-- ── 3. Verificar el impacto en el cuadre del turno ────────────────────────────
-- El esperado sube exactamente por el monto corregido:
--   SELECT payment_method, sum(amount)
--     FROM cash_expenses
--    WHERE shift_id = '<shift_id del gasto>'
--    GROUP BY payment_method;
