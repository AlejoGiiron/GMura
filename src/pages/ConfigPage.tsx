import { useState } from 'react'
import { Store, Users, Tag, CreditCard, Printer, type LucideIcon } from 'lucide-react'
import StoreSection from '@/components/config/StoreSection'
import UsersSection from '@/components/config/UsersSection'
import ProductsSection from '@/components/config/ProductsSection'
import CajaSection from '@/components/config/CajaSection'
import EtiquetasSection from '@/components/config/EtiquetasSection'
import CategoriesManager from '@/components/config/CategoriesManager'

type SectionId = 'tienda' | 'usuarios' | 'productos' | 'caja' | 'etiquetas'

const SECTIONS: {
  id: SectionId
  label: string
  Icon: LucideIcon
}[] = [
  { id: 'tienda', label: 'Tienda', Icon: Store },
  { id: 'usuarios', label: 'Usuarios', Icon: Users },
  { id: 'productos', label: 'Productos', Icon: Tag },
  { id: 'caja', label: 'Caja', Icon: CreditCard },
  { id: 'etiquetas', label: 'Etiquetas', Icon: Printer },
]

export default function ConfigPage() {
  const [active, setActive] = useState<SectionId>('tienda')

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left nav ───────────────────────────────────────────────────────── */}
      <nav className="w-56 shrink-0 overflow-y-auto border-r border-[#ebe9e6] bg-white p-3">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.06em] text-[#94a3b8]">
          Configuración
        </p>
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              active === id
                ? 'bg-violet-500 text-white'
                : 'text-[#525252] hover:bg-slate-50 hover:text-[#1a1a1a]'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}

        <p className="mb-2 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[.06em] text-[#94a3b8]">
          Catálogo
        </p>
        <div className="rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2">
          <p className="text-xs text-[#737373]">Categorías gestionadas en Productos → Configuración</p>
        </div>
      </nav>

      {/* ── Right content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-[#f8f7f5]">
        {/* Page header */}
        <div className="border-b border-[#ebe9e6] bg-white px-6 py-4">
          <h1
            className="text-[20px] font-semibold tracking-[-0.025em] text-[#1a1a1a]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
          >
            {SECTIONS.find((s) => s.id === active)?.label ?? 'Configuración'}
          </h1>
          <p className="mt-0.5 text-sm text-[#737373]">
            {active === 'tienda' && 'Nombre, logo y datos de contacto de la tienda'}
            {active === 'usuarios' && 'Gestiona el equipo y sus permisos de acceso'}
            {active === 'productos' && 'Tallas, colores, marcas y límite de devoluciones'}
            {active === 'caja' && 'Métodos de pago, motivos de ajuste y QR de Nequi'}
            {active === 'etiquetas' && 'Formato y campos para etiquetas de precio'}
          </p>
        </div>

        <div className="p-6">
          {active === 'tienda' && <StoreSection />}
          {active === 'usuarios' && (
            <div className="space-y-6">
              <UsersSection />
            </div>
          )}
          {active === 'productos' && (
            <div className="space-y-6">
              <ProductsSection />
              <CategoriesManager />
            </div>
          )}
          {active === 'caja' && <CajaSection />}
          {active === 'etiquetas' && <EtiquetasSection />}
        </div>
      </div>
    </div>
  )
}
