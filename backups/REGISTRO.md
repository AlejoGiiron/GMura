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
