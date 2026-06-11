// Helpers de zona horaria America/Bogota.
//
// Colombia NO observa horario de verano: su offset es fijo UTC-5 todo el año.
// Las columnas timestamptz de Supabase (closed_at, created_at, …) se guardan
// en UTC. Cuando filtramos por una fecha civil de Bogotá (YYYY-MM-DD) hay que
// convertir los límites del día a su instante UTC equivalente; de lo contrario
// un turno cerrado de noche (p. ej. 19:00 Bogotá = 00:00Z del día siguiente)
// se queda fuera del rango y "desaparece".

const BOGOTA_UTC_OFFSET = '-05:00'

// Inicio del día (00:00:00.000 Bogotá) de la fecha dada, como ISO UTC.
// '2026-06-10' → '2026-06-10T05:00:00.000Z'
export function bogotaDayStartToUtc(date: string): string {
  return new Date(`${date}T00:00:00.000${BOGOTA_UTC_OFFSET}`).toISOString()
}

// Fin del día (23:59:59.999 Bogotá) de la fecha dada, como ISO UTC.
// '2026-06-10' → '2026-06-11T04:59:59.999Z'
export function bogotaDayEndToUtc(date: string): string {
  return new Date(`${date}T23:59:59.999${BOGOTA_UTC_OFFSET}`).toISOString()
}
