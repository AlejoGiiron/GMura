import { useState } from 'react'
import { Users, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreUsers } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { useAuth } from '@/hooks/useAuth'
import type { Profile, UserRole } from '@/types/database.types'

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}
    >
      {initials}
    </div>
  )
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        role === 'admin'
          ? 'bg-violet-100 text-violet-700'
          : 'bg-slate-100 text-slate-600'
      }`}
    >
      {role === 'admin' ? 'Admin' : 'Vendedor'}
    </span>
  )
}

// ─── Create User Modal ────────────────────────────────────────────────────────

interface CreateUserModalProps {
  onClose: () => void
  onCreated: () => void
}

function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const { createUser } = useConfigMutations()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('seller')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      toast.error('Todos los campos son requeridos')
      return
    }
    try {
      await createUser.mutateAsync({ full_name: fullName.trim(), email: email.trim(), password, role })
      onCreated()
    } catch {
      // toast shown by mutation
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-5">
          <div>
            <h2
              className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-[#1a1a1a]"
              style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
            >
              Nuevo usuario
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">Crear acceso para un colaborador</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Nombre completo
            </label>
            <input
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ana García"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ana@tienda.com"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Contraseña temporal
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="seller">Vendedor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createUser.isPending}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#8b5cf6] text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95 disabled:opacity-60"
            >
              {createUser.isPending ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── User Row ─────────────────────────────────────────────────────────────────

function UserRow({ user }: { user: Profile }) {
  const { profile: currentProfile } = useAuth()
  const { updateUserRole, toggleUserActive } = useConfigMutations()
  const isSelf = user.id === currentProfile?.id

  return (
    <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5 last:border-0">
      <Avatar name={user.full_name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1a1a1a] truncate">
          {user.full_name}
          {isSelf && (
            <span className="ml-2 text-[11px] font-normal text-[#a8a29e]">(tú)</span>
          )}
        </p>
        <p className="text-xs text-[#737373] truncate">{user.email}</p>
      </div>

      <RoleBadge role={user.role} />

      {/* Role select */}
      {!isSelf && (
        <select
          value={user.role}
          onChange={(e) =>
            void updateUserRole.mutateAsync({ id: user.id, role: e.target.value as UserRole })
          }
          className="h-8 rounded-lg border border-[#ebe9e6] bg-white px-2 text-xs text-[#525252] outline-none focus:border-violet-400"
        >
          <option value="seller">Vendedor</option>
          <option value="admin">Admin</option>
        </select>
      )}

      {/* Active toggle */}
      {!isSelf && (
        <button
          onClick={() =>
            void toggleUserActive.mutateAsync({ id: user.id, is_active: !user.is_active })
          }
          title={user.is_active ? 'Desactivar acceso' : 'Activar acceso'}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
            user.is_active ? 'bg-violet-500' : 'bg-slate-200'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
              user.is_active ? 'translate-x-4' : 'translate-x-1'
            }`}
          />
        </button>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function UsersSection() {
  const { data: users = [], isLoading } = useStoreUsers()
  const [showModal, setShowModal] = useState(false)

  const activeUsers = users.filter((u) => u.is_active)
  const inactiveUsers = users.filter((u) => !u.is_active)

  return (
    <div className="space-y-6">
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-600">
              <Users size={15} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#1a1a1a]">Usuarios</h2>
              <p className="text-xs text-[#737373]">
                {activeUsers.length} activo{activeUsers.length !== 1 ? 's' : ''}
                {inactiveUsers.length > 0 &&
                  ` · ${inactiveUsers.length} inactivo${inactiveUsers.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50"
          >
            <Plus size={13} />
            Nuevo usuario
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-0 p-0">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5"
              >
                <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <Users size={22} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">Sin usuarios</p>
          </div>
        ) : (
          <>
            {activeUsers.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
            {inactiveUsers.length > 0 && (
              <div className="border-t border-[#f5f4f1] pt-2">
                <p className="mb-1 px-5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Inactivos
                </p>
                {inactiveUsers.map((u) => (
                  <UserRow key={u.id} user={u} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <CreateUserModal
          onClose={() => setShowModal(false)}
          onCreated={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
