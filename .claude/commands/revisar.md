# Revisar código antes del merge

git diff develop y verifica:

1. TypeScript: sin any, props tipadas, tsc --noEmit
2. Variantes: stock siempre por variant_id, nunca product_id
3. Convenciones G-Mura:
   - Precios en COP
   - Fechas en America/Bogota
   - UI en español
4. Seguridad: sin keys hardcodeadas
5. Realtime: canales con nombre único Math.random()
6. UX: skeleton, estado vacío, errores con toast

Reporte por severidad: error / advertencia / sugerencia