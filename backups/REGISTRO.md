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
