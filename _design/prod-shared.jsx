// G-Mura · Productos — primitives compartidos

function Th({ children, align }) {
  return <th style={{ textAlign: align || 'left', fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', letterSpacing: '.05em', padding: '10px 16px', borderBottom: '1px solid #ebe9e6' }}>{children}</th>;
}

function Td({ children, align }) {
  return <td style={{ textAlign: align || 'left', padding: '10px 16px', verticalAlign: 'middle' }}>{children}</td>;
}

function StockBadge({ state, stock }) {
  if (state === 'out') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c', fontSize: 11, fontWeight: 600 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: '#dc2626' }} />Sin stock</span>;
  if (state === 'low') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 600 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: '#d97706' }} />Stock bajo</span>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 600 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: '#16a34a' }} />Disponible</span>;
}

function EditableCell({ value, format, isEditing, onStart, onCommit, accent }) {
  const [v, setV] = React.useState(value);
  const ref = React.useRef(null);
  React.useEffect(() => { if (isEditing) { setV(value); ref.current?.focus(); ref.current?.select(); } }, [isEditing, value]);
  if (isEditing) {
    return (
      <input
        ref={ref}
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onCommit(v)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') onCommit(value); }}
        style={{
          width: 100, height: 28, padding: '0 8px', textAlign: 'right',
          border: `1.5px solid ${accent}`, borderRadius: 6, outline: 0,
          fontFamily: 'inherit', fontSize: 13, fontVariantNumeric: 'tabular-nums',
          boxShadow: `0 0 0 3px ${accent}20`,
        }}
      />
    );
  }
  return (
    <button onClick={onStart} style={{ height: 28, padding: '0 8px', border: '1px solid transparent', background: 'transparent', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', cursor: 'text', color: '#1a1a1a' }}
      onMouseEnter={(e) => e.currentTarget.style.background = '#f5f4f1'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      {format ? format(value) : value}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#525252', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = { width: '100%', height: 40, padding: '0 12px', border: '1px solid #ebe9e6', background: '#fff', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 0 };

function NewProductModal({ accent, onClose }) {
  const [name, setName] = React.useState('');
  const [brand, setBrand] = React.useState('');
  const [category, setCategory] = React.useState('Camisetas');
  const [description, setDescription] = React.useState('');
  const cats = ['Camisetas', 'Pantalones', 'Vestidos', 'Accesorios', 'Calzado', 'Chaquetas'];

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 540, maxHeight: '90%', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 28, fontFamily: 'inherit', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em' }}>Nuevo producto</div>
          <button onClick={onClose} style={{ width: 28, height: 28, border: 0, background: '#f5f4f1', borderRadius: 7, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon.x width="14" height="14" /></button>
        </div>
        <div style={{ fontSize: 13, color: '#737373', marginBottom: 20 }}>Las variantes (talla y color) se agregan después.</div>

        <Field label="Imagen">
          <button style={{ width: '100%', height: 110, border: '1.5px dashed #d6d3d1', borderRadius: 10, background: '#fafaf9', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#737373', fontFamily: 'inherit' }}>
            <Icon.package width="22" height="22" />
            <span style={{ fontSize: 12.5 }}>Click para subir o arrastrar imagen</span>
            <span style={{ fontSize: 11, color: '#a8a29e' }}>PNG, JPG hasta 5MB</span>
          </button>
        </Field>

        <Field label="Nombre del producto">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Camiseta Básica Algodón" style={inputStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Marca">
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca" style={inputStyle} />
          </Field>
          <Field label="Categoría">
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, paddingRight: 28 }}>
              {cats.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Descripción">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Material, corte, detalles…" style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          <button onClick={onClose} style={{ flex: 1, height: 42, border: '1px solid #ebe9e6', background: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={onClose} style={{ flex: 2, height: 42, border: 0, background: accent, color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', boxShadow: `0 4px 12px ${accent}40` }}>Crear y agregar variantes</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Th, Td, StockBadge, EditableCell, Field, inputStyle, NewProductModal });
