import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

function getBogoTime(): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date())
}

export default function Header() {
  const { profile } = useAuth()
  const [time, setTime] = useState(getBogoTime)

  useEffect(() => {
    const id = setInterval(() => setTime(getBogoTime()), 60_000)
    return () => clearInterval(id)
  }, [])

  const roleLabel = profile?.role === 'admin' ? 'Administrador' : 'Vendedor'
  const initial = profile?.full_name?.charAt(0).toUpperCase() ?? '?'

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
          {initial}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-900">{profile?.full_name ?? '—'}</div>
          <div className="text-xs text-gray-500">{roleLabel}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Clock size={13} />
        <span className="tabular-nums">{time}</span>
        <span className="mx-0.5 text-gray-300">·</span>
        <span className="text-gray-400">Sin turno activo</span>
      </div>
    </header>
  )
}
