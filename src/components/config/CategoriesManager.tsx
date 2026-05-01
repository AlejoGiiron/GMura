import { useState, useEffect } from 'react'
import { GripVertical, Plus, Check, X, ToggleLeft, ToggleRight, Tag } from 'lucide-react'
import { useAllCategories } from '@/hooks/useCategories'
import { useCategoryMutations } from '@/hooks/useCategoryMutations'
import type { Category } from '@/types/database.types'

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#ef4444', // rojo
  '#f97316', // naranja
  '#eab308', // amarillo
  '#22c55e', // verde
  '#3b82f6', // azul
  '#8b5cf6', // violeta
  '#ec4899', // rosa
  '#64748b', // slate
]

const DEFAULT_COLOR = PRESET_COLORS[5] // violeta por defecto

// ─── Color Picker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          title={color}
          className="h-5 w-5 flex-shrink-0 rounded-full transition-transform hover:scale-110 focus:outline-none"
          style={{
            background: color,
            boxShadow:
              value === color
                ? `0 0 0 2px white, 0 0 0 3.5px ${color}`
                : '0 0 0 1px rgba(0,0,0,0.1)',
          }}
        />
      ))}
    </div>
  )
}

// ─── Category Row ─────────────────────────────────────────────────────────────

interface CategoryRowProps {
  cat: Category
  isEditing: boolean
  editName: string
  editColor: string
  isDragging: boolean
  isDragTarget: boolean
  onEditNameChange: (v: string) => void
  onEditColorChange: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenEdit: () => void
  onToggle: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

function CategoryRow({
  cat,
  isEditing,
  editName,
  editColor,
  isDragging,
  isDragTarget,
  onEditNameChange,
  onEditColorChange,
  onSaveEdit,
  onCancelEdit,
  onOpenEdit,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: CategoryRowProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
        isDragging ? 'opacity-40' : ''
      } ${isDragTarget ? 'bg-violet-50' : 'bg-white hover:bg-slate-50'}`}
    >
      {/* Drag-over indicator line */}
      {isDragTarget && (
        <div className="absolute left-3 right-3 top-0 h-0.5 rounded-full bg-violet-400" />
      )}

      {/* Drag handle */}
      <span className="flex-shrink-0 cursor-grab text-slate-300 active:cursor-grabbing">
        <GripVertical size={16} />
      </span>

      {isEditing ? (
        /* ── Edit mode ── */
        <>
          <ColorPicker value={editColor} onChange={onEditColorChange} />
          <input
            autoFocus
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            className="min-w-0 flex-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-sm outline-none focus:ring-2 focus:ring-violet-100"
          />
          <button
            onClick={onSaveEdit}
            disabled={!editName.trim()}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-violet-500 text-white disabled:opacity-40 hover:bg-violet-600"
          >
            <Check size={13} />
          </button>
          <button
            onClick={onCancelEdit}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100"
          >
            <X size={13} />
          </button>
        </>
      ) : (
        /* ── View mode ── */
        <>
          {/* Color dot */}
          <span
            className="h-3.5 w-3.5 flex-shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
            style={{ background: cat.color ?? '#64748b' }}
          />

          {/* Name */}
          <span
            className={`flex-1 text-sm font-medium ${cat.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}
          >
            {cat.name}
          </span>

          {/* Status badge */}
          {cat.is_active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Activa
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Inactiva
            </span>
          )}

          {/* Actions */}
          <button
            onClick={onOpenEdit}
            className="h-7 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          >
            Editar
          </button>
          <button
            onClick={onToggle}
            title={cat.is_active ? 'Desactivar' : 'Activar'}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            {cat.is_active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
          </button>
        </>
      )}
    </div>
  )
}

// ─── New Category Form ─────────────────────────────────────────────────────────

interface NewCategoryFormProps {
  name: string
  color: string
  submitting: boolean
  onNameChange: (v: string) => void
  onColorChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}

function NewCategoryForm({
  name,
  color,
  submitting,
  onNameChange,
  onColorChange,
  onSubmit,
  onCancel,
}: NewCategoryFormProps) {
  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Nueva categoría
      </p>
      <ColorPicker value={color} onChange={onColorChange} />
      <input
        autoFocus
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Nombre de la categoría"
        className="mt-3 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 flex-1 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!name.trim() || submitting}
          className="h-8 flex-[2] rounded-lg bg-violet-500 text-sm font-semibold text-white hover:bg-violet-600 disabled:opacity-50"
        >
          {submitting ? 'Creando…' : 'Crear categoría'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CategoriesManager() {
  const { data: categories = [], isLoading } = useAllCategories()
  const { create, update, toggleActive, reorder } = useCategoryMutations()

  // Local copy for optimistic drag-and-drop reordering
  const [localCats, setLocalCats] = useState<Category[]>([])

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(DEFAULT_COLOR)

  // New category form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR)
  const [creating, setCreating] = useState(false)

  // Drag-and-drop
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Sync local state when server data changes
  useEffect(() => {
    setLocalCats(categories)
  }, [categories])

  // ── Edit handlers ────────────────────────────────────────────────────────

  function openEdit(cat: Category) {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditColor(cat.color ?? DEFAULT_COLOR)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim()) return
    try {
      await update.mutateAsync({
        id: editingId,
        name: editName.trim(),
        color: editColor || null,
      })
    } catch {
      // toast shown by mutation
    } finally {
      setEditingId(null)
    }
  }

  // ── Create handler ───────────────────────────────────────────────────────

  async function handleCreate() {
    if (!newName.trim()) return
    const sortOrder =
      localCats.length > 0 ? Math.max(...localCats.map((c) => c.sort_order)) + 10 : 10
    setCreating(true)
    try {
      await create.mutateAsync({
        name: newName.trim(),
        color: newColor || null,
        sort_order: sortOrder,
      })
      setNewName('')
      setNewColor(DEFAULT_COLOR)
      setShowNewForm(false)
    } catch {
      // toast shown by mutation
    } finally {
      setCreating(false)
    }
  }

  // ── Drag-and-drop handlers ───────────────────────────────────────────────

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }

    const from = localCats.findIndex((c) => c.id === draggedId)
    const to = localCats.findIndex((c) => c.id === targetId)
    if (from === -1 || to === -1) return

    const newOrder = [...localCats]
    const [moved] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, moved)

    setLocalCats(newOrder)
    setDraggedId(null)
    setDragOverId(null)

    void reorder(newOrder.map((c) => c.id))
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const activeCats = localCats.filter((c) => c.is_active)
  const inactiveCats = localCats.filter((c) => !c.is_active)

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-600">
            <Tag size={15} />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Categorías</h2>
            <p className="text-xs text-slate-400">
              {activeCats.length} activa{activeCats.length !== 1 ? 's' : ''}
              {inactiveCats.length > 0 && ` · ${inactiveCats.length} inactiva${inactiveCats.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {!showNewForm && (
          <button
            onClick={() => setShowNewForm(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus size={13} />
            Nueva categoría
          </button>
        )}
      </div>

      {/* List */}
      <div className="p-3">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        )}

        {!isLoading && localCats.length === 0 && !showNewForm && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Tag size={28} className="text-slate-200" />
            <p className="text-sm text-slate-400">
              Sin categorías todavía.{' '}
              <button
                onClick={() => setShowNewForm(true)}
                className="font-medium text-violet-500 hover:underline"
              >
                Crear la primera
              </button>
            </p>
          </div>
        )}

        {/* Active categories */}
        {localCats
          .filter((c) => c.is_active)
          .map((cat) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              isEditing={editingId === cat.id}
              editName={editName}
              editColor={editColor}
              isDragging={draggedId === cat.id}
              isDragTarget={dragOverId === cat.id && draggedId !== cat.id}
              onEditNameChange={setEditName}
              onEditColorChange={setEditColor}
              onSaveEdit={() => void handleSaveEdit()}
              onCancelEdit={cancelEdit}
              onOpenEdit={() => openEdit(cat)}
              onToggle={() =>
                void toggleActive.mutateAsync({ id: cat.id, isActive: cat.is_active })
              }
              onDragStart={() => setDraggedId(cat.id)}
              onDragEnd={() => {
                setDraggedId(null)
                setDragOverId(null)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverId(cat.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(cat.id)
              }}
            />
          ))}

        {/* Inactive categories (collapsed section) */}
        {inactiveCats.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Inactivas ({inactiveCats.length})
            </p>
            {inactiveCats.map((cat) => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                isEditing={editingId === cat.id}
                editName={editName}
                editColor={editColor}
                isDragging={false}
                isDragTarget={false}
                onEditNameChange={setEditName}
                onEditColorChange={setEditColor}
                onSaveEdit={() => void handleSaveEdit()}
                onCancelEdit={cancelEdit}
                onOpenEdit={() => openEdit(cat)}
                onToggle={() =>
                  void toggleActive.mutateAsync({ id: cat.id, isActive: cat.is_active })
                }
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => e.preventDefault()}
              />
            ))}
          </div>
        )}

        {/* New category form */}
        {showNewForm && (
          <NewCategoryForm
            name={newName}
            color={newColor}
            submitting={creating}
            onNameChange={setNewName}
            onColorChange={setNewColor}
            onSubmit={() => void handleCreate()}
            onCancel={() => {
              setShowNewForm(false)
              setNewName('')
              setNewColor(DEFAULT_COLOR)
            }}
          />
        )}
      </div>

      {/* Footer hint */}
      {localCats.length > 1 && (
        <div className="border-t border-slate-100 px-5 py-2.5">
          <p className="text-[11px] text-slate-400">
            Arrastra las categorías para cambiar el orden en que aparecen.
          </p>
        </div>
      )}
    </div>
  )
}
