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


-- ── 2. Corregir ───────────────────────────────────────────────────────────────
-- Caso ya identificado en prod (2026-07-25): LA BODEGA DEL JEANS - ARMENIA,
-- gasto de $200.000 registrado por natalia rojo a las 19:02 (Bogotá), motivo
-- FACTURAS, nota "ABONO DON JUAN CARLOS". Se pagó por TRANSFERENCIA, no en
-- efectivo. Su turno seguía ABIERTO al momento de la corrección → no altera
-- ningún cuadre ya impreso.
--
-- El AND payment_method = 'cash' hace la corrección idempotente: si ya se
-- corrió, devuelve 0 filas en vez de volver a escribir.
UPDATE cash_expenses
   SET payment_method = 'transfer'
 WHERE id = '96dc69ab-96cd-45a9-8cd5-51b125edb816'
   AND payment_method = 'cash'
RETURNING id, reason, notes, amount, payment_method;


-- ── 3. Verificar el impacto en el cuadre del turno ────────────────────────────
-- El esperado sube exactamente por el monto corregido:
--   SELECT payment_method, sum(amount)
--     FROM cash_expenses
--    WHERE shift_id = '<shift_id del gasto>'
--    GROUP BY payment_method;
