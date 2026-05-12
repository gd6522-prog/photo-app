import { Buffer } from 'buffer'
import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'

type UploadOneResult = {
  ok: boolean
  path?: string
  publicUrl?: string
  error?: string
}

function normalizeStoreCode(code: string) {
  const digits = (code ?? '').replace(/\D/g, '')
  return digits.length < 5 ? digits.padStart(5, '0') : digits.slice(0, 5)
}

function getExt(uri: string) {
  const clean = uri.split('?')[0]
  const ext = clean.split('.').pop()?.toLowerCase()
  if (!ext) return 'jpg'
  if (ext === 'jpeg') return 'jpg'
  return ext
}

function guessContentType(ext: string) {
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'image/jpeg'
}

function safePath(storeCode: string, fileName: string) {
  // Supabase Storage는 path가 '/'로 시작하면 안 됨
  const sc = normalizeStoreCode(storeCode)
  const name = fileName.replace(/[^\w.\-]/g, '_') // 공백/특수문자 방지
  return `${sc}/${name}`
}

async function readFileAsUint8Array(uri: string) {
  // legacy API 사용(경고/EncodingType 문제 해결)
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/**
 * 한 장 업로드(스토리지 업로드 + photos 테이블 기록)
 * photos 테이블 컬럼 기준(네 스샷):
 * - user_id (uuid)
 * - store_code (text)
 * - original_path (text)
 * - original_url (text)
 * - created_at (자동)
 * - status (있으면 기본값 쓰도록 여기선 안 넣음)
 */
export async function uploadOnePhoto(params: {
  uri: string
  storeCode: string
  userId: string
  bucket?: string // default: 'photos'
}): Promise<UploadOneResult> {
  const bucket = params.bucket ?? 'photos'
  const storeCode = normalizeStoreCode(params.storeCode)
  const uri = params.uri

  if (!storeCode || storeCode.length !== 5) {
    return { ok: false, error: 'storeCode(5자리)가 올바르지 않습니다.' }
  }
  if (!uri) {
    return { ok: false, error: '이미지 URI가 없습니다.' }
  }

  try {
    const ext = getExt(uri)
    const contentType = guessContentType(ext)
    const fileName = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`
    const path = safePath(storeCode, fileName)

    const bytes = await readFileAsUint8Array(uri)

    // 1) Storage 업로드
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, bytes, { contentType, upsert: false })

    if (upErr) {
      return { ok: false, error: `Storage 업로드 실패: ${upErr.message}` }
    }

    // 2) Public URL
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path)
    const publicUrl = pub?.publicUrl
    if (!publicUrl) {
      return { ok: false, error: 'Public URL 생성 실패' }
    }

    // 3) DB insert (네 테이블 컬럼명에 맞춤)
    const payload = {
      user_id: params.userId,
      store_code: storeCode,
      original_path: path,
      original_url: publicUrl,
    }

    const { error: insErr } = await supabase.from('photos').insert(payload)
    if (insErr) {
      return { ok: false, error: `DB insert 실패: ${insErr.message}` }
    }

    return { ok: true, path, publicUrl }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

/**
 * 일반 작업자 기능(긴급출고 회신, 체화재고 응답)용 사진 1장 업로드.
 *
 * uploadOnePhoto 와 달리: store_code 가 5자리가 아닐 수도 있어(체화재고는 점포 X) 정규화하지 않고
 * 받은 값 그대로 저장하고, photos 테이블에 work_part / category 까지 함께 적재한 뒤 row id 를 돌려준다.
 * /admin/photos 페이지는 category='field' 기준으로 자연 노출되므로 기본 category='field' 사용.
 */
export async function uploadWorkerPhoto(params: {
  uri: string;
  userId: string;
  storeCode?: string | null;
  workPart?: string | null;
  category?: string | null;
  bucket?: string;
}): Promise<{ ok: boolean; photoId?: string; publicUrl?: string; path?: string; error?: string }> {
  const bucket = params.bucket ?? "photos";
  const uri = params.uri;
  if (!uri) return { ok: false, error: "이미지 URI가 없습니다." };
  if (!params.userId) return { ok: false, error: "사용자 정보가 없습니다." };

  try {
    const ext = getExt(uri);
    const contentType = guessContentType(ext);
    const fileName = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const folder = params.storeCode ? normalizeStoreCode(params.storeCode) : "misc";
    const path = `${folder}/${fileName.replace(/[^\w.\-]/g, "_")}`;

    const bytes = await readFileAsUint8Array(uri);
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, bytes, { contentType, upsert: false });
    if (upErr) return { ok: false, error: `Storage 업로드 실패: ${upErr.message}` };

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) return { ok: false, error: "Public URL 생성 실패" };

    const payload: Record<string, any> = {
      user_id: params.userId,
      original_path: path,
      original_url: publicUrl,
      category: params.category ?? "field",
    };
    if (params.storeCode) payload.store_code = normalizeStoreCode(params.storeCode);
    if (params.workPart) payload.work_part = params.workPart;

    const { data: inserted, error: insErr } = await supabase
      .from("photos")
      .insert(payload)
      .select("id")
      .single();
    if (insErr) return { ok: false, error: `DB insert 실패: ${insErr.message}` };

    return { ok: true, photoId: (inserted as any)?.id, publicUrl, path };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * 여러 장 업로드
 */
export async function uploadManyPhotos(params: {
  uris: string[]
  storeCode: string
  userId: string
  bucket?: string
}) {
  const results: UploadOneResult[] = []
  for (const uri of params.uris) {
    const r = await uploadOnePhoto({
      uri,
      storeCode: params.storeCode,
      userId: params.userId,
      bucket: params.bucket,
    })
    results.push(r)
  }

  const success = results.filter((r) => r.ok).length
  const fail = results.length - success
  return { success, fail, results }
}
