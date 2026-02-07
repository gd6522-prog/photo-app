import { supabase } from './supabase'

export type PhotoListRow = {
  id: string
  created_at: string
  user_id: string | null
  status: string | null
  original_path: string | null
  original_url: string | null
  store_code: string | null
  store_name: string | null
  car_no: string | null
  seq_no: number | null
}

export async function fetchPhotos(params: {
  startISO?: string // 예: 2026-01-23T00:00:00.000Z
  endISO?: string   // 예: 2026-01-23T23:59:59.999Z
  carNo?: string
  storeQuery?: string // store_code 또는 store_name 검색
  limit?: number
}) {
  const { startISO, endISO, carNo, storeQuery, limit = 200 } = params

  let q = supabase
    .from('photo_list_view')
    .select('*')
    // 정렬: 1) 일자(created_at) 2) 호차(car_no) 3) 점포(store_code)
    .order('created_at', { ascending: false })
    .order('car_no', { ascending: true })
    .order('store_code', { ascending: true })
    .limit(limit)

  if (startISO) q = q.gte('created_at', startISO)
  if (endISO) q = q.lte('created_at', endISO)

  if (carNo && carNo.trim()) q = q.eq('car_no', carNo.trim())

  if (storeQuery && storeQuery.trim()) {
    const s = storeQuery.trim().replace(/"/g, '\\"')
    // store_code OR store_name
    q = q.or(`store_code.ilike."%${s}%",store_name.ilike."%${s}%"`)
  }

  const { data, error } = await q
  return { rows: (data ?? []) as PhotoListRow[], error }
}
