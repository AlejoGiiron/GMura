import { Minus, Plus } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Piezas chicas de la pantalla de armar el envío (handoff §3.1 y §3.4).
// ─────────────────────────────────────────────────────────────────────────────

export type ChipTone = 'neutral' | 'match' | 'toCreate'

/**
 * Chip de talla o color. `match` (verde) es el mecanismo principal de la
 * tarjeta de candidato: el ojo encuentra la ficha correcta sin leer.
 * `toCreate` (violeta punteado, con +) marca lo que hay que crear allá.
 */
export function AttrChip({ label, tone }: { label: string; tone: ChipTone }) {
  const styles: Record<ChipTone, string> = {
    neutral: 'border-stone-200 bg-stone-50 text-neutral-500',
    match: 'border-green-300 bg-green-100 text-green-700 font-semibold',
    toCreate: 'border-violet-300 border-dashed bg-violet-50 text-violet-700 font-semibold',
  }
  return (
    <span
      className={`inline-flex items-center rounded-[5px] border px-1.5 py-0.5 text-[11px] ${styles[tone]}`}
    >
      {tone === 'toCreate' ? `+ ${label}` : label}
    </span>
  )
}

interface QtyStepperProps {
  value: number
  /** Disponible = stock_qty − reserved_qty. */
  max: number
  onChange: (n: number) => void
  size?: 'md' | 'lg'
}

/**
 * §3.4 — selector de cantidad con tope en el disponible.
 * `−` se apaga en 1 (para quitar la línea está el ×); `+` se apaga en el tope.
 * Piso táctil de 34px: se usa todo el día.
 */
export function QtyStepper({ value, max, onChange, size = 'lg' }: QtyStepperProps) {
  const box = size === 'lg' ? 'h-[34px] w-[34px]' : 'h-[30px] w-[30px]'
  const btn =
    'flex items-center justify-center rounded-lg border border-stone-200 bg-white text-neutral-600 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-neutral-300'

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        aria-label="Quitar una unidad"
        className={`${box} ${btn}`}
      >
        <Minus size={14} />
      </button>
      <span className="min-w-[26px] text-center font-mono text-[15px] font-bold text-neutral-800">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Agregar una unidad"
        className={`${box} ${btn}`}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
