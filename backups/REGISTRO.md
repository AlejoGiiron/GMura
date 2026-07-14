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
