# Generar commit semántico

1. git status y git diff --staged
2. Analiza cambios y determina tipo y scope
3. Tipos: feat/fix/refactor/style/chore/docs/test
4. Scopes: auth/products/variants/pos/inventory/
   barcode/returns/customers/reports/config/db
5. Muestra mensaje propuesto y espera confirmación
6. Ejecuta el commit solo con aprobación explícita

Nunca commitear directo a main o develop.