// Shared sidebar (full width) + chrome para pantallas internas

function GMSidebar({ active = 'products', accent = '#8b5cf6', cartCount = 0 }) {
  const navItems = [
    { id: 'pos', icon: 'cart', label: 'Ventas', badge: cartCount || null },
    { id: 'products', icon: 'tag', label: 'Productos' },
    { id: 'inventory', icon: 'box', label: 'Inventario' },
    { id: 'returns', icon: 'refresh', label: 'Devoluciones' },
    { id: 'customers', icon: 'users', label: 'Clientes' },
    { id: 'reports', icon: 'chart', label: 'Reportes' },
  ];
  return (
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
          const isActive = n.id === active;
          return (
            <button key={n.id} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '10px',
              borderRadius: 8, border: 0, cursor: 'pointer', fontFamily: 'inherit',
              background: isActive ? accent : 'transparent',
              color: isActive ? '#fff' : '#cbd5e1', fontSize: 13.5, fontWeight: 500,
              textAlign: 'left',
            }}>
              <I width="17" height="17" style={{ opacity: isActive ? 1 : .8, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge && (
                <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: isActive ? 'rgba(255,255,255,0.25)' : accent, color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>{n.badge}</span>
              )}
            </button>
          );
        })}
      </nav>
      <div style={{ borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 14, marginTop: 14 }}>
        <button style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 8, border: 0, background: 'transparent', color: '#cbd5e1', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
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
  );
}

Object.assign(window, { GMSidebar });
