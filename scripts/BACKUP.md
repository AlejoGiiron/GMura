# Backups de la BD de producción — G-Mura

Sistema de backups de la base de datos de producción (Supabase / PostgreSQL)
de **La Bodega del Jeans**. Pensado para correr un backup confiable **antes de
cada fase que toque la BD** (en particular la migración a multi-tenancy).

> ⚠️ **NUNCA** commitees `.env.backup` (tu credencial) ni los archivos `.dump`
> (datos reales del cliente). Ambos están en `.gitignore`. Si alguno aparece en
> `git status` como trackeado, detente y quítalo del índice.

---

## 1. Configurar la credencial (`.env.backup`)

1. Copia la plantilla:
   ```bash
   cp .env.backup.example .env.backup
   ```

2. Saca la cadena de conexión de Supabase:
   **Dashboard → Settings → Database → Connection string → URI → modo `Session`**
   (no uses el modo `Transaction` para backups).

3. Pega la cadena en `.env.backup` como valor de `GMURA_DB_URL`:
   ```
   GMURA_DB_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
   ```
   - Si tu contraseña tiene caracteres especiales (`@ : / ? #`), URL-encodéalos.
   - `.env.backup` queda solo en tu máquina; nunca se sube al repo.

---

## 2. Requisitos

- `pg_dump` y `pg_restore` instalados y en el `PATH`.
- (Opcional pero recomendado) `psql`, para que el script verifique que la
  versión de tu `pg_dump` sea **>= la del servidor Supabase (15 o 16)**.

Verifica tu versión:
```bash
pg_dump --version
```

> El script **aborta o advierte** si `pg_dump` es más viejo que el servidor: un
> dump con cliente desactualizado puede salir **incompleto**. Instala la versión
> 16 de las client tools de PostgreSQL si hace falta.

---

## 3. Correr un backup

Pásale una **etiqueta de fase** como argumento:

```bash
./scripts/backup-db.sh pre-fase1
./scripts/backup-db.sh pre-multitenancy
```

El script:
- Genera `backups/gmura_YYYYMMDD_HHMM_<etiqueta>.dump` (formato custom `-F c`).
- Verifica que el archivo exista, pese > 0 bytes y que `pg_restore --list`
  muestre tablas y funciones (si no, **borra el dump y falla**).
- Agrega una fila a `backups/REGISTRO.md` con fecha, etiqueta, archivo, tamaño
  y checksum.
- Imprime un resumen.

En Windows usa **Git Bash** o **WSL** para ejecutar el `.sh`.
Si hace falta, dale permisos: `chmod +x scripts/backup-db.sh`.

---

## 4. Restaurar un backup

> ⚠️ `--clean --if-exists` **borra y recrea** los objetos en la BD destino.
> Asegúrate de apuntar a la base correcta (idealmente una de staging/pruebas
> primero, no producción a ciegas).

```bash
pg_restore --clean --if-exists --no-owner --no-acl \
  -d "postgresql://postgres.PROJECT_REF:PASSWORD@HOST:5432/postgres" \
  backups/gmura_YYYYMMDD_HHMM_<etiqueta>.dump
```

- `--clean --if-exists`: elimina objetos previos sin error si no existen.
- `--no-owner --no-acl`: no intenta restaurar dueños/permisos de prod (portable).
- Puedes inspeccionar el contenido sin restaurar:
  ```bash
  pg_restore --list backups/gmura_YYYYMMDD_HHMM_<etiqueta>.dump
  ```

---

## 5. Reglas de seguridad

- **NUNCA** subas `.dump` ni `.env.backup` al repositorio. Tienen credenciales
  y datos personales de clientes.
- Guarda los `.dump` también fuera de la máquina, en almacenamiento cifrado.
- `backups/REGISTRO.md` SÍ se commitea (no contiene datos sensibles, solo
  metadatos: fecha, etiqueta, nombre de archivo, tamaño, checksum).
