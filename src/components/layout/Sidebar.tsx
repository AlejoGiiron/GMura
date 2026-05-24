import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ShoppingCart,
  History,
  Package,
  Layers,
  RotateCcw,
  Users,
  BarChart2,
  Settings,
  Wallet,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart, end: true },
  { to: '/ventas/historial', label: 'Historial', icon: History },
  { to: '/productos', label: 'Productos', icon: Package, adminOnly: true },
  { to: '/inventario', label: 'Inventario', icon: Layers },
  { to: '/devoluciones', label: 'Devoluciones', icon: RotateCcw },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/reportes', label: 'Reportes', icon: BarChart2, adminOnly: true },
  { to: '/caja/historial', label: 'Historial de caja', icon: Wallet, adminOnly: true },
  { to: '/configuracion', label: 'Configuración', icon: Settings, adminOnly: true },
]

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col bg-slate-900">
      {/* Wordmark */}
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-violet-500 text-sm font-bold text-white">
          G
        </div>
        <span className="text-[17px] font-semibold tracking-tight text-white">
          G-Mura<span className="text-violet-400">.</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <Icon size={17} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="border-t border-slate-800 px-3 py-4">
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          <LogOut size={17} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
