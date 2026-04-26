// G-Mura Login — 2 variaciones
// V1: clásico editorial — wordmark grande arriba, features en lista vertical numerada
// V2: con grano y composición editorial — wordmark protagonista, features como cards apiladas

function LoginShell({ children, accent }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex',
      fontFamily: 'Geist, system-ui, sans-serif',
      color: '#1a1a1a', background: '#f8f7f5', overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

// ─── shared form ────────────────────────────────────────────────
function LoginForm({ accent, variant }) {
  const [email, setEmail] = React.useState('valeria.m@g-mura.co');
  const [password, setPassword] = React.useState('••••••••••');
  const [showPw, setShowPw] = React.useState(false);
  const [remember, setRemember] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [emailFocus, setEmailFocus] = React.useState(false);
  const [pwFocus, setPwFocus] = React.useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => setLoading(false), 1400);
  };

  const fieldBorder = (focused) => focused ? `1.5px solid ${accent}` : '1px solid #e7e5e4';
  const fieldShadow = (focused) => focused ? `0 0 0 4px ${accent}1a` : 'none';

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{
          fontFamily: 'Bricolage Grotesque, serif',
          fontSize: variant === 'b' ? 32 : 28,
          fontWeight: 600, letterSpacing: '-0.025em',
          marginBottom: 6, lineHeight: 1.1,
        }}>
          {variant === 'b' ? <>Buenos días, <span style={{ color: accent }}>Valeria</span></> : 'Ingresar'}
        </div>
        <div style={{ fontSize: 14, color: '#737373', lineHeight: 1.5 }}>
          {variant === 'b' ? 'Iniciá tu turno en Tienda Bogotá Centro.' : 'Acceso para administradores y vendedores.'}
        </div>
      </div>

      {/* Email */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#525252' }}>Correo</span>
        <div style={{
          display: 'flex', alignItems: 'center', height: 46, padding: '0 14px',
          borderRadius: 10, background: '#fff',
          border: fieldBorder(emailFocus),
          boxShadow: fieldShadow(emailFocus),
          transition: 'border-color .12s, box-shadow .12s',
        }}>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setEmailFocus(true)} onBlur={() => setEmailFocus(false)}
            style={{ flex: 1, border: 0, outline: 0, fontSize: 14.5, fontFamily: 'inherit', background: 'transparent' }}
          />
        </div>
      </label>

      {/* Password */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#525252' }}>Contraseña</span>
        <div style={{
          display: 'flex', alignItems: 'center', height: 46, padding: '0 8px 0 14px',
          borderRadius: 10, background: '#fff',
          border: fieldBorder(pwFocus),
          boxShadow: fieldShadow(pwFocus),
          transition: 'border-color .12s, box-shadow .12s',
        }}>
          <input
            type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setPwFocus(true)} onBlur={() => setPwFocus(false)}
            style={{ flex: 1, border: 0, outline: 0, fontSize: 14.5, fontFamily: 'inherit', background: 'transparent', letterSpacing: showPw ? 'normal' : '0.15em' }}
          />
          <button type="button" onClick={() => setShowPw((s) => !s)} style={{
            padding: '6px 10px', fontSize: 11.5, fontWeight: 500, color: '#525252',
            background: 'transparent', border: 0, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          }}>{showPw ? 'Ocultar' : 'Mostrar'}</button>
        </div>
      </label>

      {/* Remember */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', userSelect: 'none' }}>
        <span onClick={() => setRemember((r) => !r)} style={{
          width: 18, height: 18, borderRadius: 5,
          border: remember ? `1.5px solid ${accent}` : '1.5px solid #d6d3d1',
          background: remember ? accent : '#fff',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          transition: 'all .12s',
        }}>
          {remember && <Icon.check width="11" height="11" style={{ color: '#fff' }} />}
        </span>
        <span style={{ fontSize: 13, color: '#525252' }}>Mantener sesión iniciada en esta caja</span>
      </label>

      {/* Submit */}
      <button type="submit" disabled={loading} style={{
        height: 50, border: 0, borderRadius: 10,
        background: accent, color: '#fff',
        fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
        cursor: loading ? 'wait' : 'pointer',
        boxShadow: `0 6px 18px ${accent}45`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: loading ? 0.85 : 1,
        transition: 'opacity .12s',
      }}>
        {loading ? (
          <>
            <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: 999, animation: 'gm-spin 0.8s linear infinite' }} />
            Verificando…
          </>
        ) : (
          <>
            Ingresar
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </>
        )}
      </button>

      <style>{`@keyframes gm-spin { to { transform: rotate(360deg); } }`}</style>
    </form>
  );
}

// ─── V1: Editorial limpio ───────────────────────────────────────
function LoginV1({ accent = '#8b5cf6' }) {
  const features = [
    { n: '01', title: 'Inventario por talla y color', desc: 'Stock en tiempo real, sin sorpresas en caja.' },
    { n: '02', title: 'Escáner integrado', desc: 'Lee códigos de barras directo desde el lector.' },
    { n: '03', title: 'Devoluciones simples', desc: 'Cambios y reembolsos en menos de 30 segundos.' },
  ];

  return (
    <LoginShell accent={accent}>
      {/* LEFT 40% — slate panel */}
      <aside style={{
        flex: '0 0 40%', background: '#0f172a', color: '#fff',
        display: 'flex', flexDirection: 'column', padding: '40px 44px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle violet glow */}
        <div style={{
          position: 'absolute', top: -120, right: -120, width: 380, height: 380,
          borderRadius: 999, background: `radial-gradient(circle, ${accent}45 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />

        {/* Wordmark */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: accent, display: 'grid', placeItems: 'center', fontFamily: 'Bricolage Grotesque, serif', fontWeight: 700, fontSize: 18 }}>G</div>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            G-Mura<span style={{ color: accent }}>.</span>
          </div>
        </div>

        {/* Tagline */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', maxWidth: 420 }}>
          <div style={{
            fontFamily: 'Bricolage Grotesque, serif',
            fontSize: 40, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.03em',
            marginBottom: 16,
          }}>
            El punto de venta hecho para <span style={{ color: accent, fontStyle: 'italic' }}>tiendas de ropa</span>.
          </div>
          <div style={{ fontSize: 15, color: '#94a3b8', lineHeight: 1.55, marginBottom: 36 }}>
            Construido alrededor de tallas, colores y rotación de inventario.
          </div>

          {/* Features list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: 24 }}>
            {features.map((f) => (
              <div key={f.n} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{
                  fontFamily: 'Bricolage Grotesque, serif',
                  fontSize: 13, fontWeight: 600, color: accent,
                  fontVariantNumeric: 'tabular-nums', minWidth: 24, paddingTop: 2,
                }}>{f.n}</div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 500, color: '#fff', marginBottom: 3 }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.45 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
          <span>v3.4.1 · Tienda Bogotá Centro</span>
          <span>© 2026 G-Mura</span>
        </div>
      </aside>

      {/* RIGHT 60% — form */}
      <main style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 48, position: 'relative',
      }}>
        <LoginForm accent={accent} variant="a" />

        {/* Caja activa indicator (top right) */}
        <div style={{ position: 'absolute', top: 28, right: 32, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#737373' }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: '#16a34a', boxShadow: '0 0 0 3px #16a34a25' }} />
          Caja 02 · en línea
        </div>
      </main>
    </LoginShell>
  );
}

// ─── V2: Editorial con grano + saludo personal ──────────────────
function LoginV2({ accent = '#8b5cf6' }) {
  const features = [
    { icon: 'box', title: 'Inventario por talla y color', desc: 'Tiempo real, sincronizado entre cajas.' },
    { icon: 'scan', title: 'Escáner de códigos de barras', desc: 'Integrado con cualquier lector USB.' },
    { icon: 'refresh', title: 'Devoluciones sin complicaciones', desc: 'Cambios y reembolsos en pocos clicks.' },
  ];

  return (
    <LoginShell accent={accent}>
      {/* LEFT 40% — slate con composición editorial */}
      <aside style={{
        flex: '0 0 40%', background: '#0f172a', color: '#fff',
        display: 'flex', flexDirection: 'column', padding: '36px 40px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background grid + glow */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06, pointerEvents: 'none' }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="loginGrid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="#fff" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#loginGrid)" />
        </svg>
        <div style={{
          position: 'absolute', bottom: -180, left: -120, width: 480, height: 480,
          borderRadius: 999, background: `radial-gradient(circle, ${accent}40 0%, transparent 60%)`,
          pointerEvents: 'none',
        }} />

        {/* Top: wordmark + version chip */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: accent, display: 'grid', placeItems: 'center', fontFamily: 'Bricolage Grotesque, serif', fontWeight: 700, fontSize: 16 }}>G</div>
            <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
              G-Mura<span style={{ color: accent }}>.</span>
            </div>
          </div>
          <div style={{ padding: '4px 9px', borderRadius: 999, background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.2)', fontSize: 10.5, fontWeight: 500, color: '#cbd5e1', letterSpacing: '.04em' }}>v3.4.1</div>
        </div>

        {/* Hero quote / tagline */}
        <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 460 }}>
          <div style={{
            fontFamily: 'Bricolage Grotesque, serif',
            fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.04em',
            fontSize: 76, marginBottom: 4,
          }}>
            Vendé.
          </div>
          <div style={{
            fontFamily: 'Bricolage Grotesque, serif',
            fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.04em',
            fontSize: 76, marginBottom: 4, color: '#cbd5e1',
          }}>
            Cobrá.
          </div>
          <div style={{
            fontFamily: 'Bricolage Grotesque, serif',
            fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.04em',
            fontSize: 76, fontStyle: 'italic', color: accent, marginBottom: 28,
          }}>
            Repetí.
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.5, maxWidth: 360 }}>
            Un POS construido a la medida de boutiques físicas — pensado para que el turno empiece y termine sin fricción.
          </div>
        </div>

        {/* Features cards */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {features.map((f, i) => {
            const I = Icon[f.icon];
            return (
              <div key={i} style={{
                display: 'flex', gap: 14, alignItems: 'center', padding: '12px 14px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: 10,
                backdropFilter: 'blur(8px)',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: `${accent}1f`, color: accent,
                  display: 'grid', placeItems: 'center',
                }}>
                  <I width="17" height="17" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#fff', marginBottom: 1 }}>{f.title}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.35 }}>{f.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* RIGHT 60% — form con detalle */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column', position: 'relative',
        background: '#fdfcfb',
      }}>
        {/* Top status bar */}
        <div style={{
          height: 56, padding: '0 32px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #ebe9e6',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: '#737373' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: '#16a34a', boxShadow: '0 0 0 3px #16a34a22' }} />
              <span><b style={{ color: '#1a1a1a', fontWeight: 600 }}>Caja 02</b> · en línea</span>
            </div>
            <span style={{ width: 1, height: 14, background: '#ebe9e6' }} />
            <span>Tienda Bogotá Centro</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#737373', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon.clock width="13" height="13" /> 08:42 · lunes 26 abr
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
          <LoginForm accent={accent} variant="b" />
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 32px', borderTop: '1px solid #ebe9e6',
          display: 'flex', justifyContent: 'space-between',
          fontSize: 12, color: '#a8a29e',
        }}>
          <span>¿Problemas para acceder? Contactá al administrador de tu tienda.</span>
          <span>© 2026 G-Mura</span>
        </div>
      </main>
    </LoginShell>
  );
}

Object.assign(window, { LoginV1, LoginV2 });
