# Crear nuevo componente reutilizable

Nombre y descripción: $ARGUMENTS

1. Revisa src/components/ui/ para mantener consistencia
2. Carpeta según tipo:
   - Genérico: src/components/ui/
   - Específico: src/components/[modulo]/
3. Requisitos:
   - Props tipadas con interface
   - Sin any
   - Tailwind puro
   - Accesible (aria-labels, roles)
   - Export nombrado
4. Si hay datos de Supabase: recibir como props,
   no fetchear dentro del componente