function normalizeStoreCode(input: string) {
  const digits = (input ?? '').replace(/\D/g, '') // 숫자만
  if (!digits) return ''
  // 5자리보다 짧으면 앞을 0으로 채움 (2315 -> 02315)
  return digits.length < 5 ? digits.padStart(5, '0') : digits
}
import { supabase } from './supabase'

export type StoreMapRow = {
  store_code: string
  store_name: string
  car_no: string | null
  seq_no: number | null
}

export async function fetchStoreByCode(storeCode: string) {
  const code = normalizeStoreCode(storeCode)
  if (!code) return { row: null as StoreMapRow | null, error: null as any }

  const { data, error } = await supabase
    .from('store_map')
    .select('store_code, store_name, car_no, seq_no')
    .eq('store_code', code)
    .maybeSingle()

  return { row: (data ?? null) as StoreMapRow | null, error }
}

export async function searchStores(query: string) {
  const q = query.trim()
  if (!q) return { rows: [] as StoreMapRow[], error: null as any }

  const { data, error } = await supabase
    .from('store_map')
    .select('store_code, store_name, car_no, seq_no')
    .or(`store_code.ilike.%${q}%,store_name.ilike.%${q}%`)
    .order('store_code', { ascending: true })
    .limit(30)

  return { rows: (data ?? []) as StoreMapRow[], error }
}
