# Plan — Traslados de mercancía entre tiendas

**Necesidad:** hoy mover 5 pantalones de Tebaida a Armenia son dos ajustes manuales
descoordinados, sin trazabilidad y sin ningún momento en que la mercancía esté
"en camino".

**Decisiones tomadas con el usuario:**
- El envío puede tardar días (encomienda) u horas (alguien lo lleva) → el flujo
  debe soportar el caso lento.
- **El estado "en tránsito" es obligatorio:** mientras viaja, la mercancía no
  debe poder venderse en ninguna de las dos tiendas.
- La recepción es SIMPLE por ahora (el destino confirma que llegó), pero el
  modelo debe admitir después conteo por línea y faltantes **sin rediseñar**.
- **Mapeo: la intermedia** — el sistema sugiere coincidencias del destino, quien
  envía elige explícitamente (§2.4).
- **La recepción la puede confirmar el origen o un admin**, con rastro de quién
  lo hizo (§2.6).
- **Barcode: se reimprime etiqueta en el destino.** No se toca el UNIQUE global
  en este lote (§1.2).

**Método:** el de siempre. Rama → lab → deploy acotado, gate por fase
(tsc + eslint + tests), migraciones a prod con backup previo, BD antes que
frontend. `develop = producción`.

**Estado:** rama `feature/store-transfers` creada desde develop. Gate de partida
verde (tsc + eslint + 290 tests). Diseño cerrado; siguiente paso: migración 040.

---

## 1. Diagnóstico

### 1.1 El modelo de stock — CRÍTICO, y define todo el diseño

**No hay tabla de stock por tienda.** El stock vive en `variants.stock_qty`, y
tanto `variants.store_id` como `products.store_id` son `NOT NULL`. Cada tienda
tiene su propio catálogo: sus productos, sus variantes, sus categorías.

> Un mismo jean en Tebaida y en Armenia son **dos filas de `products` y dos filas
> de `variants` sin ninguna relación entre sí** en el modelo. No existe el
> concepto de "producto del negocio con stock por sucursal".

**Datos reales** (backup `pre-039-anon-grants`, 2026-08-08, leído en local):

| | Tebaida | Armenia |
|---|---|---|
| Productos | 199 | 155 |
| Variantes | 1.045 | 745 |
| Nombres de producto distintos (normalizados) | 103 | 147 |

Nombres que aparecen en **ambas** tiendas: **18**. Los catálogos son casi
disjuntos. Y hay duplicación interna fuerte: 199 productos para 103 nombres
distintos en Tebaida.

**Consecuencias directas:**
1. Un traslado no es "mover stock", es **mover entre dos filas de variantes
   distintas** → `transfer_items` necesita variante origen **y** variante destino.
2. En la mayoría de los casos **la variante destino no existe** → el traslado
   tiene que poder **crearla** (producto incluido).
3. Con 199 productos / 103 nombres, el match automático va a ser **ambiguo** con
   frecuencia → el mapeo no puede ser magia silenciosa (§2.4).

### 1.2 El barcode NO sirve como llave de mapeo — DECIDIDO

`variants_barcode_unique UNIQUE (barcode)` es **global** (001, nunca modificada).
Las 1.793 variantes tienen barcode, **todas de 12 dígitos generados al azar por
la app** — no son EAN de fabricante.

→ El mismo jean físico tiene un barcode distinto en cada tienda, y **no puede
compartirlo**: el UNIQUE es global. Mapear por barcode es imposible.

**Decisión confirmada: se reimprime la etiqueta en el destino.** El UNIQUE global
no se toca en este lote. La variante creada en el destino genera su propio
barcode con el `generateBarcode` de siempre.

> **⚠️ Aviso operativo para la tienda (va en la UI de recepción, no solo acá):**
> la etiqueta que viaja pegada a la prenda **no escanea en el destino**. Hay que
> **reimprimir al recibir**, o la prenda no se puede vender por lectora. La
> pantalla de recepción ofrece "Imprimir etiquetas de lo recibido" reusando
> `LabelPrintModal`.

**Mejora futura anotada — relajar `variants_barcode_unique` a
`(store_id, barcode)`.** Permitiría que la variante gemela lleve el mismo código y
que la etiqueta viaje con la prenda. Es viable a primera vista (el escaneo del POS
trabaja sobre el catálogo de la tienda activa, y la única búsqueda server-side por
barcode — `useReturns:488` — ya queda filtrada por RLS), **pero requiere su propio
análisis**: toca el POS, el escaneo, la búsqueda de devoluciones, la de compras y
`barcodeMatch`. Es tocar un UNIQUE en producción con 1.793 filas. **No en este
lote, y no como apéndice de otro.**

### 1.3 `reserved_qty` no sirve para "en tránsito"

Hoy `reserved_qty` = reservado por separados activos; `disponible = stock_qty −
reserved_qty`; los triggers de layaway lo suben y bajan por sus propios ítems.

No conviene reusarlo:
1. Ya significa otra cosa y la UI de Inventario muestra una columna "Reservado"
   que pasaría a mezclar dos conceptos.
2. Reservar en el origen deja la mercancía **contada en el stock del origen**, y
   lo que se necesita es que no esté disponible en **ninguna**.
3. La migración `038_stock_trigger_hardening` (fase 0 del plan de venta atómica,
   escrita y sin aplicar) va a tratar el reservado como intocable. Mezclar los dos
   conceptos justo ahí es pedir un bug.

**Dónde vive el stock en tránsito:** opción **(a) del brief**. El stock **sale del
origen al despachar** y **entra al destino al recibir**; en el medio no vive en
ningún `variants`. El tránsito es el propio `transfer_items` (más una vista de
solo lectura para visibilidad).

- Cumple el requisito duro (invendible en ambas) **por construcción**, sin campo
  nuevo ni segundo mecanismo de reserva.
- Descarto `in_transit_qty`: obliga a tocar **cada** lectura de stock (Inventario,
  POS, reportes, Excel, `VariantsPanel`) para no contar dos veces.
- El "desaparece del inventario" se resuelve con visibilidad, no con un campo:
  vista `stock_in_transit` + filtro en Inventario (fase 6).

### 1.4 Los triggers de stock existentes — el patrón a seguir

`deduct_stock_on_sale`, `restore_stock_on_return`, `increase_stock_on_purchase`,
`reserve/release/fulfill` de separados comparten el molde:

> `AFTER INSERT` sobre la tabla hija · `SECURITY DEFINER` · (1) valida stock,
> (2) `UPDATE variants`, (3) `INSERT stock_movements`.

Dos cosas que hereda este módulo y una que **no** debe heredar:

- ✅ `SECURITY DEFINER` bypasea RLS: así es como hoy un vendedor escribe en
  `stock_movements` sin tener `inventario.gestionar`. **Ese mismo mecanismo es el
  que nos deja escribir en la tienda destino.**
- ✅ `stock_movements` como bitácora inmutable con `reference_id` al documento.
- ❌ El hueco de concurrencia: `SELECT stock_qty` sin `FOR UPDATE` y después
  `UPDATE` (hallazgo de la fase 0). El traslado **no debe nacer con esa carrera**.
  Lo mismo vale para `adjustStock` (`useInventoryMutations`), que hoy hace
  read-modify-write desde el cliente sin lock — el traslado no lo copia.

### 1.5 RLS cruzando tiendas — el punto realmente delicado

```sql
CREATE POLICY "variants_select" ON variants FOR SELECT
  USING (store_id = get_my_store_id());
```

`get_my_store_id()` devuelve **una** tienda (la activa, `profiles.current_store_id`).

→ **El usuario de Tebaida no puede ni siquiera LEER el catálogo de Armenia**, mucho
menos escribir en él. Ninguna política nueva sobre `variants` arregla esto sin
abrir el aislamiento de todo el sistema.

La casa ya tiene la herramienta exacta para esto — `is_store_in_my_org()` (022),
creada literalmente por este problema:

> *"las subconsultas dentro de políticas RLS respetan el RLS de la tabla
> referenciada; el RLS de stores solo deja ver la tienda activa (…) SECURITY
> DEFINER lo evita"*

**Solución:**

1. **La escritura del traslado NO se hace con INSERT/UPDATE desde el cliente.** Se
   hace con RPC `SECURITY DEFINER` (molde: `create_store_with_access`, 015) que
   **reimplementan adentro el control que el DEFINER bypasea**: identidad
   (`auth.uid()`), permiso (`has_permission`), tienda activa (`get_my_store_id()`)
   y misma organización (`is_store_in_my_org`).
2. `transfers` / `transfer_items` llevan RLS **solo de lectura**:
   `from_store_id = get_my_store_id() OR to_store_id = get_my_store_id()`.
   Escritura desde el cliente: **denegada por ausencia de política**, tal como ya
   están `order_items` / `return_items` para UPDATE y DELETE.
3. Quién puede recibir: ver **§2.6** (decisión ampliada).

### 1.6 Lo que el traslado NO toca

Caja. Un traslado no mueve dinero: no crea orden, ni pago, ni `cash_expense`, ni
depende de que haya turno abierto. No entra al cuadre ni a `shiftCalc`.

---

## 2. Diseño

### 2.1 Tablas

```
transfers
  id                   uuid PK
  transfer_number      int  NOT NULL         -- secuencial POR ORGANIZACIÓN
  organization_id      uuid NOT NULL
  from_store_id        uuid NOT NULL
  to_store_id          uuid NOT NULL         -- CHECK (from <> to)
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','in_transit','received','cancelled'))
  carrier              text                  -- encomienda / quién lo lleva
  tracking_ref         text                  -- número de guía
  notes                text
  created_by/at, dispatched_by/at, cancelled_by/at, cancel_reason
  received_by          uuid                  -- QUIÉN confirmó
  received_at          timestamptz
  received_by_store_id uuid                  -- DESDE QUÉ tienda confirmó  (§2.6)

transfer_items
  id                uuid PK
  transfer_id       uuid NOT NULL  (ON DELETE CASCADE)
  from_variant_id   uuid NOT NULL  (ON DELETE RESTRICT)
  dest_action       text NOT NULL         -- la elección de quien envía (§2.4)
                    CHECK (dest_action IN ('map_variant','map_product','create_product'))
  to_product_id     uuid NULL      (ON DELETE RESTRICT)
  to_variant_id     uuid NULL      (ON DELETE RESTRICT)
  dest_resolution   text NULL             -- qué pasó al recibir  (§2.4)
                    CHECK (dest_resolution IN ('as_chosen','auto_matched'))
  qty_sent          int  NOT NULL CHECK (qty_sent > 0)
  qty_received      int  NULL     CHECK (qty_received IS NULL OR qty_received >= 0)
  -- snapshot
  product_name, brand, description, size, color, unit_cost, unit_price
```

Decisiones que vale la pena explicar:

- **`transfer_number` por ORGANIZACIÓN, no por tienda.** `order_number` es por
  tienda porque una venta pertenece a una tienda; un traslado **cruza dos**, y
  numerarlo por origen haría que Armenia hable del "#14 de Tebaida". Mismo patrón
  que `assign_order_number` (advisory lock + MAX+1), con la llave en
  `organization_id`.
- **El snapshot desnormalizado no es opcional.** Sin él, el destino **no puede ni
  mostrar la lista de lo que le mandaron**: el RLS le tapa las variantes del
  origen. Va también `description`, porque junto con la marca es lo que distingue
  dos fichas del mismo nombre (§2.4).
- **`status` como `text` + `CHECK`, no ENUM.** Convención ya establecida en la
  casa (`cash_expenses.kind` en 017, `payment_method` del gasto en 037), y acá
  paga doble: agregar `'received_with_differences'` cuando llegue el conteo es
  una migración de una línea, no un `ALTER TYPE`.
- **Los CHECK de coherencia se quedan en el mínimo** (`dest_action='map_variant'
  → to_variant_id NOT NULL`). El resto de la coherencia — que tras recibir queden
  llenos `to_product_id` y `to_variant_id` — **la garantiza el RPC, que es el
  único escritor**: no hay política de INSERT ni UPDATE para el cliente. Un CHECK
  más estricto tendría que distinguir antes/después de la recepción y no aporta.

### 2.2 Flujo de estados

```
        crear                despachar              recibir
   ─────────────►  draft  ─────────────►  in_transit  ─────────────►  received
                     │                        │
                     │ cancelar               │ revertir despacho
                     ▼                        ▼
                 cancelled                cancelled
                 (sin efecto)         (el stock vuelve al ORIGEN)
```

- **`draft` NO reserva stock.** Es un borrador para armar el envío mientras se
  empaca y sobrevivir a un refresh. Si alguien vende esas unidades mientras tanto,
  el despacho falla con un error claro. Reservar obligaría a overloadear
  `reserved_qty` (§1.3) por un caso de borde. *(Si el borrador termina viviendo
  días, se revisa.)*
- **Despachar** es el momento atómico: valida, descuenta del origen, deja el
  documento `in_transit`.
- **Cancelar** solo desde `draft`.
- **Revertir despacho** (`in_transit → cancelled`, devuelve el stock al origen):
  **va en el MVP**, gated por permiso. El caso "me equivoqué, la caja nunca salió"
  aparece el día 1. Lo que **no** debe existir es un "cancelar" desde `in_transit`
  que deje el stock en el limbo o lo materialice en el destino: si la mercancía ya
  llegó y hay que devolverla, eso **es otro traslado** (Armenia → Tebaida), no una
  cancelación.
  - Como la creación en el destino se difiere a la recepción (§2.4), **una
    reversión no deja ni un producto huérfano en el destino**.

### 2.3 Movimientos de stock

**Dos tipos nuevos en el enum `movement_type`: `transfer_out` y `transfer_in`.**

| Evento | variant | store | type | qty |
|---|---|---|---|---|
| Despachar | `from_variant_id` | origen | `transfer_out` | `−qty_sent` |
| Recibir | `to_variant_id` | destino | `transfer_in` | `+qty_sent` |
| Revertir | `from_variant_id` | origen | `transfer_in` | `+qty_sent` |

`reference_id = transfer_id` en los tres casos.

**Por qué dos tipos y no uno:** un solo `'transfer'` con `qty` firmado funcionaría
mecánicamente, pero los dos eventos ocurren **en tiendas distintas y en momentos
distintos** (días). Con dos tipos, el historial de inventario se lee solo
("Salida por traslado #12" / "Entrada por traslado #12") y los reportes filtran
sin mirar el signo.

> ⚠️ **Trampa de despliegue:** `ALTER TYPE ... ADD VALUE` **no se puede usar en la
> misma transacción donde se agrega**. Por eso el enum va en su **propia
> migración**, suelta y sin uso (precedente: la 006 con `'addi'`), y las tablas y
> funciones en la siguiente. Ver fases 1 y 2.

### 2.4 Mapeo origen → destino — LA INTERMEDIA (decidido)

#### 2.4.1 La normalización no es un detalle: triplica las coincidencias

Medido sobre los datos reales de las dos tiendas:

| | Crudo | Normalizado |
|---|---|---|
| Marcas distintas | 76 | **70** |
| Coincidencias cruzadas Tebaida ↔ Armenia (nombre + marca) | **5** | **15** |

`DOMINA`/`domina` (52 y 17 productos), `CHAMBER`/`Chamber` (18 y 10),
`NAVI`/`Navi` (36 y 9), `DEYLEID`/`Deyleid` (15 y 7), `STIL`/`Stil` (9 y 8).

→ **Sin normalizar, el módulo sugeriría 5 coincidencias en vez de 15**: dos de
cada tres fichas gemelas se perderían y se crearían duplicados. La normalización
es lo que hace que el módulo *reduzca* el desorden en vez de multiplicarlo.

Función `IMMUTABLE` (para poder indexar por ella), **sin extensiones nuevas**:

```sql
CREATE OR REPLACE FUNCTION public.normalize_catalog_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    regexp_replace(
      upper(translate(btrim(coalesce(p, '')),
                      'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
      '\s+', ' ', 'g'),
    '');
$$;
```

`translate()` y no `unaccent`: la única extensión instalada hoy es `uuid-ossp`
(001), y agregar `unaccent` a producción para esto no se paga. Trata `NULL` y `''`
como equivalentes (importante: 20 productos no tienen marca).

Índice de apoyo:
`(store_id, normalize_catalog_text(name), normalize_catalog_text(brand))`.

#### 2.4.2 Las tres opciones que ve quien envía

El brief planteaba dos ("ya existe" / "es nuevo"). Falta una tercera que es
justamente la que evita multiplicar el desorden: **el producto existe en el
destino pero no en esa talla/color**. Crear un producto entero ahí sería fabricar
un duplicado.

| `dest_action` | Cuándo | Qué se hace al recibir |
|---|---|---|
| `map_variant` | La variante exacta ya existe en el destino | Se le suma stock |
| `map_product` | El producto existe, **esa talla/color no** | Se crea la **variante** dentro de ese producto |
| `create_product` | No hay nada parecido | Se crea **producto + variante** |

La UI ordena los candidatos que devuelve `search_transfer_targets`:
1. **Coincidencia exacta** (nombre + marca + talla + color normalizados, única)
   → preseleccionada como `map_variant`.
2. **Mismo producto, otra talla/color** → ofrecida como `map_product`, mostrando
   qué tallas/colores tiene hoy esa ficha.
3. **Nombre parecido** (mismo nombre, otra marca / marca vacía) → se listan, sin
   preseleccionar.
4. **"Es nuevo, créalo allá"** → `create_product`.

Cada candidato se muestra con **marca y descripción**, que es lo que distingue dos
fichas del mismo nombre — con 199 productos para 103 nombres en Tebaida, el nombre
solo no alcanza para elegir con criterio.

#### 2.4.3 Cuándo se crea la variante en el destino: **al RECIBIR** (confirmado)

Tu intuición es correcta, y hay una razón más fuerte que la de los huérfanos:

- **Al armar (draft):** peor opción. Los borradores se abandonan; escribiría en el
  catálogo ajeno por algo que puede no ocurrir nunca.
- **Al despachar:** deja productos con stock 0 en el destino durante días, y una
  **reversión** deja catálogo huérfano — que no se puede ni borrar, porque
  `transfer_items` lo referencia con `ON DELETE RESTRICT`. Sería basura permanente.
- **Al recibir:** ✅ el destino no se ensucia hasta que la mercancía llega de
  verdad. **La decisión de CUÁL se toma al armar** (donde hay tiempo y contexto),
  **la escritura ocurre cuando el hecho físico ocurre**. Es el mismo principio que
  ya rige el stock (§1.3).

**Y hay un motivo que lo vuelve obligatorio, no preferible.** Entre que se arma el
traslado y que llega (días), alguien en el destino puede crear a mano esa misma
ficha. Si `receive_transfer` ejecutara la intención a ciegas:

- con `map_product` → intentaría crear una variante talla/color que ahora ya
  existe → **`variants_combo_unique UNIQUE NULLS NOT DISTINCT (product_id, size,
  color)` la rechaza con un 23505 y la recepción falla en el mostrador**;
- con `create_product` → crearía un duplicado exacto del que acaban de crear.

Por eso **`receive_transfer` re-verifica el match antes de escribir**:

1. Si hay una coincidencia **exacta** que no estaba al armar → la usa en vez de
   crear, y marca `dest_resolution = 'auto_matched'`.
2. Si no → ejecuta lo elegido y marca `dest_resolution = 'as_chosen'`.

El re-chequeo **nunca inventa un mapeo dudoso**: solo actúa ante coincidencia
exacta y única. Y `dest_resolution` deja el rastro de cuándo el sistema corrigió
la elección del que envió — sin eso sería magia silenciosa, que es exactamente lo
que no queremos.

**Variante destino inactiva:** si el destino existe pero está `is_active = false`,
la recepción **la reactiva**. Llegó mercancía física: una variante con stock que
no se puede vender es peor que reactivarla, y crear una gemela sería duplicar.

### 2.5 Las RPC

Todas `SECURITY DEFINER SET search_path = public`, `REVOKE ... FROM public, anon`,
`GRANT EXECUTE TO authenticated`.

| RPC | Valida |
|---|---|
| `create_transfer(p_to_store, p_items jsonb)` | permiso · `to_store` ≠ activa · `is_store_in_my_org(to_store)` · variantes de mi tienda y activas · destinos elegidos pertenecen a `to_store` |
| `dispatch_transfer(p_transfer_id)` | permiso · `from_store = get_my_store_id()` · guard de estado · stock por ítem con `FOR UPDATE` · los destinos mapeados siguen existiendo en `to_store` |
| `receive_transfer(p_transfer_id, p_counts jsonb DEFAULT NULL)` | permiso · **§2.6** · guard de estado · re-verifica y resuelve/crea destino (§2.4.3) |
| `cancel_transfer(p_transfer_id, p_reason)` | permiso · `draft` → cancela · `in_transit` → revierte al origen |
| `search_transfer_targets(p_to_store, p_query)` | permiso · `is_store_in_my_org` · solo lectura, normalizada (§2.4.1) |

**Regla de stock del despacho:** `qty_sent <= stock_qty − reserved_qty`, con
`SELECT ... FOR UPDATE` sobre la variante. Es **la misma regla que la 038** va a
imponer a las ventas: la reserva de un separado es intocable, y un traslado no
puede llevarse mercancía ya apartada para un cliente. Si la 038 se aplica después,
no hay conflicto — el traslado ya nace con la regla final.

**El candado de idempotencia es el estado, no una clave.** A diferencia de
`create_sale`, acá el documento ya existe y tiene estado, así que el guard es el
propio UPDATE:

```sql
UPDATE transfers SET status = 'in_transit', dispatched_at = now(), dispatched_by = v_uid
 WHERE id = p_transfer_id AND status = 'draft';
IF NOT FOUND THEN RAISE EXCEPTION 'El traslado ya fue despachado o no está en borrador'; END IF;
```

Doble clic con mala red → el segundo intento falla con un mensaje claro **en vez de
mover el stock dos veces**. Mismo patrón en recepción y reversión.

### 2.6 Quién puede confirmar la recepción (decidido — ampliado)

**Recibe normalmente el destino. Pero el origen o un admin pueden confirmar por
él**, para el caso "en esa sede no hay nadie con permiso ahora".

Condición dentro de `receive_transfer` (no en el RLS — **el aislamiento no se
toca**; solo cambia quién puede llamar la función):

```sql
-- 1) permiso, siempre
IF NOT has_permission('traslados.gestionar') THEN RAISE EXCEPTION ... END IF;

-- 2) vínculo con el traslado: la tienda activa es una de las dos,
--    o el usuario tiene acceso a la tienda destino (admin multi-tienda)
IF NOT (
     get_my_store_id() IN (v_from_store, v_to_store)
  OR EXISTS (SELECT 1 FROM get_my_stores() WHERE store_id = v_to_store)
) THEN RAISE EXCEPTION 'No podés confirmar este traslado' END IF;

-- 3) cinturón y tirantes: ambas tiendas de mi organización
IF NOT (is_store_in_my_org(v_from_store) AND is_store_in_my_org(v_to_store))
THEN RAISE EXCEPTION ... END IF;
```

Notas:

- Reusa `get_my_stores()` (013) en vez de duplicar la lógica de
  `user_stores ∪ {profiles.store_id}`. Un dueño con Armenia entre sus tiendas
  puede confirmar **sin tener que cambiar de tienda con el switcher** — que es
  justo el caso que motivó la decisión.
- **Nada de esto abre el aislamiento:** no se agrega ni una política sobre
  `variants`, `products` o `stores`. La escritura en el destino sigue ocurriendo
  únicamente dentro del RPC `SECURITY DEFINER`, que reimplementa los chequeos.
- Un usuario sin vínculo con ninguna de las dos tiendas **no puede confirmar**,
  aunque tenga el permiso. El permiso habilita la acción; el vínculo la acota.

**El rastro** (esto es lo que importa si después falta mercancía):

- `received_by` — quién confirmó.
- `received_by_store_id` — **desde qué tienda** lo hizo. Es un dato, no una
  interpretación, y cubre los tres casos sin ambigüedad.
- La UI lo muestra como una etiqueta explícita en el detalle y en el ticket:
  **"Confirmado por el destino"** (`= to_store`) · **"Confirmado por el ORIGEN"**
  (`= from_store`, en ámbar — es la excepción, debe verse) · **"Confirmado por
  administración"** (cualquier otra).

---

## 3. El faltante: qué pasa si llega menos de lo que salió

La pregunta: con recepción simple (sin conteo) + creación de variantes en el
destino, si el traslado crea un producto en Armenia con stock 5 y solo llegaron 4,
queda stock que no existe. ¿Alcanza con ajustar a mano?

**Respuesta corta: sí alcanza, pero con tres decisiones de hoy que hacen que el
ajuste sea rastreable en vez de huérfano. Y una de ellas corrige el diseño previo.**

**1. Esto no es un problema que el módulo inventa.** Es el mismo caso de una
factura de compra donde el proveedor mandó de menos, o de cualquier número de
stock que no coincide con la realidad. La respuesta del sistema para eso es y
sigue siendo el **ajuste manual** (`stock_movements type='adjustment'` + motivo),
que ya existe y ya tiene permiso (`inventario.gestionar`). Lo que el módulo
*agrega* es que ahora **hay un documento al cual apuntar**: hoy la misma
discrepancia serían dos ajustes descoordinados sin ningún rastro.

**2. `qty_received` se queda en NULL en la recepción simple.** *(Corrige el
diseño anterior, que ponía `qty_received := qty_sent`.)* Poner el enviado como
recibido **fabrica un conteo que nadie hizo**: el sistema afirmaría que alguien
verificó 5 unidades. Con `NULL`, el dato dice la verdad — *"llegó, sin contar"* —
y cuando exista la fase de conteo, `qty_received IS NOT NULL` significa
**"esto se contó"** de forma retroactivamente correcta, sin migración de datos ni
reinterpretación del histórico. El movimiento `transfer_in` se hace por
`qty_sent`, que es lo único que se sabe. Cuesta cero hoy y evita un dato falso.

**3. El ajuste posterior debe poder apuntar al traslado.** `stock_movements.
reference_id` es una FK libre — **la capacidad ya existe, no hay schema nuevo**.
Basta con que el ajuste que corrige un faltante se guarde con
`reference_id = transfer_id`. En la práctica: al abrir un traslado recibido, un
botón **"Reportar faltante"** abre el flujo de ajuste ya existente, precargado con
la línea y con la referencia puesta. Eso convierte *"un ajuste huérfano de −1"* en
*"el faltante del traslado #12"*, y es la semilla natural del reporte de la fase de
conteo. (El botón es fase 6; la capacidad es gratis desde hoy.)

**4. Un traslado recibido no se edita.** No hay "corregir cantidades". Las
correcciones de stock van por ajuste — auditable y con permiso. Mismo principio que
`cash_expenses`, inmutable "para trazabilidad" (017/037).

**5. El caso puntual que preguntás — producto NUEVO con stock que no llegó.**
Es el mismo caso, con un matiz: si llegaron **cero** unidades de una ficha recién
creada, tras el ajuste Armenia queda con un producto en 0. Se **desactiva**
(`is_active = false`) desde el `VariantsPanel` que ya existe. **No se borra, y no
hace falta inventar un camino para borrarlo:** `transfer_items` lo referencia con
`ON DELETE RESTRICT` a propósito — el documento tiene que seguir explicando qué
pasó.

**Lo que NO recomiendo:** bloquear la recepción simple hasta que exista el conteo,
ni crear una tabla de "discrepancias pendientes". Las dos adelantan mal la fase
futura. La primitiva honesta es `qty_received IS NULL` = sin contar, más el ajuste
con referencia.

---

## 4. RPC transaccional desde el inicio: **SÍ**, y no es una preferencia de calidad

Cuatro razones, en orden de peso:

1. **Sin RPC es literalmente imposible.** El cliente no puede escribir en la tienda
   destino: el RLS no se lo permite y no hay política que lo habilite sin romper
   el aislamiento de todo el sistema (§1.5). Es un **requisito funcional**, no una
   mejora.
2. **Nace sin la deuda que estamos pagando.** `FOR UPDATE` desde el día 1,
   validación server-side, sin rollback compensatorio en el hook. Es exactamente
   la conclusión del plan de venta atómica, aplicada antes de que exista el
   problema en vez de después.
3. **El precedente de no hacerlo está documentado.** `useCreateOrder`,
   `useReturnMutations` y `adjustStock` son read-modify-write no atómicos desde el
   cliente; el incidente #173 (orden huérfana que infló el cuadre) salió de ahí.
   Agregar un cuarto camino no-atómico es sumar trabajo futuro conocido.
4. **Un traslado a medias es peor que una venta a medias.** Una venta rota deja una
   orden inconsistente; un traslado roto **evapora mercancía**: descontada del
   origen y nunca sumada al destino, sin ningún lugar donde aparezca la diferencia.

---

## 5. El permiso

**Uno solo: `traslados.gestionar`** — "Trasladar mercancía entre tiendas".

- **Uno y no dos** (`despachar` / `recibir`): el volumen es bajo y quien despacha y
  quien recibe son la misma clase de usuario (el encargado de una sucursal). Dos
  permisos duplican la UI de roles sin comprar nada. Si mañana hace falta partirlo,
  es aditivo y sin migración de datos.
- **A quién:** **Dueño** (automático por el comodín `'*'`) y **Administrador**.
  **Vendedor NO por defecto** — mover mercancía entre sucursales es decisión de
  dueño/administrador. Si un dueño quiere que su vendedora de Armenia reciba, le
  arma un rol personalizado: para eso existe el RBAC.
- **La LECTURA no lleva permiso extra.** SELECT libre dentro de la tienda
  (origen o destino), como toda la lectura operativa — así un vendedor **ve** que
  viene un traslado aunque no pueda confirmarlo. Criterio explícito de la 024.

**Cómo se agrega** (procedimiento de CLAUDE.md, sin atajos):
1. Editar el array de `Administrador` en `canonical_role_permissions()` (035).
2. Migración de reconciliación **aditiva, SIN filtro de organización** (molde 034).
3. Actualizar `src/lib/permissionsCatalog.ts` — grupo **Inventario**,
   `ALL_PERMISSIONS` pasa de 20 a 21 (hay un test que verifica la paridad
   catálogo ↔ lista).

---

## 6. Qué NO hacemos ahora, pero dejamos preparado

**El conteo en recepción y los faltantes.** Tres decisiones de hoy son las que
evitan el rediseño de mañana:

1. **`transfer_items.qty_received` nullable y NULL en la recepción simple** (§3, punto 2).
   `NULL` = "recibido sin contar"; cuando llegue el conteo, se llena por línea y el
   faltante es `qty_sent − qty_received`.
2. **`receive_transfer` acepta `p_counts jsonb DEFAULT NULL` desde el día 1.** Con
   `NULL` → recepción simple. Con líneas → conteo. **La firma no cambia**, así que
   la fase futura es UI + una rama adentro del RPC, sin romper ninguna llamada
   existente. Este es el punto que de verdad cumple el "sin rediseñar".
3. **`status` como `text` + `CHECK`** (§2.1): agregar
   `'received_with_differences'` es una línea.

**Lo que queda anotado y sin decidir** (no se diseña el mecanismo, solo el hueco):

- **A dónde se imputa el faltante** (merma del origen, ajuste del destino, o
  reclamo a la encomienda). Hoy: ajuste manual con `reference_id` al traslado (§3).
- **Relajar `variants_barcode_unique` a `(store_id, barcode)`** para que la
  etiqueta viaje con la prenda — **con su propio análisis**, porque toca el POS, el
  escaneo, la búsqueda de devoluciones y la de compras (§1.2).
- Botón "Reportar faltante" en el detalle del traslado recibido (fase 6).
- Reserva de stock en el borrador (§2.2).
- Costo del flete: no se modela.
- Re-mapear el destino durante la recepción (hoy el mapeo se fija al armar, y el
  RPC solo lo corrige ante coincidencia exacta — §2.4.3).

---

## 7. Plan por fases — sin cambios

| Fase | Qué | Riesgo | Toca la app |
|---|---|---|---|
| **0** | Diagnóstico + diseño (este documento) | — | no |
| **1** | **Migración 040:** los dos `ADD VALUE` del enum, sueltos y sin uso | cero | no |
| **2** | **Migración 041:** tablas, índices, `normalize_catalog_text`, RLS (solo SELECT), numeración por org, las 5 RPC | bajo — aditivo, nadie las llama | no |
| **3** | Verificación exhaustiva en el lab (matriz de casos por `psql`) | cero | no |
| **4** | Tipos TS + hooks + `permissionsCatalog` + **042** (reconciliación del permiso) + 035 | bajo | sí |
| **5** | UI: página `/traslados`, armado con sugerencias, despachar, bandeja "Por recibir" + badge | medio | sí |
| **6** | Integración: vista `stock_in_transit`, columna en Inventario, movimientos legibles, etiquetas al recibir, "Reportar faltante" | bajo | sí |
| **7** | *(futura)* Conteo en recepción + faltantes | — | sí |

**Numeración:** el hueco de la **038** está reservado por la fase 0 del plan de
venta atómica (escrita, sin aplicar) → este módulo arranca en **040**.

**Matriz de la fase 3** (el entregable que decide si esto sale a prod):

*Permisos y aislamiento*
- Despachar sin permiso → falla · Despachar un traslado de otra tienda → falla
- Tienda destino de otra organización → falla
- Recibir desde el **destino** → OK · desde el **origen** → OK, con
  `received_by_store_id = from_store`
- Recibir siendo admin **con acceso** al destino sin estar activo en él → OK
- Recibir sin vínculo con ninguna de las dos tiendas, aun con permiso → falla

*Stock*
- Stock insuficiente → aborta con rollback real (nada a medias)
- Stock disponible pero **reservado por un separado** → respeta la reserva
- **Concurrencia:** dos despachos de la última unidad → uno pasa, el otro falla
- **El invariante:** Σ stock antes = Σ stock después + lo que está en tránsito

*Idempotencia y estados*
- **Doble despacho** / **doble recepción** → el segundo falla, el stock se mueve una vez
- Reversión de despacho → el stock vuelve al origen, exacto, sin catálogo huérfano

*Mapeo (§2.4)*
- `map_variant` → suma stock a la variante existente
- `map_product` → crea la variante **dentro** de la ficha elegida
- `create_product` → crea producto + variante con barcode nuevo
- **El caso que rompía:** `map_product` cuya talla/color **fue creada en el destino
  mientras viajaba** → NO falla con 23505; mapea y marca `dest_resolution='auto_matched'`
- `create_product` cuyo gemelo exacto apareció mientras viajaba → mapea, no duplica
- Variante destino **inactiva** → se reactiva y recibe
- Normalización: `DOMINA` ↔ `domina` matchean; marca `NULL` ↔ `''` equivalentes
