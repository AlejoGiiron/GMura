// POSPage V2 — Layout con más aire
// Sidebar completo con labels, cards más grandes, tipografía más generosa, carrito más respirado.

function POSPageV2({ accent = '#8b5cf6', density = 'comfy' }) {
  const cart = useCart();
  const now = useNow();
  const [activeCat, setActiveCat] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [openProduct, setOpenProduct] = React.useState(null);
  const [popoverState, setPopoverState] = React.useState({ size: null, colorIdx: 0 });
  const [confirmingPay, setConfirmingPay] = React.useState(false);

  const filtered = PRODUCTS.filter((p) => {
    if (activeCat !== 'all' && p.category !== activeCat) return false;
    if (query && !(p.name.toLowerCase().includes(query.toLowerCase()) || p.brand.toLowerCase().includes(query.toLowerCase()))) return false;
    return true;
  });

  const navItems = [
    { id: 'pos', icon: 'cart', label: 'Ventas', active: true, badge: cart.items.length || null },
    { id: 'products', icon: 'tag', label: 'Productos' },
    { id: 'inventory', icon: 'box', label: 'Inventario' },
    { id: 'returns', icon: 'refresh', label: 'Devoluciones' },
    { id: 'customers', icon: 'users', label: 'Clientes' },
    { id: 'reports', icon: 'chart', label: 'Reportes' },
  ];

  const openVariantPopover = (product) => {
    if (openProduct === product.id) { setOpenProduct(null); return; }
    const firstAvail = orderedSizes(product.sizes).find((s) => product.sizes[s] > 0) || orderedSizes(product.sizes)[0];
    setPopoverState({ size: firstAvail, colorIdx: 0 });
    setOpenProduct(product.id);
  };
  const confirmAdd = (product) => {
    cart.add(product, popoverState.size, popoverState.colorIdx);
    setOpenProduct(null);
  };

  return (
    <div style={{ '--accent': accent, fontFamily: 'Geist, system-ui, sans-serif', height: '100%', display: 'flex', background: '#f8f7f5', color: '#1a1a1a', overflow: 'hidden' }}>
      {/* SIDEBAR — full con labels */}
      <aside style={{ width: 220, background: '#0f172a', display: 'flex', flexDirection: 'column', padding: '22px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 22px' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: accent, display: 'grid', placeItems: 'center', fontFamily: 'Bricolage Grotesque, serif', fontWeight: 700, fontSize: 15, color: '#fff' }}>G</div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: '#fff' }}>
            G-Mura<span style={{ color: accent }}>.</span>
          </div>
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 8px 8px' }}>Operación</div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {navItems.map((n) => {
            const I = Icon[n.icon];
            return (
              <button key={n.id} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '10px 10px',
                borderRadius: 8, border: 0, cursor: 'pointer', fontFamily: 'inherit',
                background: n.active ? accent : 'transparent',
                color: n.active ? '#fff' : '#cbd5e1', fontSize: 13.5, fontWeight: 500,
                textAlign: 'left', position: 'relative',
              }}>
                <I width="17" height="17" style={{ opacity: n.active ? 1 : .8, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.badge && (
                  <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: n.active ? 'rgba(255,255,255,0.25)' : accent, color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>{n.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Vendedor block */}
        <div style={{ borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 14, marginTop: 14 }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 8, border: 0, background: 'transparent', color: '#cbd5e1', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
            <Icon.settings width="17" height="17" style={{ opacity: .8 }} />
            <span style={{ fontSize: 13.5 }}>Configuración</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px 4px' }}>
            <div style={{ width: 32, height: 32, borderRadius: 999, background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: '#fff', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center', flexShrink: 0 }}>VM</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Valeria M.</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Vendedora · Bogotá</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* TOP BAR */}
        <header style={{ height: 64, borderBottom: '1px solid #ebe9e6', background: '#fdfcfb', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 18, flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>Punto de venta</div>
            <div style={{ fontSize: 12, color: '#737373' }}>Tienda Bogotá · Centro</div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px 7px 10px', borderRadius: 999, background: '#fff', border: '1px solid #ebe9e6' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: accent, boxShadow: `0 0 0 4px ${accent}25` }} />
            <span style={{ fontSize: 12.5, color: '#525252' }}>Turno <b style={{ color: '#1a1a1a' }}>activo</b> · 4h 12m</span>
          </div>

          <div style={{ fontSize: 13, color: '#525252', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Icon.clock width="14" height="14" /> {fmtTime(now)}
          </div>

          <button style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid #ebe9e6', background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', position: 'relative' }}>
            <Icon.bell width="16" height="16" style={{ color: '#525252' }} />
            <span style={{ position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: accent, boxShadow: '0 0 0 2px #fff' }} />
          </button>
        </header>

        {/* BODY */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, padding: 16, gap: 16 }}>
          {/* LEFT — Productos card */}
          <section style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff', border: '1px solid #ebe9e6', borderRadius: 14, overflow: 'hidden' }}>
            {/* Search */}
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ position: 'relative', height: 56, borderRadius: 12, background: '#f8f7f5', border: '1px solid #ebe9e6', display: 'flex', alignItems: 'center', transition: 'border-color .12s' }}>
                <Icon.scan width="22" height="22" style={{ marginLeft: 18, color: '#737373', flexShrink: 0 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Escanear código o buscar producto, marca, SKU…"
                  style={{ flex: 1, border: 0, outline: 0, fontSize: 16, padding: '0 14px', background: 'transparent', fontFamily: 'inherit' }}
                />
                <kbd style={{ marginRight: 16, padding: '4px 10px', borderRadius: 6, background: '#fff', border: '1px solid #ebe9e6', fontSize: 11, color: '#525252', fontFamily: 'inherit' }}>⌘K</kbd>
              </div>
            </div>

            {/* Categorías */}
            <div style={{ padding: '18px 24px 18px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setActiveCat(c.id)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '9px 16px', marginRight: 6, borderRadius: 999,
                  border: activeCat === c.id ? '1px solid #1a1a1a' : '1px solid #ebe9e6',
                  cursor: 'pointer',
                  background: activeCat === c.id ? '#1a1a1a' : '#fff',
                  color: activeCat === c.id ? '#fff' : '#404040',
                  fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit',
                }}>
                  {c.name}
                  <span style={{ fontSize: 11.5, opacity: .6, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                </button>
              ))}
            </div>

            {/* Grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
                {filtered.map((p) => (
                  <ProductCardV2
                    key={p.id}
                    product={p}
                    accent={accent}
                    open={openProduct === p.id}
                    popoverState={popoverState}
                    setPopoverState={setPopoverState}
                    onClick={() => openVariantPopover(p)}
                    onConfirm={() => confirmAdd(p)}
                    onClose={() => setOpenProduct(null)}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* RIGHT — Carrito card */}
          <section style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #ebe9e6', borderRadius: 14, overflow: 'hidden', minWidth: 0 }}>
            <CartPanelV2 cart={cart} accent={accent} onCheckout={() => setConfirmingPay(true)} />
          </section>
        </div>
      </div>

      {confirmingPay && <PaymentModal cart={cart} accent={accent} onClose={() => setConfirmingPay(false)} onDone={() => { cart.clear(); setConfirmingPay(false); }} />}
    </div>
  );
}

function ProductCardV2({ product, accent, open, popoverState, setPopoverState, onClick, onConfirm, onClose }) {
  const sizes = orderedSizes(product.sizes);
  const stockNow = product.sizes[popoverState.size] || 0;
  const popoverRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={onClick} style={{
        width: '100%', textAlign: 'left', background: '#fff', border: open ? `1.5px solid ${accent}` : '1px solid #ebe9e6',
        borderRadius: 12, padding: 0, cursor: 'pointer', overflow: 'hidden', display: 'block',
        transition: 'border-color .15s, box-shadow .15s, transform .15s',
        boxShadow: open ? `0 0 0 4px ${accent}1a` : 'none',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => { if (!open) { e.currentTarget.style.borderColor = '#a8a29e'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={(e) => { if (!open) { e.currentTarget.style.borderColor = '#ebe9e6'; e.currentTarget.style.transform = 'none'; } }}>
        {/* Image */}
        <div style={{ aspectRatio: '1/1', background: product.img, position: 'relative' }}>
          <div style={{ position: 'absolute', bottom: 10, right: 10, display: 'flex', gap: 5 }}>
            {product.colors.slice(0, 4).map((c, i) => (
              <span key={i} style={{ width: 14, height: 14, borderRadius: 999, background: c, boxShadow: '0 0 0 2px #fff' }} />
            ))}
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: '14px 16px 16px' }}>
          <div style={{ fontSize: 11, color: '#a8a29e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4, fontWeight: 500 }}>{product.brand}</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', marginBottom: 10, lineHeight: 1.3 }}>{product.name}</div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 12 }}>{fmtCOP(product.price)}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {sizes.map((s) => {
              const oos = product.sizes[s] === 0;
              return (
                <span key={s} style={{
                  fontSize: 11.5, padding: '4px 9px', borderRadius: 6,
                  background: oos ? 'transparent' : '#f5f4f1',
                  color: oos ? '#a8a29e' : '#404040',
                  textDecoration: oos ? 'line-through' : 'none',
                  fontWeight: 500, fontVariantNumeric: 'tabular-nums',
                  border: oos ? '1px dashed #d6d3d1' : '1px solid transparent',
                }}>{s}</span>
              );
            })}
          </div>
        </div>
      </button>

      {open && (
        <div ref={popoverRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8,
          background: '#fff', border: '1px solid #ebe9e6', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06)',
          padding: 18, zIndex: 10,
        }}>
          <div style={{ fontSize: 11, color: '#737373', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Talla</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {sizes.map((s) => {
              const oos = product.sizes[s] === 0;
              const sel = popoverState.size === s;
              return (
                <button key={s} disabled={oos}
                  onClick={() => setPopoverState((st) => ({ ...st, size: s }))}
                  style={{
                    minWidth: 38, height: 36, padding: '0 10px',
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    borderRadius: 7, cursor: oos ? 'not-allowed' : 'pointer',
                    background: sel ? '#1a1a1a' : '#fff',
                    color: oos ? '#a8a29e' : (sel ? '#fff' : '#1a1a1a'),
                    border: sel ? '1px solid #1a1a1a' : '1px solid #ebe9e6',
                    textDecoration: oos ? 'line-through' : 'none',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{s}</button>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: '#737373', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Color</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {product.colors.map((c, i) => {
              const sel = popoverState.colorIdx === i;
              return (
                <button key={i}
                  onClick={() => setPopoverState((st) => ({ ...st, colorIdx: i }))}
                  style={{
                    width: 30, height: 30, borderRadius: 999, padding: 0,
                    background: c, cursor: 'pointer',
                    border: sel ? `2px solid ${accent}` : '2px solid #fff',
                    boxShadow: sel ? `0 0 0 2px ${accent}` : '0 0 0 1px #d6d3d1',
                  }} />
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0 0', borderTop: '1px solid #f5f4f1' }}>
            <div style={{ fontSize: 12.5, color: stockNow > 2 ? '#16a34a' : (stockNow > 0 ? '#ea580c' : '#dc2626'), fontWeight: 500 }}>
              {stockNow > 0 ? `${stockNow} disponible${stockNow !== 1 ? 's' : ''}` : 'Sin stock'}
            </div>
            <button disabled={stockNow === 0} onClick={onConfirm} style={{
              flex: 1, maxWidth: 180, height: 40, border: 0, borderRadius: 8,
              background: stockNow === 0 ? '#d6d3d1' : accent,
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: stockNow === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <Icon.plus width="15" height="15" /> Agregar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartPanelV2({ cart, accent, onCheckout }) {
  return (
    <>
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f5f4f1' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em' }}>Venta #4291</div>
          {cart.items.length > 0 && (
            <button onClick={cart.clear} style={{ padding: '6px 12px', fontSize: 12, border: '1px solid #ebe9e6', background: '#fff', borderRadius: 7, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>Vaciar</button>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: '#737373' }}>{cart.items.length} {cart.items.length === 1 ? 'artículo' : 'artículos'} · iniciada {fmtTime(new Date())}</div>
      </div>

      {/* Customer */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid #f5f4f1' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>Cliente</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', border: '1px solid #ebe9e6', borderRadius: 9, background: '#fafaf9' }}>
          <Icon.user width="16" height="16" style={{ color: '#737373', flexShrink: 0 }} />
          <input value={cart.customer} onChange={(e) => cart.setCustomer(e.target.value)} placeholder="Buscar cliente o teléfono…" style={{ flex: 1, border: 0, outline: 0, fontSize: 13.5, fontFamily: 'inherit', background: 'transparent' }} />
          <button style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #ebe9e6', background: '#fff', borderRadius: 6, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>+ Nuevo</button>
        </div>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {cart.items.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: '#a8a29e', padding: 24, textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: 999, background: '#f5f4f1', display: 'grid', placeItems: 'center' }}>
              <Icon.cart width="28" height="28" style={{ color: '#a8a29e' }} />
            </div>
            <div>
              <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 16, fontWeight: 600, color: '#525252', marginBottom: 4 }}>Carrito vacío</div>
              <div style={{ fontSize: 13, maxWidth: 220, lineHeight: 1.4 }}>Escanea o haz clic en un producto para empezar.</div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {cart.items.map((it) => (
              <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px' }}>
                <span style={{ width: 16, height: 16, borderRadius: 999, background: it.color, boxShadow: '0 0 0 1.5px #d6d3d1', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                  <div style={{ fontSize: 12, color: '#737373' }}>Talla {it.size} · {fmtCOP(it.price)} c/u</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid #ebe9e6', borderRadius: 7, height: 28 }}>
                  <button onClick={() => cart.setQty(it.key, it.qty - 1)} style={{ width: 26, height: '100%', border: 0, background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#525252' }}><Icon.minus width="12" height="12" /></button>
                  <span style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{it.qty}</span>
                  <button onClick={() => cart.setQty(it.key, it.qty + 1)} style={{ width: 26, height: '100%', border: 0, background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#525252' }}><Icon.plus width="12" height="12" /></button>
                </div>
                <div style={{ minWidth: 84, textAlign: 'right', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'Bricolage Grotesque, serif' }}>{fmtCOP(it.price * it.qty)}</div>
                <button onClick={() => cart.remove(it.key)} style={{ width: 24, height: 24, border: 0, background: 'transparent', cursor: 'pointer', color: '#a8a29e', display: 'grid', placeItems: 'center' }}><Icon.x width="14" height="14" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      <div style={{ borderTop: '1px solid #ebe9e6', padding: '18px 24px 22px', background: '#fafaf9' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#525252', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Icon.tag width="14" height="14" /> Descuento
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #ebe9e6', borderRadius: 7, background: '#fff', padding: '0 10px', height: 30 }}>
            <input value={cart.discount} onChange={(e) => cart.setDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} type="number" style={{ width: 38, border: 0, outline: 0, fontSize: 13, fontFamily: 'inherit', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
            <span style={{ fontSize: 12, color: '#737373' }}>%</span>
          </div>
        </div>

        <div style={{ fontSize: 13, color: '#525252' }}>
          <Row2 label="Subtotal" value={fmtCOP(cart.subtotal)} />
          {cart.discount > 0 && <Row2 label={`Descuento (${cart.discount}%)`} value={'−' + fmtCOP(cart.discountAmt)} highlight />}
          <Row2 label="IVA 19%" value={fmtCOP(cart.tax)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0 18px', borderTop: '1px dashed #ebe9e6', marginTop: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Total</div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', color: '#1a1a1a' }}>{fmtCOP(cart.total)}</div>
        </div>

        <button disabled={cart.items.length === 0} onClick={onCheckout} style={{
          width: '100%', height: 56, border: 0, borderRadius: 11,
          background: cart.items.length === 0 ? '#d6d3d1' : accent,
          color: '#fff', fontSize: 16, fontWeight: 600, fontFamily: 'inherit',
          cursor: cart.items.length === 0 ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: cart.items.length === 0 ? 'none' : `0 6px 18px ${accent}45`,
          letterSpacing: '-0.005em',
        }}>
          Cobrar · {fmtCOP(cart.total)}
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button style={{ flex: 1, height: 38, border: '1px solid #ebe9e6', borderRadius: 8, background: '#fff', fontSize: 13, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>Apartar</button>
          <button style={{ flex: 1, height: 38, border: '1px solid #ebe9e6', borderRadius: 8, background: '#fff', fontSize: 13, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>Cotización</button>
        </div>
      </div>
    </>
  );
}

function Row2({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
      <span>{label}</span>
      <span style={{ color: highlight ? '#16a34a' : 'inherit', fontWeight: highlight ? 600 : 500 }}>{value}</span>
    </div>
  );
}

Object.assign(window, { POSPageV2 });
