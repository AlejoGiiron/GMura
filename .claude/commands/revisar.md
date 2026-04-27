---
description: Revisa los cambios de la rama actual contra develop — convenciones, tipos, seguridad y calidad.
---

Revisa los cambios del branch actual con `git diff develop...HEAD`.
Evalúa cada archivo modificado o creado y produce un reporte estructurado.

## Criterios de revisión

### TypeScript
- Ejecuta `npx tsc --noEmit` y reporta cualquier error
- Detecta usos de `any` — proponer el tipo correcto en cada caso
- Verifica que las props de componentes estén tipadas con interfaces explícitas

### Convenciones G-Mura
- Strings de UI en español (Colombia) — ningún texto visible al usuario en inglés
- Precios con `Intl.NumberFormat('es-CO')` en COP
- Fechas en zona horaria `America/Bogota`
- Componentes en PascalCase, hooks con prefijo `use`
- Queries de Supabase solo dentro de `src/hooks/`
- Mutaciones en hooks `use{X}Mutaciones` — no inline en handlers
- Si hay variantes: siempre `variant_id` presente, stock nunca por producto

### Manejo de errores
- Errores de Supabase con `toast.error()` de react-hot-toast
- Sin `catch` vacío ni `console.error` sin toast

### Seguridad
- Sin secretos o credenciales hardcodeadas
- Sin `dangerouslySetInnerHTML` sin sanitización
- Sin `eval()` o ejecución dinámica de código

### Calidad general
- Sin imports sin usar
- Sin `console.log` de depuración
- Sin comentarios que describan qué hace el código
- Sin `TODO` sin issue asociado
- Cada componente con datos debe tener skeleton y estado vacío

## Formato del reporte

Para cada problema:
- **Archivo y línea** (como link clickeable si es posible)
- **Severidad**: error / advertencia / sugerencia
- **Descripción** del problema
- **Corrección propuesta**

Al final: resumen con N errores, M advertencias, K sugerencias.
Si no hay problemas, confirmarlo explícitamente.