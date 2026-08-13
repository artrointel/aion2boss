export const FIELD_BOSS_CACHE_URLS = [
  'https://raw.githubusercontent.com/Not4You-Dev/NotMeter-Update/main/presence/notmeter-field-boss-public.json',
  'https://cdn.jsdelivr.net/gh/Not4You-Dev/NotMeter-Update@main/presence/notmeter-field-boss-public.json'
]

export const FIELD_BOSS_CACHE_SCHEMA = 'notmeter-field-boss-public-cache-v1'
export const DEFAULT_FIELD_BOSS_SERVER_ID = 1001
export const FIELD_BOSS_CACHE_SYNC_INTERVAL_MS = 30 * 1000
const FIELD_BOSS_CACHE_FETCH_TIMEOUT_MS = 5000

const SERVER_NAMES_ELYOS = [
  '시엘', '네자칸', '바이젤', '카이시넬', '유스티엘', '아리엘', '프레기온', '메스람타에다',
  '히타니에', '나니아', '타하바타', '루터스', '페르노스', '다미누', '카사카', '바카르마',
  '챈가룽', '코치룽', '이슈타르', '티아마트', '포에타', '베르테론', '나트하라', '탈리스라',
  '주미온', '나히드', '아사르', '칼리드', '라세이스', '페리온', '드라마타', '레다', '아울도르',
  '바크론', '나룬', '가르투아', '클로리스', '이오네', '테이나', '디모네스', '바고트', '아테론',
  '루틸리스', '실리아토르', '이드리스', '사티아', '에스티안', '라후', '라누만', '히브란',
  '우라훔', '라크슈미', '타몬', '티에', '두두리', '데르코스', '둔둔몽', '홀리아울'
]

const SERVER_NAMES_ASMODIAN = [
  '이스라펠', '지켈', '트리니엘', '루미엘', '마르쿠탄', '아스펠', '에레슈키갈', '브리트라',
  '네몬', '하달', '루드라', '울고른', '무닌', '오다르', '젠카카', '크로메데', '콰이링',
  '바바룽', '파프니르', '인드나흐', '이스할겐', '알트가르드', '아그니타', '아티엘', '발데마르',
  '라그타', '게로드', '우르드', '에코', '지젤', '카샤파', '스토프', '베르크', '누아쿰',
  '그리실라', '산트라스', '루벤', '휴고', '크라키', '히스탄', '라트만', '시게베르트',
  '나즈문', '겔코스', '파톤', '펠레이르', '엘비다', '케투', '파이디온', '노툰', '무르트',
  '로탄', '쿠하푸', '두안카', '브로크', '왈터', '푸라킨', '이그누스'
]

export const FIELD_BOSS_SERVERS = [
  ...SERVER_NAMES_ELYOS.map((name, index) => ({ serverId: 1001 + index, name, faction: '천족' })),
  ...SERVER_NAMES_ASMODIAN.map((name, index) => ({ serverId: 2001 + index, name, faction: '마족' }))
]

export const FIELD_BOSS_REGIONS = [
  {
    key: 'verteron',
    name: '베르테론',
    bosses: [
      [2100040, '썩은 쿠타르'], [2100076, '광투사 쿠산'], [2100003, '동쪽의 네이켈'], [2100050, '서쪽의 케르논'],
      [2100077, '제사장 가르심'], [2100079, '호위병 티간트'], [2100141, '만개한 코린'], [2100177, '분노한 사루스'],
      [2100178, '피송곳니 프닌'], [2100582, '배교자 레일라'], [2100617, '검은 촉수 라와'], [2100661, '환몽의 카시아'],
      [2100708, '백부장 데미로스'], [2100718, '신성한 안사스'], [2100876, '수확관리자 모샤브'], [2100877, '감시병기 크나쉬'],
      [2100988, '학자 라울라'], [2100989, '숲전사 우라무'], [2100991, '추격자 타울로'], [2101016, '연구관 세트람'],
      [2101074, '영원의 가르투아'], [2101120, '침묵의 타르탄'], [2101122, '영혼 지배자 카샤파'], [2101131, '군단장 라그타']
    ]
  },
  {
    key: 'altgard',
    name: '알트가르드',
    bosses: [
      [2400017, '녹아내린 다나르'], [2400074, '검은 전사 아에드'], [2400140, '충실한 라지트'], [2400141, '광전사 발그'],
      [2400212, '포식자 가르산'], [2400223, '혈전사 란나르'], [2400274, '기만자 트리드'], [2400335, '푸른물결 켈피나'],
      [2400353, '총감독관 누타'], [2400358, '참모관 르사나'], [2400419, '별동대장 링크스'], [2400424, '모독자 노블루드'],
      [2400425, '망혼의 아칸 악시오스'], [2400474, '중독된 하디룬'], [2400504, '처형자 바르시엔'], [2400593, '드라칸 부대병기 구루타'],
      [2400607, '백전노장 슈자칸'], [2400608, '비전의 카루카'], [2400659, '흑암의 비슈베다'], [2400709, '예리한 쉬라크'],
      [2400800, '불멸의 가르투아'], [2400853, '군단장 라그타'], [2400854, '영혼 지배자 카샤파'], [2400855, '침묵의 타르탄']
    ]
  },
  {
    key: 'eltnen',
    name: '엘테넨',
    bosses: [
      [2101217, '응집된 베레놈'], [2101218, '옛 두목 비고르'], [2101257, '꺾인 날개 츠바인'], [2101278, '탐욕의 이게티스'],
      [2101279, '생명의 신수 수페르비아'], [2101306, '썩은 뿌리 멜트림'], [2101349, '맹목적인 니호그'], [2101350, '최초의 실험체 크티마'],
      [2101415, '세 개의 뿔 마이노'], [2101416, '고통의 람푸스'], [2101600, '3부대장 카르코티'], [2101601, '부군단장 비바츠라']
    ]
  },
  {
    key: 'morheim',
    name: '모르헤임',
    bosses: [
      [2406034, '경계의 방랑자 파르곤'], [2406035, '포식의 거수 발라크'], [2406071, '핏빛 눈보라 레눌프'], [2406093, '서리갑옷 하르칸'],
      [2406094, '푸른 눈물 글레이시아'], [2406129, '업화의 날개 피오스'], [2406131, '용암심장 바투'], [2406132, '정예 심문관 브란트'],
      [2406181, '미쳐버린 파수꾼 불라간'], [2406182, '화산 군주 그림니르'], [2406990, '3부대장 미나사라'], [2406991, '부군단장 사르바카']
    ]
  },
  {
    key: 'abyss-lower',
    name: '어비스 하층',
    bosses: [
      [2600068, '정령왕 아그로'], [2600089, '감시자 카이라'], [2600084, '수호신장 나흐마'], [2600093, '수호신장 나흐마'],
      [2600094, '수호신장 나흐마'], [2600096, '집행자 타마사'], [2600097, '집행자 아그로'], [2600098, '집행자 카이라']
    ]
  },
  {
    key: 'abyss-middle',
    name: '어비스 중층',
    bosses: [
      [2600150, '분노한 수호신장 나흐마'], [2600156, '분노한 수호신장 나흐마'], [2600520, '처형관 드라모스'],
      [2600521, '반역자 듀칼'], [2600522, '파멸자 마라카']
    ]
  }
]

export const FIELD_BOSS_OPTIONS = FIELD_BOSS_REGIONS.flatMap((region, regionIndex) =>
  region.bosses.map(([bossCode, name]) => ({
    regionIndex,
    regionName: region.name,
    bossCode,
    name
  }))
)

export function normalizeFieldBossServerId(value) {
  const serverId = Math.trunc(Number(value))
  return FIELD_BOSS_SERVERS.some((server) => server.serverId === serverId)
    ? serverId
    : DEFAULT_FIELD_BOSS_SERVER_ID
}

export function findFieldBossOption(regionIndex, bossCode) {
  const region = Math.trunc(Number(regionIndex))
  const code = Math.trunc(Number(bossCode))
  return FIELD_BOSS_OPTIONS.find((option) =>
    option.regionIndex === region && option.bossCode === code) || null
}

export function findFieldBossTarget(cache, serverId, regionIndex, bossCode) {
  const server = cache?.servers?.find((item) => Number(item.serverId) === Number(serverId))
  const region = server?.regions?.find((item) => Number(item.region) === Number(regionIndex))
  const entry = region?.entries?.find((item) => Number(item.bossCode) === Number(bossCode))
  const targetAt = Number(entry?.targetAt)
  return Number.isSafeInteger(targetAt) && targetAt > 0 ? targetAt : null
}

async function fetchFieldBossPublicCacheFromUrl(baseUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FIELD_BOSS_CACHE_FETCH_TIMEOUT_MS)
  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const cache = await response.json()
    if (cache?.schema !== FIELD_BOSS_CACHE_SCHEMA || Number(cache.version) !== 1 || !Array.isArray(cache.servers)) {
      throw new Error('invalid cache')
    }
    return cache
  } catch (error) {
    throw new Error(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchFieldBossPublicCache() {
  try {
    return await Promise.any(FIELD_BOSS_CACHE_URLS.map(fetchFieldBossPublicCacheFromUrl))
  } catch (error) {
    const errors = error instanceof AggregateError
      ? error.errors.map((item) => item instanceof Error ? item.message : String(item))
      : [error instanceof Error ? error.message : String(error)]
    throw new Error(errors.join(' / '))
  }
}
