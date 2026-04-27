import CategoriesManager from '@/components/config/CategoriesManager'

export default function ConfigPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Configuración</h1>
        <p className="mt-1 text-sm text-slate-500">Ajustes generales de la tienda.</p>
      </div>

      <CategoriesManager />
    </div>
  )
}
