// G-Mura · Productos + Variantes — V2: Matrix talla×color + galería visual

function ProductsV2({ accent = '#8b5cf6' }) {
  const [selectedId, setSelectedId] = React.useState(PROD_LIST[0].id);
  const [query, setQuery] = React.useState('');
  const [activeCat, setActiveCat] = React.useState('Todas');
  const [showNewModal, setShowNewModal] = React.useState(false);
  const [editingCell, setEditingCell] = React.useState(null);
  const [productData, setProductData] = React.useState(PROD_LIST);

  const cats = ['Todas', ...new Set(PROD_LIST.map((p) => p.category))];
  const filtered = productData.filter((p) => {
    if (activeCat !== 'Todas' && p.category !== activeCat) return false;
    if (query && !(p.name.toLowerCase().includes(query.toLowerCase()) || p.brand.toLowerCase().includes(query.toLowerCase()))) return false;
    return true;
  });
  const selected = productData.find((p) => p.id === selectedId);

  const updateVariant = (vid, patch) => {
    setProductData((data) => data.map((p) => p.id !== selectedId ? p : ({
      ...p, variants: p.variants.map((v) => v.id === vid ? { ...v, ...patch } : v),
    })));
  };

  return (
    <div style={{ height: '100%', display: 'flex', background: '#f8f7f5', color: '#1a1a1a', fontFamily: 'Geist, system-ui, sans-serif', overflow: 'hidden' }}>
      <GMSidebar active="products" accent={accent} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ height: 64, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fdfcfb', borderBottom: '1px solid #ebe9e6' }}>
          <div>
            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Catálogo</div>
            <div style={{ fontSize: 12, color: '#737373' }}>{productData.length} productos · {productData.reduce((s, p) => s + p.variants.length, 0)} variantes</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={{ height: 38, padding: '0 14px', border: '1px solid #ebe9e6', background: '#fff', borderRadius: 8, fontSize: 13, color: '#404040', cursor: 'pointer', fontFamily: 'inherit' }}>Importar CSV</button>
            <button onClick={() => setShowNewModal(true)} style={{ height: 38, padding: '0 16px', border: 0, background: accent, color: '#fff', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: `0 4px 12px ${accent}40`, fontFamily: 'inherit' }}>
              <Icon.plus width="14" height="14" /> Nuevo producto
            </button>
          </div>
        </header>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* LISTA — galería compacta */}
          <section style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid #ebe9e6', background: '#fdfcfb' }}>
            <div style={{ padding: 16 }}>
              <div style={{ position: 'relative', height: 40, borderRadius: 9, background: '#fff', border: '1px solid #ebe9e6', display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <Icon.search width="15" height="15" style={{ marginLeft: 12, color: '#737373' }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" style={{ flex: 1, border: 0, outline: 0, fontSize: 13, padding: '0 10px', background: 'transparent', fontFamily: 'inherit' }} />
              </div>
              <div style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>
                {cats.map((c) => (
                  <button key={c} onClick={() => setActiveCat(c)} style={{
                    display: 'inline-flex', padding: '4px 10px', marginRight: 4, borderRadius: 999,
                    border: activeCat === c ? '1px solid #1a1a1a' : '1px solid #ebe9e6', cursor: 'pointer',
                    background: activeCat === c ? '#1a1a1a' : '#fff', color: activeCat === c ? '#fff' : '#525252',
                    fontSize: 11.5, fontWeight: 500, fontFamily: 'inherit',
                  }}>{c}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
              {filtered.map((p) => {
                const oosCount = p.variants.filter((v) => v.stock === 0).length;
                const isSel = p.id === selectedId;
                return (
                  <button key={p.id} onClick={() => setSelectedId(p.id)} style={{
                    width: '100%', display: 'flex', gap: 11, padding: '10px',
                    border: isSel ? `1.5px solid ${accent}` : '1.5px solid transparent',
                    background: isSel ? '#fff' : 'transparent',
                    borderRadius: 10, cursor: 'pointer', alignItems: 'center', textAlign: 'left',
                    marginBottom: 4, fontFamily: 'inherit',
                    boxShadow: isSel ? `0 0 0 3px ${accent}1a` : 'none',
                  }}>
                    <div style={{ width: 44, height: 44, borderRadius: 7, background: p.img, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#737373', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span>{p.variants.length} var.</span>
                        {oosCount > 0 && <><span style={{ width: 3, height: 3, borderRadius: 999, background: '#d6d3d1' }} /><span style={{ color: '#dc2626', fontWeight: 500 }}>{oosCount} OOS</span></>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* DETALLE V2 con MATRIX */}
          <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: 24, gap: 20, overflowY: 'auto' }}>
            <ProductHero product={selected} accent={accent} />
            <ProductMatrixSection product={selected} accent={accent} updateVariant={updateVariant} editingCell={editingCell} setEditingCell={setEditingCell} />
            <ProductTableSection product={selected} accent={accent} updateVariant={updateVariant} editingCell={editingCell} setEditingCell={setEditingCell} />
          </section>
        </div>
      </div>

      {showNewModal && <NewProductModal accent={accent} onClose={() => setShowNewModal(false)} />}
    </div>
  );
}

function ProductHero({ product, accent }) {
  if (!product) return null;
  const totalStock = product.variants.reduce((s, v) => s + v.stock, 0);
  const oos = product.variants.filter((v) => v.stock === 0).length;
  const low = product.variants.filter((v) => v.stock > 0 && v.stock <= 2).length;

  return (
    <div style={{ background: '#fff', border: '1px solid #ebe9e6', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: 24, display: 'flex', gap: 22, alignItems: 'flex-start' }}>
        <div style={{ width: 140, height: 140, borderRadius: 12, background: product.img, flexShrink: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', bottom: 8, right: 8, padding: '3px 8px', background: 'rgba(255,255,255,0.92)', borderRadius: 999, fontSize: 11, fontWeight: 600, fontFamily: 'Bricolage Grotesque, serif' }}>{fmtCOP(product.basePrice)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span style={{ padding: '3px 9px', borderRadius: 999, background: '#f5f4f1', fontSize: 11, fontWeight: 500, color: '#525252' }}>{product.category}</span>
            <span style={{ padding: '3px 9px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: '#16a34a' }} /> Activo
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#a8a29e', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 500, marginBottom: 2 }}>{product.brand}</div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', marginBottom: 6 }}>{product.name}</div>
          <div style={{ fontSize: 13.5, color: '#525252', lineHeight: 1.5, maxWidth: 580, marginBottom: 16 }}>{product.description}</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <MiniStat label="Stock total" value={totalStock} />
            <MiniStat label="Variantes" value={product.variants.length} />
            <MiniStat label="Stock bajo" value={low} tone={low > 0 ? '#ea580c' : null} />
            <MiniStat label="Sin stock" value={oos} tone={oos > 0 ? '#dc2626' : null} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button style={{ height: 34, padding: '0 14px', border: '1px solid #ebe9e6', background: '#fff', borderRadius: 7, fontSize: 13, color: '#404040', cursor: 'pointer', fontFamily: 'inherit' }}>Editar</button>
          <button style={{ width: 34, height: 34, border: '1px solid #ebe9e6', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#525252', fontSize: 14 }}>···</button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: '#a8a29e', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: tone || '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function ProductMatrixSection({ product, accent, updateVariant, editingCell, setEditingCell }) {
  if (!product) return null;
  const sizes = [...new Set(product.variants.map((v) => v.size))];
  const colors = [...new Map(product.variants.map((v) => [v.color, v.colorHex])).entries()];
  const find = (size, color) => product.variants.find((v) => v.size === size && v.color === color);

  return (
    <div style={{ background: '#fff', border: '1px solid #ebe9e6', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f5f4f1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>Matriz de inventario</div>
          <div style={{ fontSize: 12, color: '#737373' }}>Click en una celda para editar el stock</div>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#737373' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#dcfce7', border: '1px solid #16a34a' }} /> OK</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#fef3c7', border: '1px solid #d97706' }} /> Bajo</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#fee2e2', border: '1px solid #dc2626' }} /> Cero</span>
        </div>
      </div>
      <div style={{ overflowX: 'auto', padding: '12px 20px 18px' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 4, fontFamily: 'inherit' }}>
          <thead>
            <tr>
              <th style={{ padding: 6 }} />
              {sizes.map((s) => (
                <th key={s} style={{ padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', letterSpacing: '.06em', minWidth: 64 }}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map(([color, hex]) => (
              <tr key={color}>
                <td style={{ padding: '6px 12px 6px 6px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 500 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 999, background: hex, boxShadow: '0 0 0 1px #d6d3d1' }} />
                    {color}
                  </span>
                </td>
                {sizes.map((s) => {
                  const v = find(s, color);
                  if (!v) return (
                    <td key={s} style={{ padding: 0 }}>
                      <button title="Crear variante" style={{ width: '100%', height: 56, border: '1.5px dashed #d6d3d1', background: 'transparent', borderRadius: 8, color: '#a8a29e', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' }}>+</button>
                    </td>
                  );
                  const state = stockState(v.stock);
                  const bg = state === 'out' ? '#fee2e2' : state === 'low' ? '#fef3c7' : '#dcfce7';
                  const fg = state === 'out' ? '#b91c1c' : state === 'low' ? '#92400e' : '#166534';
                  const editing = editingCell === `mx-${v.id}-stock`;
                  return (
                    <td key={s} style={{ padding: 0 }}>
                      <div style={{ background: bg, border: `1px solid ${fg}33`, borderRadius: 8, height: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}
                        onClick={() => !editing && setEditingCell(`mx-${v.id}-stock`)}>
                        {editing ? (
                          <input
                            autoFocus type="number" defaultValue={v.stock}
                            onBlur={(e) => { updateVariant(v.id, { stock: Number(e.target.value) }); setEditingCell(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                            style={{ width: 50, height: 28, textAlign: 'center', fontSize: 14, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', fontWeight: 700, border: `1.5px solid ${accent}`, borderRadius: 6, outline: 0, boxShadow: `0 0 0 2px ${accent}25` }}
                          />
                        ) : (
                          <>
                            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 18, fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{v.stock}</div>
                            <div style={{ fontSize: 9.5, color: fg, opacity: .75, marginTop: 2, fontWeight: 500 }}>{fmtCOP(v.price).replace('$', '$')}</div>
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductTableSection({ product, accent, updateVariant, editingCell, setEditingCell }) {
  if (!product) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #ebe9e6', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f5f4f1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>Detalle de variantes</div>
          <div style={{ fontSize: 12, color: '#737373' }}>{product.variants.length} variantes activas</div>
        </div>
        <button style={{ height: 32, padding: '0 12px', border: '1px solid #ebe9e6', background: '#fff', borderRadius: 7, fontSize: 12.5, color: '#404040', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M7 10v5M10 10v5M13 10v5"/></svg>
          Imprimir todas las etiquetas
        </button>
      </div>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, fontFamily: 'inherit' }}>
          <thead>
            <tr style={{ background: '#fafaf9' }}>
              <Th>Talla</Th><Th>Color</Th><Th>SKU</Th>
              <Th align="right">Precio</Th><Th align="right">Stock</Th>
              <Th>Estado</Th><Th align="right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((v) => {
              const state = stockState(v.stock);
              return (
                <tr key={v.id} style={{ borderBottom: '1px solid #f5f4f1' }}>
                  <Td><span style={{ display: 'inline-flex', minWidth: 32, height: 24, padding: '0 8px', alignItems: 'center', justifyContent: 'center', borderRadius: 5, background: '#f5f4f1', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{v.size}</span></Td>
                  <Td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 14, height: 14, borderRadius: 999, background: v.colorHex, boxShadow: '0 0 0 1px #d6d3d1' }} />{v.color}</span></Td>
                  <Td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525252' }}>{v.sku}</span></Td>
                  <Td align="right">
                    <EditableCell value={v.price} format={fmtCOP}
                      isEditing={editingCell === `tb-${v.id}-price`}
                      onStart={() => setEditingCell(`tb-${v.id}-price`)}
                      onCommit={(val) => { updateVariant(v.id, { price: Number(val) || v.price }); setEditingCell(null); }}
                      accent={accent} />
                  </Td>
                  <Td align="right">
                    <EditableCell value={v.stock}
                      isEditing={editingCell === `tb-${v.id}-stock`}
                      onStart={() => setEditingCell(`tb-${v.id}-stock`)}
                      onCommit={(val) => { updateVariant(v.id, { stock: Number(val) }); setEditingCell(null); }}
                      accent={accent} />
                  </Td>
                  <Td><StockBadge state={state} stock={v.stock} /></Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button title="Generar etiqueta" style={{ height: 28, padding: '0 10px', border: '1px solid #ebe9e6', background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#525252', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M7 10v5M10 10v5M13 10v5"/></svg>
                        Etiqueta
                      </button>
                      <button title="Más" style={{ width: 28, height: 28, border: '1px solid #ebe9e6', background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#525252', fontSize: 13 }}>···</button>
                    </div>
                  </Td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={7} style={{ padding: '12px 20px' }}>
                <button style={{ width: '100%', height: 38, border: '1.5px dashed #d6d3d1', background: 'transparent', borderRadius: 8, fontSize: 13, fontWeight: 500, color: accent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: 'inherit' }}>
                  <Icon.plus width="14" height="14" /> Nueva variante
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { ProductsV2 });
