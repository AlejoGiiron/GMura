# Registro de backups — BD producción G-Mura

> Este archivo SÍ se versiona en el repo. Los archivos `.dump` NO (contienen
> datos reales del cliente). Cada fila se agrega automáticamente al correr
> `scripts/backup-db.sh`.

## Contexto

La Bodega del Jeans está en **producción**. Se toma un backup antes de cada
fase que toque la base de datos (especialmente la migración a multi-tenancy).

- Cliente para dump: `pg_dump` (formato custom `-F c`, `--no-owner --no-acl`)
- Restauración: ver [scripts/BACKUP.md](../scripts/BACKUP.md)
- Los `.dump` viven en `backups/` (ignorado por git). Guárdalos también fuera
  de la máquina (almacenamiento cifrado) — son datos de cliente.

## Historial

| Fecha | Etiqueta | Archivo | Tamaño | SHA-256 (12) |
|-------|----------|---------|--------|--------------|
<!-- El script agrega una fila aquí por cada backup. No editar manualmente las filas generadas. -->
| 2026-06-29 12:00 | `pre-multitenancy` | `gmura_20260629_1159_pre-multitenancy.dump` | 423KB | `f7d6e794f4bc` |
| 2026-07-09 23:33 | `pre-deploy-020-030` | `gmura_20260709_2333_pre-deploy-020-030.dump` | 489KB | `e8b98311e7c2` |
| 2026-07-10 08:42 | `pre-lab-org` | `gmura_20260710_0841_pre-lab-org.dump` | 522KB | `8bbd512919ee` |
| 2026-07-10 17:48 | `pre-031-layaway-terms` | `gmura_20260710_1747_pre-031-layaway-terms.dump` | 535KB | `a8bdbbf523c8` |
| 2026-07-11 10:13 | `pre-032-033-mixed-payments` | `gmura_20260711_1013_pre-032-033-mixed-payments.dump` | 538KB | `0df7626de4cc` |
| 2026-07-13 19:26 | `pre-034-historial` | `gmura_20260713_1925_pre-034-historial.dump` | 567KB | `9d5250e5b88c` |
| 2026-07-13 19:52 | `pre-035-org-seeding` | `gmura_20260713_1952_pre-035-org-seeding.dump` | 567KB | `0f4cf2fda1d9` |
| 2026-07-14 13:12 | `pre-036-shift-check` | `gmura_20260714_1311_pre-036-shift-check.dump` | 571KB | `01dc03c589b7` |
| 2026-07-22 17:29 | `pre-fix-stock-inicial-pretina` | `gmura_20260722_1728_pre-fix-stock-inicial-pretina.dump` | 613KB | `cb8bce3a71a1` |
| 2026-07-25 22:32 | `pre-fix-orden-fantasma-173` | `gmura_20260725_2232_pre-fix-orden-fantasma-173.dump` | 634KB | `5d564dbd0af6` |
| 2026-07-25 23:14 | `pre-037-expense-payment-method` | `gmura_20260725_2314_pre-037-expense-payment-method.dump` | 634KB | `4913fedbc25c` |
| 2026-08-08 11:16 | `pre-039-anon-grants` | `gmura_20260808_1116_pre-039-anon-grants.dump` | 689KB | `a6f74d6c6a0d` |
| 2026-08-27 09:03 | `pre-040-transfer-enum` | `gmura_20260827_0902_pre-040-transfer-enum.dump` | 743KB | `9e344a57fce3` |
| 2026-08-27 17:56 | `pre-041-store-transfers` | `gmura_20260827_1756_pre-041-store-transfers.dump` | 748KB | `9f8ec5f6e8c8` |
| 2026-08-27 22:37 | `pre-042-transfers-permission` | `gmura_20260827_2237_pre-042-transfers-permission.dump` | 806KB | `dbc0ec6be7b1` |
| 2026-08-28 13:49 | `pre-043-transfer-shipping` | `gmura_20260828_1348_pre-043-transfer-shipping.dump` | 807KB | `2db9ee07ea70` |
