import DateTimePicker from '@react-native-community/datetimepicker'
import { Picker } from '@react-native-picker/picker'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../src/lib/supabase'

type PhotoRow = {
  id: string
  store_code: string
  user_id: string | null
  created_at: string
  original_path: string | null
  original_url: string | null
  status: string | null
}

type StoreMapRow = {
  store_code: string
  store_name: string | null
  car_no: number | null
  seq_no: number | null
}

type GroupRow = {
  store_code: string
  store_name: string
  car_no: number | null
  seq_no: number | null
  count: number
  photos: PhotoRow[]
}

const KST_OFFSET_MIN = 9 * 60

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

// “선택한 날짜의 00:00:00 KST ~ 다음날 00:00:00 KST” 를 UTC ISO로 변환
function kstDayRangeToUtcIso(date: Date) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()

  // KST 00:00
  const kstStart = new Date(y, m, d, 0, 0, 0)
  const kstEnd = new Date(y, m, d + 1, 0, 0, 0)

  // Date 객체는 로컬 타임존 기준이므로 “KST 기준”으로 고정시키기 위해
  // 현재 로컬이 KST가 아닐 수도 있어도 안정적으로 처리: (KST -> UTC) = -9시간
  const startUtc = new Date(kstStart.getTime() - KST_OFFSET_MIN * 60 * 1000)
  const endUtc = new Date(kstEnd.getTime() - KST_OFFSET_MIN * 60 * 1000)

  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() }
}

function formatKstDateTimeLabel(dateIso: string) {
  // created_at(UTC timestamptz) -> KST 표시
  const utc = new Date(dateIso)
  const kst = new Date(utc.getTime() + KST_OFFSET_MIN * 60 * 1000)
  return `${kst.getFullYear()}-${pad2(kst.getMonth() + 1)}-${pad2(kst.getDate())} ${pad2(
    kst.getHours()
  )}:${pad2(kst.getMinutes())}:${pad2(kst.getSeconds())}`
}

export default function ExploreScreen() {
  const listRef = useRef<FlatList<GroupRow>>(null)

  const [loading, setLoading] = useState(false)

  // 날짜 “딱 지정”
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [showDatePicker, setShowDatePicker] = useState(false)

  // 호차 드롭다운
  const [carOptions, setCarOptions] = useState<Array<{ label: string; value: string }>>([
    { label: '전체', value: 'ALL' },
  ])
  const [carFilter, setCarFilter] = useState('ALL')

  // 데이터
  const [groups, setGroups] = useState<GroupRow[]>([])

  // 선택/삭제
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 상세 모달(한 점포 그룹을 눌렀을 때)
  const [modalOpen, setModalOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<GroupRow | null>(null)

  const selectedCount = selectedIds.size

  const dateLabel = useMemo(() => {
    // 네가 원한 표시 느낌(한국시간)
    // “YYYY-MM-DD 00:00:00” 형태로 (해당 날짜 기준)
    const y = selectedDate.getFullYear()
    const m = pad2(selectedDate.getMonth() + 1)
    const d = pad2(selectedDate.getDate())
    return `${y}-${m}-${d} 00:00:00`
  }, [selectedDate])

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const ensureAuth = async () => {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      Alert.alert('auth error', error.message)
      return null
    }
    if (!data.session) {
      Alert.alert('로그인 필요', '세션이 없습니다. 로그인 후 다시 시도하세요.')
      return null
    }
    return data.session
  }

  // 호차 옵션 로드 (store_map에서 distinct car_no)
  const loadCarOptions = async () => {
    // store_map에 car_no가 있으니 여기서 distinct 뽑음
    const { data, error } = await supabase
      .from('store_map')
      .select('car_no')
      .not('car_no', 'is', null)

    if (error) return

    const uniq = Array.from(new Set((data ?? []).map((x: any) => String(x.car_no)))).sort(
      (a, b) => Number(a) - Number(b)
    )

    setCarOptions([{ label: '전체', value: 'ALL' }, ...uniq.map((v) => ({ label: v, value: v }))])
  }

  // 조회: photos + store_map 매핑 후 “점포별 1줄(계정별 여러 장을 한 줄에 묶음)”
  const loadList = async () => {
    const session = await ensureAuth()
    if (!session) return

    setLoading(true)
    try {
      const { startIso, endIso } = kstDayRangeToUtcIso(selectedDate)

      // 1) 해당 날짜 photos 가져오기
      const { data: photoRows, error: photoErr } = await supabase
        .from('photos')
        .select('id, store_code, user_id, created_at, original_path, original_url, status')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: false })

      if (photoErr) throw photoErr

      const photos = (photoRows ?? []) as PhotoRow[]
      if (photos.length === 0) {
        setGroups([])
        return
      }

      // 2) store_map 가져와서 점포명/호차를 붙이기
      const storeCodes = Array.from(new Set(photos.map((p) => p.store_code)))
      const { data: stores, error: storeErr } = await supabase
        .from('store_map')
        .select('store_code, store_name, car_no, seq_no')
        .in('store_code', storeCodes)

      if (storeErr) throw storeErr

      const storeMap = new Map<string, StoreMapRow>()
      ;(stores ?? []).forEach((s: any) => storeMap.set(s.store_code, s as StoreMapRow))

      // 3) 점포별 그룹(= 한 줄) 만들기
      const gmap = new Map<string, GroupRow>()
      for (const p of photos) {
        const meta = storeMap.get(p.store_code)
        const store_name = meta?.store_name ?? '(점포명 없음)'
        const car_no = meta?.car_no ?? null
        const seq_no = meta?.seq_no ?? null

        const key = p.store_code
        if (!gmap.has(key)) {
          gmap.set(key, {
            store_code: p.store_code,
            store_name,
            car_no,
            seq_no,
            count: 0,
            photos: [],
          })
        }
        const g = gmap.get(key)!
        g.count += 1
        g.photos.push(p)
      }

      // 4) 호차 필터
      let out = Array.from(gmap.values())
      if (carFilter !== 'ALL') {
        out = out.filter((g) => String(g.car_no ?? '') === carFilter)
      }

      // 정렬: 호차 → 점포코드
      out.sort((a, b) => {
        const ca = a.car_no ?? 999999
        const cb = b.car_no ?? 999999
        if (ca !== cb) return ca - cb
        return a.store_code.localeCompare(b.store_code)
      })

      setGroups(out)
    } catch (e: any) {
      Alert.alert('조회 오류', e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  // 완전삭제: DB delete + Storage remove
  const deleteSelected = async () => {
    const session = await ensureAuth()
    if (!session) return

    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    Alert.alert('삭제 확인', `선택한 ${ids.length}개를 완전삭제합니다.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setLoading(true)
          try {
            // 1) 삭제할 row 가져오기(경로 확보)
            const { data: rows, error: selErr } = await supabase
              .from('photos')
              .select('id, original_path')
              .in('id', ids)

            if (selErr) throw selErr

            const paths = (rows ?? [])
              .map((r: any) => r.original_path)
              .filter((p: any) => typeof p === 'string' && p.length > 0)

            // 2) 스토리지 파일 삭제
            if (paths.length > 0) {
              const { error: rmErr } = await supabase.storage.from('photos').remove(paths)
              if (rmErr) throw rmErr
            }

            // 3) DB row 삭제
            const { error: delErr } = await supabase.from('photos').delete().in('id', ids)
            if (delErr) throw delErr

            clearSelection()
            await loadList()
            Alert.alert('삭제 완료', '선택 항목을 완전삭제했습니다.')
          } catch (e: any) {
            Alert.alert('삭제 실패', e?.message ?? String(e))
          } finally {
            setLoading(false)
          }
        },
      },
    ])
  }

  useEffect(() => {
    loadCarOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, carFilter])

  const openGroup = (g: GroupRow) => {
    setActiveGroup(g)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setActiveGroup(null)
  }

  const renderThumb = (p: PhotoRow) => {
    const uri = p.original_url ?? ''
    if (!uri) {
      return (
        <View
          key={p.id}
          style={{
            width: 64,
            height: 64,
            borderRadius: 8,
            borderWidth: 1,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 8,
          }}
        >
          <Text style={{ fontSize: 10, opacity: 0.6 }}>NO URL</Text>
        </View>
      )
    }

    const checked = selectedIds.has(p.id)

    return (
      <Pressable
        key={p.id}
        onPress={() => {
          if (selectMode) toggleId(p.id)
          else {
            // 선택모드 아닐 땐 그룹 상세로
            if (activeGroup) return
          }
        }}
        style={{
          width: 64,
          height: 64,
          borderRadius: 8,
          overflow: 'hidden',
          borderWidth: checked ? 2 : 1,
          marginRight: 8,
        }}
      >
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        {selectMode && (
          <View
            style={{
              position: 'absolute',
              right: 6,
              top: 6,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: checked ? '#111' : 'rgba(255,255,255,0.9)',
              borderWidth: 1,
            }}
          />
        )}
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* 상단 필터: 날짜/호차 반반 */}
      <View style={{ padding: 14, gap: 10 }}>
        <Text style={{ fontSize: 22, fontWeight: '800' }}>업로드 목록 조회</Text>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {/* 날짜 (반) */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>날짜</Text>
            <TouchableOpacity
              onPress={() => setShowDatePicker(true)}
              style={{
                borderWidth: 1,
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 12,
                minHeight: 46,
                justifyContent: 'center',
              }}
            >
              <Text>{dateLabel}</Text>
            </TouchableOpacity>
          </View>

          {/* 호차 (반) */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>호차</Text>
            <View
              style={{
                borderWidth: 1,
                borderRadius: 10,
                minHeight: 46,
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <Picker
                selectedValue={carFilter}
                onValueChange={(v) => setCarFilter(String(v))}
                style={{
                  height: Platform.select({ ios: 160, android: 46 }),
                }}
              >
                {carOptions.map((o) => (
                  <Picker.Item key={o.value} label={o.label} value={o.value} />
                ))}
              </Picker>
            </View>
          </View>
        </View>

        {/* 선택/삭제 바 (길게누르기 제거: 버튼으로 선택모드) */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            onPress={() => {
              setSelectMode((v) => !v)
              clearSelection()
            }}
            style={{
              flex: 1,
              borderWidth: 1,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontWeight: '700' }}>
              {selectMode ? `선택 모드 ON (${selectedCount})` : '선택 모드'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={deleteSelected}
            disabled={!selectMode || selectedCount === 0 || loading}
            style={{
              flex: 1,
              borderWidth: 1,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: 'center',
              opacity: !selectMode || selectedCount === 0 || loading ? 0.35 : 1,
            }}
          >
            <Text style={{ fontWeight: '700' }}>선택 삭제(완전삭제)</Text>
          </TouchableOpacity>
        </View>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            if (Platform.OS !== 'ios') setShowDatePicker(false)
            if (event.type === 'dismissed') return
            if (date) setSelectedDate(date)
          }}
        />
      )}

      {Platform.OS === 'ios' && showDatePicker && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <TouchableOpacity
            onPress={() => setShowDatePicker(false)}
            style={{
              borderWidth: 1,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontWeight: '700' }}>날짜 적용</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={{ paddingVertical: 10 }}>
          <ActivityIndicator />
        </View>
      )}

      {/* 리스트: “점포별 1줄 + 썸네일 미리보기” */}
      <FlatList
        ref={listRef}
        data={groups}
        keyExtractor={(item) => item.store_code}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        renderItem={({ item }) => {
          // 썸네일 최대 6개만 보여줌
          const thumbs = item.photos.slice(0, 6)

          return (
            <TouchableOpacity
              onPress={() => openGroup(item)}
              activeOpacity={0.9}
              style={{
                borderWidth: 1,
                borderRadius: 14,
                padding: 12,
                marginBottom: 12,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800' }}>
                    [{item.store_code}] {item.store_name}
                  </Text>
                  <Text style={{ opacity: 0.8 }}>
                    호차: {item.car_no ?? '-'} / 순번: {item.seq_no ?? '-'} / 총 {item.count}장
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {thumbs.map(renderThumb)}
                {item.count > thumbs.length && (
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 8,
                      borderWidth: 1,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontWeight: '800' }}>+{item.count - thumbs.length}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          <View style={{ paddingTop: 30, alignItems: 'center' }}>
            <Text style={{ opacity: 0.7 }}>해당 날짜/호차 조건에 데이터가 없습니다.</Text>
          </View>
        }
      />

      {/* 상세 모달: “닫기 버튼 고정 + 스크롤해도 위로 튀지 않게” */}
      <Modal visible={modalOpen} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={{ flex: 1, margin: 14, backgroundColor: '#fff', borderRadius: 16 }}>
              {/* 닫기 버튼: 항상 상단 고정 */}
              <View
                style={{
                  padding: 12,
                  borderBottomWidth: 1,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '900', fontSize: 16 }}>
                    {activeGroup ? `[${activeGroup.store_code}] ${activeGroup.store_name}` : '상세'}
                  </Text>
                  <Text style={{ opacity: 0.7, marginTop: 2 }}>
                    {activeGroup ? `총 ${activeGroup.count}장` : ''}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={closeModal}
                  style={{
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ fontWeight: '800' }}>닫기</Text>
                </TouchableOpacity>
              </View>

              {/* 본문 */}
              <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
                {/* 선택/삭제 안내 */}
                <View
                  style={{
                    borderWidth: 1,
                    borderRadius: 12,
                    padding: 10,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ fontWeight: '800' }}>선택/삭제</Text>
                  <Text style={{ opacity: 0.75, marginTop: 4 }}>
                    상단의 “선택 모드”를 켜고 썸네일을 탭해서 선택한 뒤 삭제하세요.
                  </Text>
                </View>

                {/* 사진 그리드 */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {(activeGroup?.photos ?? []).map((p) => {
                    const uri = p.original_url ?? ''
                    const checked = selectedIds.has(p.id)

                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => {
                          if (selectMode) toggleId(p.id)
                          else {
                            // 선택모드 아니면 그냥 크게 보기(간단)
                            if (!uri) return
                            Alert.alert('업로드 시간(KST)', formatKstDateTimeLabel(p.created_at))
                          }
                        }}
                        style={{
                          width: '31.5%',
                          aspectRatio: 1,
                          borderRadius: 10,
                          overflow: 'hidden',
                          borderWidth: checked ? 2 : 1,
                        }}
                      >
                        {uri ? (
                          <Image
                            source={{ uri }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{
                              width: '100%',
                              height: '100%',
                              justifyContent: 'center',
                              alignItems: 'center',
                            }}
                          >
                            <Text style={{ fontSize: 10, opacity: 0.6 }}>NO URL</Text>
                          </View>
                        )}

                        {selectMode && (
                          <View
                            style={{
                              position: 'absolute',
                              right: 6,
                              top: 6,
                              width: 18,
                              height: 18,
                              borderRadius: 9,
                              backgroundColor: checked ? '#111' : 'rgba(255,255,255,0.9)',
                              borderWidth: 1,
                            }}
                          />
                        )}
                      </Pressable>
                    )
                  })}
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
