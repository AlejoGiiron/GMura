import { supabase } from './supabase'
import type { Database } from '../types/database.types'

type TableName = keyof Database['public']['Tables']
type TableRow<T extends TableName> = Database['public']['Tables'][T]['Row']
type TableInsert<T extends TableName> = Database['public']['Tables'][T]['Insert']
type TableUpdate<T extends TableName> = Database['public']['Tables'][T]['Update']

// Supabase's query builder can't infer column names through generics,
// so column filters use 'as never' and results cast through 'unknown'.

export async function dbSelect<T extends TableName>(
  table: T,
  storeId: string,
): Promise<TableRow<T>[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('store_id' as never, storeId)

  if (error) throw error
  return (data ?? []) as unknown as TableRow<T>[]
}

export async function dbSelectById<T extends TableName>(
  table: T,
  id: string,
): Promise<TableRow<T> | null> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id' as never, id)
    .maybeSingle()

  if (error) throw error
  return data as unknown as TableRow<T> | null
}

export async function dbInsert<T extends TableName>(
  table: T,
  row: TableInsert<T>,
): Promise<TableRow<T>> {
  const { data, error } = await supabase
    .from(table)
    .insert(row as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as TableRow<T>
}

export async function dbUpdate<T extends TableName>(
  table: T,
  id: string,
  changes: TableUpdate<T>,
): Promise<TableRow<T>> {
  const { data, error } = await supabase
    .from(table)
    .update(changes as never)
    .eq('id' as never, id)
    .select()
    .single()

  if (error) throw error
  return data as unknown as TableRow<T>
}

export async function dbDelete(table: TableName, id: string): Promise<void> {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id' as never, id)

  if (error) throw error
}
