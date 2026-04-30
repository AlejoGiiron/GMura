import { useState, useEffect } from 'react'
import { Tag, GripVertical, Plus, Trash2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreConfig, resolveConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import type { StoreColorConfig } from '@/types/config.types'

// ─── Sizes ────────────────────────────────────────────────────────────────────

function SizeList({
  sizes,
  onChange,
}: {
  sizes: string[]
  onChange: (s: string[]) => void
}) {
  const [newSize, setNewSize] = useState('')
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  function addSize() {
    const v = newSize.trim().toUpperCase()
    if (!v) return
    if (sizes.includes(v)) {
      toast.error(`La talla "${v}" ya existe`)
      return
    }
    onChange([...sizes, v])
    setNewSize('')
  }

  function removeSize(idx: number) {
    const updated = sizes.filter((_, i) => i !== idx)
    onChange(updated)
  }

  function handleDrop(targetIdx: number) {
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDraggedIdx(null)
      setDragOverIdx(null)
      return
    }
    const next = [...sizes]
    const [moved] = next.splice(draggedIdx, 1)
    next.splice(targetIdx, 0, moved)
    onChange(next)
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Tallas predefinidas
      </p>
      <div className="space-y-1">
        {sizes.map((size, idx) => (
          <div
            key={`${size}-${idx}`}
            draggable
            onDragStart={() => setDraggedIdx(idx)}
            onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null) }}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
            onDrop={(e) => { e.preventDefault(); handleDrop(idx) }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
              draggedIdx === idx
                ? 'opacity-40'
                : dragOverIdx === idx
                ? 'border-violet-300 bg-violet-50'
                : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
            }`}
          >
            <span className="cursor-grab text-slate-300 active:cursor-grabbing">
              <GripVertical size={14} />
            </span>
            <span
              className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-2 text-xs font-semibold tabular-nums"
            >
              {size}
            </span>
            <span className="flex-1 text-sm text-[#1a1a1a]">{size}</span>
            <button
              onClick={() => removeSize(idx)}
              className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      {/* Add */}
      <div className="mt-2 flex gap-2">
        <input
          value={newSize}
          onChange={(e) => setNewSize(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addSize() }}
          placeholder="Nueva talla (ej. 4XL)"
          className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <button
          onClick={addSize}
          disabled={!newSize.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus size={13} />
          Agregar
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-[#a8a29e]">Arrastra para reordenar</p>
    </div>
  )
}

// ─── Colors ───────────────────────────────────────────────────────────────────

function ColorList({
  colors,
  onChange,
}: {
  colors: StoreColorConfig[]
  onChange: (c: StoreColorConfig[]) => void
}) {
  const [newName, setNewName] = useState('')
  const [newHex, setNewHex] = useState('#8b5cf6')

  function addColor() {
    const name = newName.trim()
    if (!name) return
    onChange([...colors, { name, hex: newHex }])
    setNewName('')
    setNewHex('#8b5cf6')
  }

  function updateName(idx: number, name: string) {
    const next = colors.map((c, i) => (i === idx ? { ...c, name } : c))
    onChange(next)
  }

  function updateHex(idx: number, hex: string) {
    const next = colors.map((c, i) => (i === idx ? { ...c, hex } : c))
    onChange(next)
  }

  function removeColor(idx: number) {
    onChange(colors.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Colores predefinidos
      </p>
      <div className="space-y-1">
        {colors.map((color, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2"
          >
            <input
              type="color"
              value={color.hex}
              onChange={(e) => updateHex(idx, e.target.value)}
              className="h-7 w-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
              title="Seleccionar color"
            />
            <span
              className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
              style={{ background: color.hex }}
            />
            <input
              value={color.name}
              onChange={(e) => updateName(idx, e.target.value)}
              className="flex-1 bg-transparent text-sm text-[#1a1a1a] outline-none"
            />
            <button
              onClick={() => removeColor(idx)}
              className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      {/* Add */}
      <div className="mt-2 flex gap-2">
        <input
          type="color"
          value={newHex}
          onChange={(e) => setNewHex(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded-lg border border-[#ebe9e6] bg-white p-1"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addColor() }}
          placeholder="Nombre del color"
          className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <button
          onClick={addColor}
          disabled={!newName.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus size={13} />
          Agregar
        </button>
      </div>
    </div>
  )
}

// ─── Brands ───────────────────────────────────────────────────────────────────

function BrandList({
  brands,
  onChange,
}: {
  brands: string[]
  onChange: (b: string[]) => void
}) {
  const [newBrand, setNewBrand] = useState('')

  function addBrand() {
    const v = newBrand.trim()
    if (!v) return
    if (brands.includes(v)) {
      toast.error(`La marca "${v}" ya existe`)
      return
    }
    onChange([...brands, v])
    setNewBrand('')
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Marcas frecuentes
      </p>
      {brands.length === 0 ? (
        <p className="mb-2 text-xs text-[#a8a29e]">Sin marcas. Agrégalas para usarlas en productos.</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-2">
          {brands.map((brand, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 rounded-full border border-[#ebe9e6] bg-white px-3 py-1 text-xs font-medium text-[#525252]"
            >
              {brand}
              <button
                onClick={() => onChange(brands.filter((_, i) => i !== idx))}
                className="text-slate-300 hover:text-red-400"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={newBrand}
          onChange={(e) => setNewBrand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addBrand() }}
          placeholder="Nombre de la marca"
          className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <button
          onClick={addBrand}
          disabled={!newBrand.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus size={13} />
          Agregar
        </button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProductsSection() {
  const { data: store, isLoading } = useStoreConfig()
  const { updateStoreConfig } = useConfigMutations()

  const [sizes, setSizes] = useState<string[]>([])
  const [colors, setColors] = useState<StoreColorConfig[]>([])
  const [brands, setBrands] = useState<string[]>([])
  const [returnDays, setReturnDays] = useState(30)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    const cfg = resolveConfig(store.config)
    setSizes(cfg.sizes)
    setColors(cfg.colors)
    setBrands(cfg.brands)
    setReturnDays(cfg.return_days_limit)
  }, [store])

  async function handleSave() {
    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({
        sizes,
        colors,
        brands,
        return_days_limit: returnDays,
      })
      toast.success('Configuración de productos guardada')
    } catch {
      // toast shown by mutation
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-600">
          <Tag size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Configuración de productos</h2>
          <p className="text-xs text-[#737373]">Tallas, colores, marcas y devoluciones</p>
        </div>
      </div>

      {/* Body */}
      <div className="divide-y divide-[#f5f4f1]">
        <div className="px-5 py-5">
          <SizeList sizes={sizes} onChange={setSizes} />
        </div>
        <div className="px-5 py-5">
          <ColorList colors={colors} onChange={setColors} />
        </div>
        <div className="px-5 py-5">
          <BrandList brands={brands} onChange={setBrands} />
        </div>
        <div className="px-5 py-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Días máximos para devolución
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={365}
              value={returnDays}
              onChange={(e) => setReturnDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-10 w-24 rounded-lg border border-[#ebe9e6] px-3 text-sm tabular-nums outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <div className="flex items-center gap-1.5 text-xs text-[#737373]">
              <RefreshCw size={12} />
              días desde la compra
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-[#f5f4f1] px-5 py-4">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#8b5cf6] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
