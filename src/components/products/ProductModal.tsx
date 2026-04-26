import { useState, useRef, type ChangeEvent, type FormEvent } from 'react'
import { X, Package } from 'lucide-react'
import { useCategories } from '@/hooks/useProducts'
import { useProductMutations } from '@/hooks/useProductMutations'
import type { Product } from '@/types/database.types'

interface ProductModalProps {
  product?: Product | null
  onClose: () => void
  onSaved: (product: Product) => void
}

export default function ProductModal({ product, onClose, onSaved }: ProductModalProps) {
  const { data: categories = [] } = useCategories()
  const { create, update, uploadImage } = useProductMutations()

  const [name, setName] = useState(product?.name ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_url ?? null)
  const [submitting, setSubmitting] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const isEdit = !!product

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      // Upload image first (if new file selected)
      let finalImageUrl: string | null = product?.image_url ?? null
      if (imageFile) {
        const fileId = product?.id ?? crypto.randomUUID()
        const url = await uploadImage(imageFile, fileId)
        if (url) finalImageUrl = url
      }

      const payload = {
        name: name.trim(),
        brand: brand.trim() || null,
        category_id: categoryId || null,
        description: description.trim() || null,
        image_url: finalImageUrl,
      }

      const saved = isEdit
        ? await update.mutateAsync({ id: product.id, ...payload })
        : await create.mutateAsync(payload)

      onSaved(saved)
    } catch {
      // toast already shown by mutation onError
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[540px] max-h-[90vh] overflow-auto rounded-2xl bg-white p-7 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            {isEdit ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>
        {!isEdit && (
          <p className="mb-5 text-sm text-slate-400">
            Las variantes (talla y color) se agregan después.
          </p>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Image upload */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Imagen</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:border-violet-400 hover:text-violet-500"
            >
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <>
                  <Package size={22} />
                  <span className="text-[12.5px]">Click para subir o arrastrar imagen</span>
                  <span className="text-[11px] text-slate-300">PNG, JPG hasta 5 MB</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Nombre del producto
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Camiseta Básica Algodón"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          {/* Brand + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Marca</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Marca"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Categoría</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Material, corte, detalles…"
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="h-11 flex-[2] rounded-lg bg-violet-500 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.35)] hover:bg-violet-600 disabled:opacity-50"
            >
              {submitting
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : 'Crear y agregar variantes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
