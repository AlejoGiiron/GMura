// POSPage V1 — Layout clásico compacto
// Sidebar de íconos solamente, cards densas, más productos visibles, carrito ajustado.

function POSPageV1({ accent = '#8b5cf6', density = 'compact' }) {
  const cart = useCart();
  const now = useNow();
  const [activeCat, setActiveCat] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [openProduct, setOpenProduct] = React.useState(null); // product id
  const [popoverState, setPopoverState] = React.useState({ size: null, colorIdx: 0 });
  const [confirmingPay, setConfirmingPay] = React.useState(false);

  const filtered = PRODUCTS.filter((p) => {
    if (activeCat !== 'all' && p.category !== activeCat) return false;
    if (query && !(p.name.toLowerCase().includes(query.toLowerCase()) || p.brand.toLowerCase().includes(query.toLowerCase()))) return false;
    return true;
  });

  const navItems = [
    { id: 'pos', icon: 'cart', label: 'Ventas', active: true },
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
    <div className="gm-root" style={{ '--accent': accent, fontFamily: 'Geist, system-ui, sans-serif', height: '100%', display: 'flex', background: '#fafaf9', color: '#1a1a1a', overflow: 'hidden' }}>
      {/* SIDEBAR — iconos */}
      <aside style={{ width: 64, background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: accent, display: 'grid', placeItems: 'center', fontFamily: 'Bricolage Grotesque, serif', fontWeight: 700, fontSize: 18, color: '#fff', marginBottom: 24 }}>G</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {navItems.map((n) => {
            const I = Icon[n.icon];
            return (
              <button key={n.id} title={n.label} style={{
                width: 40, height: 40, borderRadius: 8, border: 0, cursor: 'pointer',
                background: n.active ? accent : 'transparent',
                color: n.active ? '#fff' : '#94a3b8',
                display: 'grid', placeItems: 'center', position: 'relative',
              }}>
                <I width="19" height="19" />
              </button>
            );
          })}
        </nav>
        <button title="Configuración" style={{ width: 40, height: 40, borderRadius: 8, border: 0, background: 'transparent', color: '#94a3b8', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <Icon.settings width="19" height="19" />
        </button>
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* TOP BAR */}
        <header style={{ height: 56, borderBottom: '1px solid #e7e5e4', background: '#fff', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, flexShrink: 0 }}>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>
            G-Mura<span style={{ color: accent }}>.</span>
          </div>
          <span style={{ width: 1, height: 22, background: '#e7e5e4' }} />
          <div style={{ fontSize: 13, color: '#525252' }}>Tienda Bogotá · Centro</div>

          <div style={{ flex: 1 }} />

          {/* Turno activo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px 5px 8px', borderRadius: 999, background: '#f5f3ff', border: `1px solid ${accent}26` }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: accent, boxShadow: `0 0 0 3px ${accent}33` }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: '#4c1d95' }}>Turno activo · 4h 12m</span>
          </div>

          {/* Hora */}
          <div style={{ fontSize: 13, color: '#525252', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon.clock width="14" height="14" /> {fmtTime(now)}
          </div>

          {/* Vendedor */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 999, background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: '#fff', fontSize: 11, fontWeight: 600, display: 'grid', placeItems: 'center' }}>VM</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Valeria M.</div>
          </div>
        </header>

        {/* BODY: 60/40 split */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* LEFT — Productos */}
          <section style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid #e7e5e4' }}>
            {/* Search */}
            <div style={{ padding: '16px 20px 0' }}>
              <div style={{ position: 'relative', height: 48, borderRadius: 10, background: '#fff', border: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', boxShadow: '0 1px 0 rgba(0,0,0,0.02)' }}>
                <Icon.scan width="20" height="20" style={{ marginLeft: 14, color: '#737373', flexShrink: 0 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Escanear código o buscar producto, marca, SKU…"
                  style={{ flex: 1, border: 0, outline: 0, fontSize: 15, padding: '0 12px', background: 'transparent', fontFamily: 'inherit' }}
                />
                <kbd style={{ marginRight: 12, padding: '3px 8px', borderRadius: 5, background: '#f5f5f4', border: '1px solid #e7e5e4', fontSize: 11, color: '#525252', fontFamily: 'inherit' }}>⌘K</kbd>
              </div>
            </div>

            {/* Categorías */}
            <div style={{ padding: '14px 20px 12px', overflowX: 'auto', whiteSpace: 'nowrap', borderBottom: '1px solid #f0efee' }}>
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setActiveCat(c.id)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 13px', marginRight: 6, borderRadius: 8,
                  border: 0, cursor: 'pointer',
                  background: activeCat === c.id ? '#1a1a1a' : 'transparent',
                  color: activeCat === c.id ? '#fff' : '#525252',
                  fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                  transition: 'background .12s',
                }}>
                  {c.name}
                  <span style={{ fontSize: 11, opacity: .55, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                </button>
              ))}
            </div>

            {/* Grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {filtered.map((p) => (
                  <ProductCardV1
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

          {/* RIGHT — Carrito */}
          <section style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', background: '#fff', minWidth: 0 }}>
            <CartPanelV1 cart={cart} accent={accent} onCheckout={() => setConfirmingPay(true)} />
          </section>
        </div>
      </div>

      {confirmingPay && <PaymentModal cart={cart} accent={accent} onClose={() => setConfirmingPay(false)} onDone={() => { cart.clear(); setConfirmingPay(false); }} />}
    </div>
  );
}

function ProductCardV1({ product, accent, open, popoverState, setPopoverState, onClick, onConfirm, onClose }) {
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
        width: '100%', textAlign: 'left', background: '#fff', border: open ? `1.5px solid ${accent}` : '1px solid #e7e5e4',
        borderRadius: 10, padding: 0, cursor: 'pointer', overflow: 'hidden', display: 'block',
        transition: 'border-color .12s, box-shadow .12s',
        boxShadow: open ? `0 0 0 3px ${accent}1a` : 'none',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => { if (!open) e.currentTarget.style.borderColor = '#a8a29e'; }}
      onMouseLeave={(e) => { if (!open) e.currentTarget.style.borderColor = '#e7e5e4'; }}>
        {/* Image (square) */}
        <div style={{ aspectRatio: '1/1', background: product.img, position: 'relative' }}>
          {/* color dots overlay */}
          <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 4 }}>
            {product.colors.slice(0, 3).map((c, i) => (
              <span key={i} style={{ width: 12, height: 12, borderRadius: 999, background: c, boxShadow: '0 0 0 1.5px #fff' }} />
            ))}
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{ fontSize: 11, color: '#737373', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{product.brand}</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a', marginBottom: 6, lineHeight: 1.25 }}>{product.name}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{fmtCOP(product.price)}</div>
          </div>
          {/* Talla chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {sizes.map((s) => {
              const oos = product.sizes[s] === 0;
              return (
                <span key={s} style={{
                  fontSize: 11, padding: '3px 7px', borderRadius: 5,
                  background: oos ? 'transparent' : '#f5f5f4',
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
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
          background: '#fff', border: '1px solid #e7e5e4', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
          padding: 14, zIndex: 10,
        }}>
          {/* Tallas */}
          <div style={{ fontSize: 11, color: '#737373', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Talla</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
            {sizes.map((s) => {
              const oos = product.sizes[s] === 0;
              const sel = popoverState.size === s;
              return (
                <button key={s} disabled={oos}
                  onClick={() => setPopoverState((st) => ({ ...st, size: s }))}
                  style={{
                    minWidth: 32, height: 30, padding: '0 8px',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    borderRadius: 6, cursor: oos ? 'not-allowed' : 'pointer',
                    background: sel ? '#1a1a1a' : '#fff',
                    color: oos ? '#a8a29e' : (sel ? '#fff' : '#1a1a1a'),
                    border: sel ? '1px solid #1a1a1a' : '1px solid #e7e5e4',
                    textDecoration: oos ? 'line-through' : 'none',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{s}</button>
              );
            })}
          </div>
          {/* Colores */}
          <div style={{ fontSize: 11, color: '#737373', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Color</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {product.colors.map((c, i) => {
              const sel = popoverState.colorIdx === i;
              return (
                <button key={i}
                  onClick={() => setPopoverState((st) => ({ ...st, colorIdx: i }))}
                  style={{
                    width: 26, height: 26, borderRadius: 999, padding: 0,
                    background: c, cursor: 'pointer',
                    border: sel ? `2px solid ${accent}` : '2px solid #fff',
                    boxShadow: sel ? `0 0 0 1.5px ${accent}` : '0 0 0 1px #d6d3d1',
                  }} />
              );
            })}
          </div>
          {/* Stock + add */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 12, color: stockNow > 2 ? '#16a34a' : (stockNow > 0 ? '#ea580c' : '#dc2626'), fontWeight: 500 }}>
              {stockNow > 0 ? `${stockNow} disponible${stockNow !== 1 ? 's' : ''}` : 'Sin stock'}
            </div>
            <button disabled={stockNow === 0} onClick={onConfirm} style={{
              flex: 1, maxWidth: 140, height: 34, border: 0, borderRadius: 7,
              background: stockNow === 0 ? '#d6d3d1' : accent,
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: stockNow === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Icon.plus width="14" height="14" /> Agregar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartPanelV1({ cart, accent, onCheckout }) {
  return (
    <>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #f0efee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>Venta #4291</div>
          <div style={{ fontSize: 12, color: '#737373' }}>{cart.items.length} {cart.items.length === 1 ? 'artículo' : 'artículos'} · iniciada {fmtTime(new Date())}</div>
        </div>
        {cart.items.length > 0 && (
          <button onClick={cart.clear} style={{ padding: '6px 10px', fontSize: 12, border: '1px solid #e7e5e4', background: '#fff', borderRadius: 6, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>Vaciar</button>
        )}
      </div>

      {/* Customer field */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0efee', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon.user width="16" height="16" style={{ color: '#737373', flexShrink: 0 }} />
        <input value={cart.customer} onChange={(e) => cart.setCustomer(e.target.value)} placeholder="Buscar cliente o teléfono…" style={{ flex: 1, border: 0, outline: 0, fontSize: 13, fontFamily: 'inherit', background: 'transparent' }} />
        <button style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #e7e5e4', background: '#fff', borderRadius: 6, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>+ Nuevo</button>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {cart.items.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#a8a29e', padding: 20, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: '#f5f5f4', display: 'grid', placeItems: 'center' }}>
              <Icon.cart width="22" height="22" style={{ color: '#a8a29e' }} />
            </div>
            <div style={{ fontSize: 13 }}>Sin artículos. Escanea o selecciona desde el grid.</div>
          </div>
        ) : (
          cart.items.map((it) => (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid #f5f5f4' }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, background: it.color, boxShadow: '0 0 0 1px #d6d3d1', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                <div style={{ fontSize: 11, color: '#737373' }}>Talla {it.size} · {fmtCOP(it.price)} c/u</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e7e5e4', borderRadius: 6 }}>
                <button onClick={() => cart.setQty(it.key, it.qty - 1)} style={{ width: 22, height: 22, border: 0, background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon.minus width="11" height="11" /></button>
                <span style={{ minWidth: 16, textAlign: 'center', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{it.qty}</span>
                <button onClick={() => cart.setQty(it.key, it.qty + 1)} style={{ width: 22, height: 22, border: 0, background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon.plus width="11" height="11" /></button>
              </div>
              <div style={{ minWidth: 76, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'Bricolage Grotesque, serif' }}>{fmtCOP(it.price * it.qty)}</div>
              <button onClick={() => cart.remove(it.key)} style={{ width: 22, height: 22, border: 0, background: 'transparent', cursor: 'pointer', color: '#a8a29e', display: 'grid', placeItems: 'center' }}><Icon.x width="13" height="13" /></button>
            </div>
          ))
        )}
      </div>

      {/* Totals */}
      <div style={{ borderTop: '1px solid #e7e5e4', padding: '14px 20px 16px', background: '#fafaf9' }}>
        {/* Discount */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#737373', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon.tag width="13" height="13" /> Descuento
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e7e5e4', borderRadius: 6, background: '#fff', padding: '0 8px' }}>
            <input value={cart.discount} onChange={(e) => cart.setDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} type="number" style={{ width: 36, border: 0, outline: 0, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '4px 0' }} />
            <span style={{ fontSize: 12, color: '#737373' }}>%</span>
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: '#525252' }}>
          <Row label="Subtotal" value={fmtCOP(cart.subtotal)} />
          {cart.discount > 0 && <Row label={`Descuento (${cart.discount}%)`} value={'−' + fmtCOP(cart.discountAmt)} accent />}
          <Row label="IVA 19%" value={fmtCOP(cart.tax)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0 14px', borderTop: '1px dashed #e7e5e4', marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Total</div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 28, fontWeight: 700, letterSpacing: '-0.025em', color: '#1a1a1a' }}>{fmtCOP(cart.total)}</div>
        </div>

        <button disabled={cart.items.length === 0} onClick={onCheckout} style={{
          width: '100%', height: 50, border: 0, borderRadius: 10,
          background: cart.items.length === 0 ? '#d6d3d1' : accent,
          color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
          cursor: cart.items.length === 0 ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: cart.items.length === 0 ? 'none' : `0 4px 12px ${accent}40`,
        }}>
          Cobrar · {fmtCOP(cart.total)}
        </button>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button style={{ flex: 1, height: 34, border: '1px solid #e7e5e4', borderRadius: 7, background: '#fff', fontSize: 12, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>Apartar</button>
          <button style={{ flex: 1, height: 34, border: '1px solid #e7e5e4', borderRadius: 7, background: '#fff', fontSize: 12, color: '#525252', cursor: 'pointer', fontFamily: 'inherit' }}>Cotización</button>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontVariantNumeric: 'tabular-nums' }}>
      <span>{label}</span>
      <span style={{ color: accent ? '#16a34a' : 'inherit', fontWeight: accent ? 600 : 500 }}>{value}</span>
    </div>
  );
}

function PaymentModal({ cart, accent, onClose, onDone }) {
  const [method, setMethod] = React.useState('card');
  const [paid, setPaid] = React.useState(false);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, background: '#fff', borderRadius: 14, padding: 24, fontFamily: 'inherit', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {!paid ? (
          <>
            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>Procesar cobro</div>
            <div style={{ fontSize: 13, color: '#737373', marginBottom: 18 }}>{cart.items.reduce((s, i) => s + i.qty, 0)} artículos · {cart.customer || 'Sin cliente'}</div>
            <div style={{ background: '#fafaf9', borderRadius: 10, padding: 16, marginBottom: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#737373', marginBottom: 4 }}>Total a cobrar</div>
              <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em' }}>{fmtCOP(cart.total)}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#525252', marginBottom: 8 }}>Método de pago</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 18 }}>
              {[{ id: 'cash', label: 'Efectivo' }, { id: 'card', label: 'Tarjeta' }, { id: 'transfer', label: 'Transferencia' }].map((m) => (
                <button key={m.id} onClick={() => setMethod(m.id)} style={{
                  height: 56, border: method === m.id ? `1.5px solid ${accent}` : '1px solid #e7e5e4',
                  background: method === m.id ? `${accent}0d` : '#fff',
                  color: '#1a1a1a', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', borderRadius: 8, cursor: 'pointer',
                }}>{m.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ flex: 1, height: 44, border: '1px solid #e7e5e4', background: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => setPaid(true)} style={{ flex: 2, height: 44, border: 0, background: accent, color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Confirmar pago</button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
            <div style={{ width: 64, height: 64, borderRadius: 999, background: '#dcfce7', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
              <Icon.check width="30" height="30" style={{ color: '#16a34a' }} />
            </div>
            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Pago confirmado</div>
            <div style={{ fontSize: 13, color: '#737373', marginBottom: 18 }}>Recibo enviado por correo</div>
            <button onClick={onDone} style={{ width: '100%', height: 44, border: 0, background: '#1a1a1a', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Nueva venta</button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { POSPageV1 });
