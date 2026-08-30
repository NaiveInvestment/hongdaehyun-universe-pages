const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// 실행 모드. 라이브 서버는 /api/*, 정적 배포본은 빌드된 상대경로 JSON을 읽는다.
// 정적 배포본은 index.html의 <script src="app.js?mode=static"> 로만 구분한다(추가 요청 없음).
const RUNTIME = (() => {
  const staticMode = new URL(import.meta.url).searchParams.get("mode") === "static";
  return {
    staticMode,
    snapshotUrl: staticMode ? "data/snapshot.json" : "/api/snapshot",
    // 2026-08-27: 공개 정적본은 시세만 담긴 가벼운 델타를 자주 읽고, 무거운 스냅샷은 바뀔 때만 다시 받는다.
    // 전체 산출물 6.8MB 중 시세로 바뀌는 부분은 94KB뿐이라 매번 전부 받을 이유가 없다.
    quotesUrl: staticMode ? "data/quotes.json" : null,
    stockUrl: (code) => (staticMode ? `data/stocks/${code}.json` : `/api/stocks/${code}`),
  };
})();

// ---------------------------------------------------------------------------
// 정본 상수
// ---------------------------------------------------------------------------
const SECTOR_ORDER = ["금융", "보험", "증권", "지주", "AI/SW", "정유", "화학", "희토류"];
// universe.js의 HOME_SECTOR_GROUPS와 같은 묶음. 홈 비교 차트에서만 4그룹으로 압축한다.
const HOME_GROUPS = [
  { label: "금융·지주·보험·증권", short: "금융권", sectors: ["금융", "지주", "보험", "증권"] },
  { label: "AI/SW", short: "AI/SW", sectors: ["AI/SW"] },
  { label: "정유·화학", short: "정유화학", sectors: ["정유", "화학"] },
  { label: "희토류", short: "희토류", sectors: ["희토류"] },
];
const KOSDAQ_CODES = new Set(["093320", "067160", "124500", "030520", "042000", "078020", "127120"]);
// 2026-08-26 확정: 연간 컨센서스는 3개(26E·27E·28E)까지 보여준다. 2025는 확정 실적 비교용이다.
const ANNUALS = [["2024", "2024"], ["2025", "2025"], ["2026", "2026E"], ["2027", "2027E"], ["2028", "2028E"]];
// 분기는 확정 실적 8개 + 추정 4개.
const QUARTER_ESTIMATE_COUNT = 4;
const QUARTER_HISTORY_COUNT = 4;
const SOURCE_LABELS = { quote: "시세", actuals: "공시", consensus: "컨센서스" };
const HORIZON_LABELS = { oneMonth: "1M 평균", threeMonth: "3M 평균", highest: "3M 최고" };
// 2026-08-27 사용자 결정: 섹터 지수는 YTD 기준으로 본다. 원래 3M·6M·1Y뿐이라 YTD가 아예 없었다.
// "ytd"는 거래일 개수가 아니라 날짜로 자르므로 windowSlice가 따로 처리한다.
// 2026-08-30 사용자 결정: 1Y를 빼고 1M을 넣었다. 거래일 기준 1M≈21 · 3M≈62 · 6M≈124일.
const RANGES = [["ytd", "YTD"], [21, "1M"], [62, "3M"], [124, "6M"]];
const RETURN_HEAT_CAPS = {
  d1: { positive: 10, negative: 5 },
  d5: { positive: 20, negative: 10 },
  d20: { positive: 50, negative: 25 },
  ytd: { positive: 200, negative: 100 },
  y1: { positive: 200, negative: 100 },
  targetGap: { positive: 50, negative: 25 },
  // MDD는 0(신고가)에서 아래로만 간다. 음수 쪽만 색을 쓴다.
  ytdDrawdown: { positive: 1, negative: 40 },
};
const THEME_STORAGE_KEY = "hongdaehyun-universe:theme-v1";
const COLUMN_GROUP_STORAGE_KEY = "hongdaehyun-universe:column-groups-v1";
const ESTIMATE_BASIS_STORAGE_KEY = "hongdaehyun-universe:estimate-basis-v1";

// 섹터별 트래킹 지표 — 2026-08-23 실접속으로 확인한 원천 "후보"다. 정본은 docs/indicator-sources.md.
// 원천이 확정되기 전까지는 값을 만들지 않고 대기 카드로만 노출한다(예시 수치 금지).
const INDICATOR_CATALOG = {
  // 금융은 2026-08-27에 원천이 확정됐다(전부 ECOS). 값이 실려 오면 아래 대기 카드 대신 실제 타일이 뜬다.
  "금융": [
    { name: "국고채 3년", source: "한은 ECOS 817Y002", cycle: "일", state: "fixed" },
    { name: "기준금리", source: "ECOS 722Y001", cycle: "일", state: "fixed" },
    { name: "예대금리차", source: "ECOS 121Y006·121Y002 / 121Y015·121Y013", cycle: "월", state: "fixed" },
    { name: "은행 연체율", source: "ECOS 901Y054", cycle: "월", state: "fixed" },
    { name: "산금채 1년", source: "ECOS 817Y002", cycle: "일", state: "fixed" },
  ],
  "보험": [
    { name: "K-ICS 비율 (사별)", source: "FISIS", cycle: "분기", state: "auto" },
    { name: "생보 수입보험료", source: "생명보험협회", cycle: "월", state: "auto" },
    { name: "손보 원수보험료", source: "손해보험협회", cycle: "분기", state: "auto" },
    { name: "국고채 10년·20년", source: "한은 ECOS 817Y002", cycle: "일", state: "auto" },
    { name: "자동차보험 손해율", source: "무료 원천 없음", cycle: "월", state: "paid" },
    { name: "CSM (사별)", source: "무료 원천 없음", cycle: "분기", state: "paid" },
  ],
  "증권": [
    { name: "거래대금·회전율", source: "KRX Open API", cycle: "일", state: "auto" },
    { name: "신용융자 잔고", source: "금투협 FreeSIS", cycle: "일", state: "auto" },
    { name: "해외주식 결제금액", source: "SEIBro", cycle: "월", state: "auto" },
    { name: "ELS 발행액", source: "data.go.kr", cycle: "월", state: "auto" },
    { name: "IPO 공모규모", source: "KIND", cycle: "월", state: "auto" },
  ],
  "지주": [
    { name: "상장 자회사 지분가치", source: "OpenDART otrCprInvstmntSttus", cycle: "분기", state: "auto" },
    { name: "자사주 비율", source: "OpenDART", cycle: "수시", state: "auto" },
    { name: "배당성향", source: "OpenDART", cycle: "연", state: "auto" },
    { name: "밸류업 공시", source: "KIND", cycle: "수시", state: "auto" },
  ],
  "AI/SW": [
    { name: "해외 AI 대형주", source: "Yahoo chart JSON", cycle: "일", state: "auto" },
    { name: "빅테크 CAPEX", source: "Epoch AI", cycle: "분기", state: "auto" },
    { name: "온라인쇼핑 거래액", source: "KOSIS", cycle: "월", state: "auto" },
    { name: "공공 SW 발주", source: "나라장터 API", cycle: "월", state: "auto" },
    { name: "앱 MAU", source: "모바일인덱스 (일부 유료)", cycle: "월", state: "paid" },
  ],
  "정유": [
    { name: "두바이·브렌트", source: "오피넷 · EIA API", cycle: "일", state: "auto" },
    { name: "싱가포르 제품가·크랙", source: "오피넷 CSV 자체 산출", cycle: "일", state: "auto" },
    { name: "미국 주간 재고", source: "EIA API", cycle: "주", state: "auto" },
    { name: "복합정제마진", source: "Platts (무료 없음)", cycle: "주", state: "paid" },
    { name: "사우디 OSP", source: "Reuters 기사 파싱", cycle: "월", state: "auto" },
  ],
  "화학": [
    { name: "나프타", source: "페트로넷", cycle: "일", state: "auto" },
    { name: "에틸렌·PE·PP 중국 현물", source: "SunSirs", cycle: "일", state: "auto" },
    { name: "폴리실리콘", source: "InfoLink", cycle: "주", state: "auto" },
    { name: "품목별 수출", source: "관세청 API", cycle: "월", state: "auto" },
    { name: "중국 제조업 PMI", source: "NBS", cycle: "월", state: "auto" },
  ],
  "희토류": [
    { name: "NdPr 산화물", source: "생의사 100ppi", cycle: "일", state: "auto" },
    { name: "Dy 산화물", source: "생의사 100ppi", cycle: "일", state: "auto" },
    { name: "ACREI 희토류 지수", source: "ACREI", cycle: "월", state: "auto" },
    { name: "중국 수출량", source: "GACC", cycle: "월", state: "auto" },
    { name: "NdFeB 자석가", source: "무료 원천 없음", cycle: "월", state: "paid" },
  ],
};

const state = {
  snapshot: null,
  search: "",
  sector: "all",
  sortKey: "default",
  sortDirection: "desc",
  detail: null,
  detailCode: null,
  detailLoading: false,
  columnGroups: new Set(),
  // 컨센서스 값을 무엇으로 볼지. 1M 평균 · 3M 평균(기본) · 최고 추정치.
  estimateBasis: "threeMonth",
  range: "ytd",
  theme: "dark",
  liveUpdates: new Map(),
  tableScrollLeft: 0,
  tableScrollTop: 0,
};

// ---------------------------------------------------------------------------
// 저장소 · 테마
// ---------------------------------------------------------------------------
function readStorage(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* 저장소가 막혀도 현재 세션 선택은 그대로 유지한다. */ }
}

function loadPreferences() {
  const theme = readStorage(THEME_STORAGE_KEY);
  state.theme = theme === "light" ? "light" : "dark";
  try {
    const saved = JSON.parse(readStorage(COLUMN_GROUP_STORAGE_KEY) || "[]");
    state.columnGroups = new Set(Array.isArray(saved) ? saved.filter((key) => OPTIONAL_COLUMN_GROUPS.some((group) => group.key === key)) : []);
  } catch {
    state.columnGroups = new Set();
  }
  const basis = readStorage(ESTIMATE_BASIS_STORAGE_KEY);
  state.estimateBasis = ESTIMATE_BASES.some(({ key }) => key === basis) ? basis : "threeMonth";
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const button = $("#themeToggle");
  if (button) {
    button.setAttribute("aria-pressed", String(state.theme === "light"));
    button.textContent = state.theme === "light" ? "◐ 다크로 전환" : "◐ 라이트로 전환";
  }
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  writeStorage(THEME_STORAGE_KEY, state.theme);
  applyTheme();
}

// ---------------------------------------------------------------------------
// 포맷터
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function numberClass(value) {
  if (value == null || !Number.isFinite(value)) return "na";
  return value > 0 ? "positive" : value < 0 ? "negative" : "";
}

function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPrice(value) {
  return value == null || !Number.isFinite(value) ? "-" : Math.round(value).toLocaleString("ko-KR");
}

function formatPriceWithUnit(value) {
  return value == null ? "-" : `${formatPrice(value)}원`;
}

function formatMarketCap(value) {
  return value == null || !Number.isFinite(value) ? "-" : `${formatNumber(value)}억원`;
}

function formatFinancial(value) {
  if (value == null || !Number.isFinite(value)) return "-";
  const digits = Math.abs(value) < 100 && !Number.isInteger(value) ? 1 : 0;
  return formatNumber(value, digits);
}

function formatPercent(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;
}

function formatSignedNumber(value) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatRatio(result, kind) {
  if (!result || result.status === "na") return "-";
  if (result.status === "nm") return "N/M";
  const digits = kind === "roe" ? 1 : 2;
  return `${Number(result.value).toFixed(digits)}${kind === "roe" ? "%" : "x"}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "갱신 이력 없음";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function quarterLabel(period) {
  const match = /^(\d{4})Q([1-4])$/.exec(String(period || ""));
  return match ? `${match[2]}Q${match[1].slice(2)}` : String(period || "-");
}

function marketForStock(stock) {
  return stock.market || (KOSDAQ_CODES.has(stock.code) ? "KOSDAQ" : "KOSPI");
}

function sourceStatus(source, key = null) {
  if (!source) return { label: "미적재", className: "not_loaded" };
  if (source.status === "fixture") return { label: "FIXTURE", className: "fixture" };
  if (source.status === "not_configured") return { label: "미설정", className: "not_configured" };
  if (source.status === "error") return { label: "오류", className: "error" };
  if (source.status === "partial") return { label: "일부", className: "partial" };
  // KRX가 닫혀 있어도 NXT는 08~20시에 돈다. 체결이 계속 들어오면 "NXT 시간외", 아니면 "장마감"이다.
  if (key === "quote" && source.krxSession === false && !source.stale) {
    const age = Date.now() - (Date.parse(source.updatedAt || 0) || 0);
    return age < 5 * 60 * 1000
      ? { label: "NXT 시간외", className: "nxt" }
      : { label: "장마감", className: "closed" };
  }
  if (key === "quote" && source.marketOpen === false && !source.stale) return { label: "장마감", className: "closed" };
  if (source.stale) return { label: "STALE", className: "stale" };
  if (source.delayed) return { label: "지연", className: "stale" };
  // 토스는 실시간이지만 KRX 정규장이 아니라 통합시세다. LIVE로 뭉뚱그리지 않는다.
  if (key === "quote" && String(source.source || "").toLowerCase() === "toss") return { label: "통합시세", className: "ok" };
  if (key === "quote") return { label: "LIVE", className: "ok" };
  return { label: "정상", className: "ok" };
}

function sourceDisplayName(key, sourceName) {
  const source = String(sourceName || "").trim();
  if (key === "quote" && source.toLowerCase() === "kiwoom") return "Kiwoom KRX 실시간";
  if (key === "quote" && source.toLowerCase() === "toss") return "토스 통합시세(KRX+NXT)";
  if (key === "quote" && source.toLowerCase() === "naver") return "Naver KRX 지연";
  return source || "미적재";
}

function sourceLine(keys) {
  return keys.map((key) => {
    const source = state.snapshot?.sources?.[key] || {};
    const status = sourceStatus(source, key);
    return `${SOURCE_LABELS[key]} ${escapeHtml(sourceDisplayName(key, source.source))} · ${formatTimestamp(source.updatedAt)} · ${status.label}`;
  }).join(" / ");
}

function returnHeatMeta(value, key) {
  const caps = RETURN_HEAT_CAPS[key];
  if (!caps || !Number.isFinite(value) || value === 0) return { className: "", weight: 0, bucket: 0 };
  const direction = value > 0 ? "positive" : "negative";
  const weight = Math.max(1, Math.round(Math.min(Math.abs(value) / caps[direction], 1) * 100));
  const bucket = Math.min(100, Math.ceil(weight / 5) * 5);
  const level = weight >= 60 ? "heat-strong" : weight >= 25 ? "heat-medium" : "heat-soft";
  return { className: `return-heat heat-${direction} heat-weight-${bucket} ${level}`, weight, bucket };
}

// ---------------------------------------------------------------------------
// 표 컬럼 모델 (2026-08-25 확정: 코어 열 상시 + 나머지는 열그룹 칩)
// pending 열은 아직 원천이 없다. 빈 칸을 만들지 않으려고 DOM에 넣지 않고 표 아래 안내로만 알린다.
// ---------------------------------------------------------------------------
// 2026-08-30: 칩 하나가 표를 통째로 바꾼다. 열을 몇 개 더 붙이는 게 아니라 다른 표로 간다.
// 컨센서스를 볼 때는 시세·수익률도 밸류에이션도 보지 않는다. 그 폭을 매출·영업이익·순이익이 가져간다.
const CONSENSUS_VIEW_KEY = "consensusDetail";
const OPTIONAL_COLUMN_GROUPS = [
  { key: CONSENSUS_VIEW_KEY, label: "컨센서스 자세히 보기", hint: "목표가 괴리 + 매출 · 영업이익 · 지배순이익을 분기·연간으로" },
];

// 2026-08-30 사용자 결정으로 코어 열을 다시 짰다.
//   현재가 · 1D · YTD · MDD · 시총 │ P/E·P/B·ROE (26E·27E) │ 올해 4개 분기 + 26E·27E
// MDD는 "올해 최고점 대비 현재가"다(신고가면 0%). 52주高比와 기준 구간이 다르다.
//
// 이익 지표는 섹터에 따라 바뀐다(확정 (C)안).
//   전체 화면은 영업이익으로 통일한다 — 섞으면 정렬이 은행 순이익과 정유 영업이익을 나란히 세운다.
//   금융·보험·증권·지주 섹터 페이지에서는 순이익으로 바뀐다. 그 안에서는 전부 같은 지표라 정렬이 정직하다.
const NET_INCOME_SECTORS = new Set(["금융", "보험", "증권", "지주"]);
const TABLE_QUARTERS = [["2026Q1", "1Q26"], ["2026Q2", "2Q26"], ["2026Q3", "3Q26"], ["2026Q4", "4Q26"]];
const TABLE_ANNUALS = [["2026", "26E"], ["2027", "27E"]];

function profitMetricFor(sector = state.sector) {
  return NET_INCOME_SECTORS.has(sector) ? "parentNetIncome" : "operatingIncome";
}

function profitLabelFor(sector = state.sector) {
  return NET_INCOME_SECTORS.has(sector) ? "지배순이익" : "영업이익";
}

// 드로어 요약 칸처럼 폭이 좁은 자리에서만 쓰는 줄임말.
function profitShortFor(sector = state.sector) {
  return NET_INCOME_SECTORS.has(sector) ? "순익" : "영익";
}

const ESTIMATE_BASES = [
  { key: "oneMonth", label: "1M 평균", tag: "1M 평균", hint: "최근 1개월 추정치 평균" },
  { key: "threeMonth", label: "3M 평균", tag: "3M 평균", hint: "최근 3개월 추정치 평균 (기본)" },
  { key: "highest", label: "3M 최고", tag: "3M 최고", hint: "최근 3개월 추정치 중 가장 높은 값" },
];

function estimateBasisTag() {
  if (!horizonsAvailable()) return "";
  return ESTIMATE_BASES.find(({ key }) => key === state.estimateBasis)?.tag || "";
}

// 기준별 값(horizons)은 2026-08-30에 payload에 추가됐다. 그 전에 구워진 스냅샷에는 없다.
// 없으면 기준 전환을 아예 띄우지 않는다 — 띄우고 3M 값을 "최고"라고 적으면 거짓말이 된다.
// 서버 모듈만 고치고 재시작하지 않으면 화면은 새 코드, 데이터는 옛 payload가 되어 실제로 이 상태가 된다.
function horizonsAvailable() {
  for (const stock of state.snapshot?.stocks || []) {
    for (const record of Object.values(stock.annual || {})) {
      if (record?.kind === "estimate") return Boolean(record.horizons);
    }
  }
  return false;
}

const CONSENSUS_METRICS = [
  { key: "revenue", label: "매출", metric: "revenue", className: "metric-wide-col" },
  { key: "op", label: "영업이익", metric: "operatingIncome", className: "metric-col" },
  { key: "ni", label: "지배순이익", metric: "parentNetIncome", className: "metric-col" },
];

// 컨센서스 보기. 여기서는 섹터별 이익 지표 교체를 하지 않는다 — 세 지표를 다 펴 놓기 때문이다.
// 매출이 없는 업종(은행지주·보험)은 섹터 페이지에서 매출 칸이 통째로 사라지는 기존 규칙이 처리한다.
function buildConsensusSections() {
  return [
    {
      key: "identity",
      columns: [
        { key: "sector", label: "섹터", sort: "sector", className: "sticky-sector", kind: "sector" },
        { key: "name", label: "종목", sort: "name", className: "sticky-stock", kind: "name" },
        { key: "targetGap", label: "목표가 괴리", subLabel: `(${targetPriceLabel()})`, sort: "computed.targetGap", className: "target-col revision-col", kind: "computed", compute: "targetGap", heat: "targetGap" },
      ],
    },
    ...CONSENSUS_METRICS.map(({ key, label, metric, className }) => ({
      key: `consensus-${key}`,
      label: `${label} (억원 · ${estimateBasisTag()})`,
      columns: [
        ...TABLE_QUARTERS.map(([period, short]) => ({
          key: `${key}-q${period}`, label: short, sort: `quarter.${period}.${metric}`,
          className, kind: "quarterFinancial", period, metric,
        })),
        ...TABLE_ANNUALS.map(([period, short], index) => ({
          key: `${key}-a${period}`, label: short, sort: `annual.${period}.${metric}`,
          className, subsection: index === 0, kind: "financial", period, metric,
        })),
      ],
    })),
    {
      // 그룹 이름 없이 한 칸만 세운다. 어느 그룹에도 속하지 않는 값이라 묶음 머리글을 붙이면 거짓말이 된다.
      key: "contributors",
      plain: true,
      columns: [
        { key: "contributors", label: "참여사", sort: "consensus.contributors", className: "revision-col", kind: "contributors", period: "2026" },
      ],
    },
  ];
}

function activeSections(sector = state.sector) {
  return state.columnGroups.has(CONSENSUS_VIEW_KEY) ? buildConsensusSections() : buildColumnSections(sector);
}

function buildColumnSections(sector = state.sector) {
  const metric = profitMetricFor(sector);
  const profit = profitLabelFor(sector);
  return [
    {
      key: "identity",
      columns: [
        { key: "sector", label: "섹터", sort: "sector", className: "sticky-sector", kind: "sector" },
        { key: "name", label: "종목", sort: "name", className: "sticky-stock", kind: "name" },
      ],
    },
    {
      key: "quote",
      label: "시세 · 수익률",
      columns: [
        { key: "price", label: "현재가", sort: "quote.price", className: "base-col price-col", kind: "price" },
        { key: "d1", label: "1D", sort: "performance.d1", className: "base-col return-col", kind: "return", period: "d1" },
        { key: "ytd", label: "YTD", sort: "performance.ytd", className: "base-col return-col", kind: "return", period: "ytd" },
        { key: "ytdDrawdown", label: "MDD", sort: "performance.ytdDrawdown", className: "base-col return-col", kind: "return", period: "ytdDrawdown" },
        { key: "marketCap", label: "시총", sort: "quote.marketCap", className: "base-col market-cap-col", kind: "marketCap", field: "marketCap" },
      ],
    },
    {
      key: "valuation",
      label: "밸류에이션",
      columns: [
        { key: "pe2026", label: "P/E 26E", sort: "valuation.2026.pe.value", className: "ratio-col", kind: "ratio", period: "2026", ratio: "pe" },
        { key: "pe2027", label: "P/E 27E", sort: "valuation.2027.pe.value", className: "ratio-col", kind: "ratio", period: "2027", ratio: "pe" },
        { key: "pb2026", label: "P/B 26E", sort: "valuation.2026.pb.value", className: "ratio-col", kind: "ratio", period: "2026", ratio: "pb" },
        { key: "pb2027", label: "P/B 27E", sort: "valuation.2027.pb.value", className: "ratio-col", kind: "ratio", period: "2027", ratio: "pb" },
        { key: "roe2026", label: "ROE 26E", sort: "valuation.2026.roe.value", className: "ratio-col", kind: "ratio", period: "2026", ratio: "roe" },
        { key: "roe2027", label: "ROE 27E", sort: "valuation.2027.roe.value", className: "ratio-col", kind: "ratio", period: "2027", ratio: "roe" },
      ],
    },
    {
      key: "profit",
      label: `${profit} (억원)`,
      columns: [
        ...TABLE_QUARTERS.map(([period, label]) => ({
          key: `q${period}`, label, sort: `quarter.${period}.${metric}`,
          className: "metric-col", kind: "quarterFinancial", period, metric,
        })),
        // 분기 넉 칸과 연간 두 칸이 한 그룹에 붙어 있다. 연간 첫 칸에 옅은 세로선을 둬서 경계를 보인다.
        ...TABLE_ANNUALS.map(([period, label], index) => ({
          key: `a${period}`, label, sort: `annual.${period}.${metric}`,
          className: "metric-col", subsection: index === 0, kind: "financial", period, metric,
        })),
      ],
    },
  ];
}

const PENDING_COLUMNS = buildColumnSections("all").flatMap(({ columns }) => columns.filter(({ pending }) => pending));

// 컨센서스 리비전: 1M 평균 / 3M 평균 - 1.
// 목록 payload에는 서버가 요약해 둔 stock.revision이 오고, 상세 payload에는 원본 비교표가 온다.
function consensusRevision(stock, period, metric) {
  const summarized = stock.revision?.annual?.[period];
  if (summarized) return Number.isFinite(summarized[metric]) ? summarized[metric] : null;
  const compare = stock.consensusComparison?.annual?.[period];
  const recent = compare?.oneMonth?.[metric];
  const base = compare?.threeMonth?.[metric];
  if (!Number.isFinite(recent) || !Number.isFinite(base) || !(base > 0)) return null;
  return ((recent / base) - 1) * 100;
}

// 배당수익률·목표가 괴리는 컨센서스(연 1회 갱신)와 현재가(실시간)를 함께 써야 나온다.
// 서버가 미리 계산해 두면 시세가 움직일 때마다 어긋나므로 화면에서 그때그때 만든다.
const COMPUTED = {
  dividendYield: (stock) => {
    const dps = stock.annual?.["2026"]?.dividendPerShare;
    const price = stock.quote?.price;
    if (!Number.isFinite(dps) || !Number.isFinite(price) || price <= 0) return null;
    return (dps / price) * 100;
  },
  targetGap: (stock) => {
    const target = targetPriceOf(stock, "2026");
    const price = stock.quote?.price;
    if (!Number.isFinite(target) || !Number.isFinite(price) || price <= 0) return null;
    return ((target / price) - 1) * 100;
  },
};

// 목표주가는 ConsenDB에 3M 평균(E610300.M)과 3M 최고(E610301.M)만 있다. 1M 평균은 아예 없다.
// 그래서 1M 평균을 골라도 목표주가는 3M 평균을 쓴다. 없는 값을 만들지 않되, 어느 기준인지는 열 이름에 적는다.
function targetPriceBasis() {
  return state.estimateBasis === "highest" ? "highest" : "threeMonth";
}

function targetPriceLabel() {
  return targetPriceBasis() === "highest" ? "3M 최고" : "3M 평균";
}

function targetPriceOf(stock, period = "2026") {
  const record = stock.annual?.[period];
  if (!record) return null;
  if (record.kind !== "estimate" || !record.horizons) return record.targetPrice ?? null;
  return record.horizons[targetPriceBasis()]?.targetPrice ?? record.targetPrice ?? null;
}

// ConsenDB의 참여 증권사 수는 지표별로 다르다(payload가 { operatingIncome: 17 } 꼴).
// 지표가 지정되면 그 지표의 수를, 아니면 예전처럼 숫자 하나를 그대로 읽는다.
// 선택된 기준의 참여 증권사 수. FnGuide는 영업이익 기준 하나만 주고, 1M과 3M이 다르다
// (SK스퀘어 2026E: 3M 5곳 · 1M 1곳). 최고는 3M과 같은 모수를 쓴다.
function estimateContributors(stock, period) {
  const record = stock.annual?.[period];
  if (record?.kind !== "estimate") return null;
  if (!record.horizons) return contributorCount(stock, period, "operatingIncome");
  return record.horizons[state.estimateBasis]?.contributors ?? null;
}

function contributorCount(stock, period, metric) {
  const raw = stock.annual?.[period]?.contributors;
  if (raw == null) return null;
  if (Number.isFinite(raw)) return raw;
  const value = metric ? raw[metric] : raw.operatingIncome;
  return Number.isFinite(value) ? value : null;
}

// 결측 판정용 원시값. 섹터 페이지에서 "전원이 결측인 열"을 숨길 때 쓴다.
function columnValue(stock, column) {
  switch (column.kind) {
    case "price": return stock.quote?.price ?? null;
    case "marketCap": return stock.quote?.[column.field] ?? null;
    case "return": return stock.performance?.[column.period] ?? null;
    case "financial": return financialValue(stock.annual?.[column.period], column.metric);
    case "quarterFinancial": return financialValue(stock.quarter?.[column.period], column.metric);
    case "revision": return consensusRevision(stock, column.period, column.metric);
    case "ratio": {
      const result = stock.valuation?.[column.period]?.[column.ratio];
      return result && result.status === "ok" ? result.value : null;
    }
    case "count": return contributorCount(stock, column.period, column.metric);
    case "contributors": return estimateContributors(stock, column.period);
    case "computed": return COMPUTED[column.compute]?.(stock) ?? null;
    default: return null;
  }
}

// 2026-08-25 확정 #2: 섹터 페이지에서는 그 섹터 전원이 비어 있는 열을 숨긴다.
// 홈 통합표는 비교 정렬을 위해 열을 그대로 두고 "-"로 표시한다.
//
// 비어 있는 이유는 두 가지이고 화면은 둘을 구분하지 않는다. 어느 쪽이든 표시할 값이 없기 때문이다.
//   - 산업상 해당 없음: 은행지주·보험의 매출액처럼 그 업종에 개념이 없는 항목
//   - 커버리지 없음: 애널리스트가 안 보는 종목의 목표주가·배당
// 둘 다 보간하지 않는다. 커버리지가 개시되면 다음 ConsenDB Refresh에서 코드 수정 없이 채워진다.
function hiddenColumnsForSector() {
  if (state.sector === "all") return new Map();
  const stocks = (state.snapshot?.stocks || []).filter((stock) => stock.sector === state.sector);
  const hidden = new Map();
  if (!stocks.length) return hidden;
  for (const section of activeSections()) {
    if (section.key === "identity") continue;
    for (const column of section.columns) {
      if (column.pending) continue;
      if (stocks.every((stock) => columnValue(stock, column) == null)) hidden.set(column.key, column);
    }
  }
  return hidden;
}

function columnEnabled(column, hidden) {
  if (column.pending) return false;
  if (hidden.has(column.key)) return false;
  return !column.group || state.columnGroups.has(column.group);
}

function visibleSections(hidden = hiddenColumnsForSector()) {
  return activeSections()
    .map((section) => ({ ...section, columns: section.columns.filter((column) => section.key === "identity" || columnEnabled(column, hidden)) }))
    .filter((section) => section.columns.length);
}

function visibleColumnCount(sections = visibleSections()) {
  return sections.reduce((total, { columns }) => total + columns.length, 0);
}

// ---------------------------------------------------------------------------
// 집계
// ---------------------------------------------------------------------------
function stocksInSector(sector) {
  const stocks = state.snapshot?.stocks || [];
  return sector === "all" ? stocks : stocks.filter((stock) => stock.sector === sector);
}

// 동일가중 평균 수익률(2026-08-30 결정). 수익률이 없는 종목은 분모에서도 뺀다.
// 지수를 동일가중으로 바꾸면서 KPI·사이드바도 같이 맞췄다. 한쪽만 시총가중으로 두면
// 사이드바의 섹터 1D와 차트가 서로 다른 숫자를 말한다.
function weightedPerformance(stocks = [], key = "d1") {
  let counted = 0;
  let total = 0;
  for (const stock of stocks) {
    const value = stock.performance?.[key];
    if (!Number.isFinite(value)) continue;
    counted += 1;
    total += value;
  }
  return counted > 0 ? total / counted : null;
}

function directionCounts(stocks = [], key = "d1") {
  let up = 0;
  let down = 0;
  for (const stock of stocks) {
    const value = stock.performance?.[key];
    if (!Number.isFinite(value)) continue;
    if (value > 0) up += 1;
    else if (value < 0) down += 1;
  }
  return { up, down };
}



function benchmarkOf(market) {
  return state.snapshot?.sectorIndices?.benchmarks?.[market] || null;
}

function indexDates() {
  return state.snapshot?.sectorIndices?.dates || [];
}

// 국내 종목만으로 만든 계열. 홈 타일 스파크라인이 쓴다(타일 숫자가 국내 기준이라 선도 국내여야 한다).
function domesticSeries(sector) {
  return state.snapshot?.sectorIndices?.domestic?.[sector] || sectorSeries(sector);
}

function sectorSeries(sector) {
  return state.snapshot?.sectorIndices?.sectors?.[sector] || null;
}

function groupSeries(label) {
  return state.snapshot?.sectorIndices?.groups?.[label] || null;
}

// 종목 일봉을 섹터 지수와 같은 날짜 축에 얹는다(직전 종가 유지). 상장 전 구간은 null로 둔다.
function alignHistory(history = [], dates = []) {
  const rows = [...history]
    .filter((row) => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.close) && row.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const output = new Array(dates.length).fill(null);
  let cursor = 0;
  let last = null;
  for (let index = 0; index < dates.length; index += 1) {
    while (cursor < rows.length && rows[cursor].date <= dates[index]) {
      last = rows[cursor].close;
      cursor += 1;
    }
    output[index] = last;
  }
  return output;
}

function windowSlice(values = [], range = state.range) {
  const length = range === "ytd" ? ytdWindowLength() : range;
  if (!length || length <= 0 || length >= values.length) return values;
  return values.slice(-length);
}

// ---------------------------------------------------------------------------
// 차트
// ---------------------------------------------------------------------------
// 좁은 화면에서 가로로 긴 viewBox를 그대로 쓰면 축 글자가 4px 아래로 줄어 읽히지 않는다.
// 2026-08-27 — 차트가 화면 폭에 비례해 세로로 커지던 것을 막는다.
//
// `svg.chart`는 `width:100%; height:auto`이고 viewBox가 900×260 고정이라, 비율이 유지되면서
// 폭이 넓어지면 높이도 같이 늘어났다. 실측: 1440폭에서 326px, 1890폭에서 456px, 2560폭에서 649px.
// 그래서 모니터가 클수록 종목표가 접힘선 아래로 밀렸다(1890폭 3행, 2560폭 0행).
// "모니터 워크스테이션형"이 확정안인데 정반대로 동작하고 있었다.
//
// 고침: viewBox 폭을 실제 컨테이너 픽셀 폭에 맞춘다. 1:1로 대응하므로 높이는 지정한 값에 고정된다.
// 컨테이너는 렌더 직전에도 살아 있는 `.content`라 innerHTML을 갈아 끼우기 전에 잴 수 있다.
const CHART_PADDING = 24;              // .card 좌우 패딩 합
const SECTOR_CHART_RATIO = 2.2 / 3.0;  // .sec-grid 첫 열(2.2fr / 2.2fr+0.8fr)

function measuredChartWidth({ ratio = 1, fallback = 900 } = {}) {
  if (typeof document === "undefined") return fallback;
  const content = document.querySelector(".content");
  const available = content?.clientWidth;
  if (!Number.isFinite(available) || available <= 0) return fallback;
  const width = Math.round(available * ratio) - CHART_PADDING;
  // 너무 좁으면 축·끝점 라벨이 겹친다. 아래로는 막고, 위로는 열어 둔다.
  return Math.max(360, width);
}

function chartBox(wide, narrow, { ratio = 1 } = {}) {
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) return narrow;
  return { ...wide, width: measuredChartWidth({ ratio, fallback: wide.width }) };
}

function lineChart({ series, labels, width = 820, height = 250, rebase = true }) {
  const usable = series.filter((item) => (item.values || []).some((value) => Number.isFinite(value)));
  if (!usable.length || labels.length < 2) return '<p class="empty-state">표시할 시계열이 없습니다.</p>';
  const pad = { left: 38, right: 104, top: 12, bottom: 24 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const data = usable.map((item) => {
    const values = item.values;
    const first = values.find((value) => Number.isFinite(value));
    const scaled = rebase && Number.isFinite(first) && first !== 0
      ? values.map((value) => (Number.isFinite(value) ? (value / first) * 100 : null))
      : values;
    return { ...item, scaled };
  });
  const flat = data.flatMap(({ scaled }) => scaled).filter(Number.isFinite);
  let min = Math.min(...flat);
  let max = Math.max(...flat);
  const span = (max - min) || 1;
  min -= span * 0.06;
  max += span * 0.06;
  const count = labels.length;
  const x = (index) => pad.left + (index / (count - 1)) * innerWidth;
  const y = (value) => pad.top + (1 - (value - min) / (max - min)) * innerHeight;
  let grid = "";
  for (let step = 0; step <= 4; step += 1) {
    const value = min + ((max - min) * step) / 4;
    grid += `<line class="grid" x1="${pad.left}" x2="${pad.left + innerWidth}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`
      + `<text x="${pad.left - 5}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${value.toFixed(0)}</text>`;
  }
  if (rebase && min < 100 && max > 100) {
    grid += `<line class="axis" x1="${pad.left}" x2="${pad.left + innerWidth}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" stroke-dasharray="2 3"/>`;
  }
  const ticks = [0, Math.floor((count - 1) / 2), count - 1].map((index) => {
    const anchor = index === 0 ? "start" : index === count - 1 ? "end" : "middle";
    return `<text x="${x(index).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}">${escapeHtml(labels[index].slice(2, 7).replace("-", "."))}</text>`;
  }).join("");
  const paths = data.map((item) => {
    let path = "";
    let open = false;
    item.scaled.forEach((value, index) => {
      if (!Number.isFinite(value)) { open = false; return; }
      path += `${open ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
      open = true;
    });
    return `<path class="${item.cls}" d="${path.trim()}"/>`;
  }).join("");
  // 끝 라벨이 같은 높이에 몰리면 서로 덮어쓴다. 위에서부터 최소 간격을 확보해 밀어 내린다.
  const endPoints = data
    .map((item) => ({ item, last: [...item.scaled].reverse().find((value) => Number.isFinite(value)) }))
    .filter(({ last }) => Number.isFinite(last))
    .sort((left, right) => y(left.last) - y(right.last));
  let previousY = -Infinity;
  for (const point of endPoints) {
    point.labelY = Math.max(y(point.last), previousY + 13);
    previousY = point.labelY;
  }
  const overflow = previousY - (height - 6);
  if (overflow > 0) for (const point of endPoints) point.labelY -= overflow;
  const ends = endPoints.map(({ item, last, labelY }) =>
    `<text class="end" x="${pad.left + innerWidth + 5}" y="${(labelY + 4).toFixed(1)}">${escapeHtml(item.short || item.name)} ${last.toFixed(1)}</text>`).join("");
  const title = usable.map(({ name }) => name).join(" vs ");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)} 상대주가 추이, 기간 시작 100">`
    + `<title>${escapeHtml(title)}</title>${grid}${ticks}${paths}${ends}</svg>`;
}

function sparkline(values = [], width = 120, height = 22) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return "";
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const x = (index) => 1 + (index / (values.length - 1)) * (width - 2);
  const y = (value) => 2 + (1 - (value - min) / ((max - min) || 1)) * (height - 4);
  const path = values.map((value, index) => (Number.isFinite(value) ? `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}` : "")).join(" ").trim();
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}"/></svg>`;
}

// 분기 영업이익: 확정 실적 막대 + 추정 막대(점선) + 발표 전 3M 컨센 가로선.
function quarterBarChart(items, { width = 420, height = 176 } = {}) {
  const values = items.flatMap((item) => [item.value, item.consensus]).filter(Number.isFinite);
  if (!values.length) return '<p class="empty-state">표시할 분기 실적이 없습니다.</p>';
  const pad = { left: 44, right: 8, top: 16, bottom: 22 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maximum = Math.max(0, ...values) * 1.18 || 1;
  const minimum = Math.min(0, ...values) * 1.18;
  const span = (maximum - minimum) || 1;
  const y = (value) => pad.top + (1 - (value - minimum) / span) * innerHeight;
  const baseline = y(0);
  const bandWidth = innerWidth / items.length;
  let grid = "";
  for (let step = 0; step <= 2; step += 1) {
    const value = minimum + (span * step) / 2;
    grid += `<line class="grid" x1="${pad.left}" x2="${pad.left + innerWidth}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`
      + `<text x="${pad.left - 4}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${formatNumber(value)}</text>`;
  }
  const bars = items.map((item, index) => {
    const left = pad.left + index * bandWidth + bandWidth * 0.16;
    const barWidth = bandWidth * 0.68;
    if (!Number.isFinite(item.value)) {
      return `<text x="${(left + barWidth / 2).toFixed(1)}" y="${height - 5}" text-anchor="middle" font-size="9.5">${escapeHtml(item.label)}</text>`;
    }
    const top = item.value >= 0 ? y(item.value) : baseline;
    const barHeight = Math.max(1, Math.abs(y(item.value) - baseline));
    const consensusLine = Number.isFinite(item.consensus)
      ? `<line class="bar-c" x1="${(left - 2).toFixed(1)}" x2="${(left + barWidth + 2).toFixed(1)}" y1="${y(item.consensus).toFixed(1)}" y2="${y(item.consensus).toFixed(1)}"/>`
      : "";
    return `<rect class="${item.estimate ? "bar-e" : "bar-a"}" x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}">`
      + `<title>${escapeHtml(item.label)} 영업이익 ${formatFinancial(item.value)}억원${item.estimate ? " (추정)" : ""}</title></rect>`
      + consensusLine
      + `<text class="lbl" x="${(left + barWidth / 2).toFixed(1)}" y="${(top - 3).toFixed(1)}" text-anchor="middle" font-size="9.5">${formatFinancial(item.value)}</text>`
      + `<text x="${(left + barWidth / 2).toFixed(1)}" y="${height - 5}" text-anchor="middle" font-size="9.5">${escapeHtml(item.label)}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="분기 영업이익, 단위 억원"><title>분기 영업이익 · 단위 억원</title>`
    + `${grid}<line class="axis" x1="${pad.left}" x2="${pad.left + innerWidth}" y1="${baseline.toFixed(1)}" y2="${baseline.toFixed(1)}"/>${bars}</svg>`;
}

// ---------------------------------------------------------------------------
// 사이드바
// ---------------------------------------------------------------------------
function sectorNavItems() {
  const stocks = state.snapshot?.stocks || [];
  return [{ href: "#/", key: "all", label: "전체", count: stocks.length, d1: weightedPerformance(stocks, "d1") }]
    .concat(SECTOR_ORDER.map((sector) => {
      const members = stocks.filter((stock) => stock.sector === sector);
      return { href: `#/sector/${encodeURIComponent(sector)}`, key: sector, label: sector, count: members.length, d1: weightedPerformance(members, "d1") };
    }));
}

function renderSidebar() {
  // 2026-08-30 사용자 결정: KOSPI·KOSDAQ은 KPI 첫 칸으로 옮기고 사이드바에서는 뺐다(중복).
  const items = sectorNavItems();
  $("#sectorNav").innerHTML = items.map((item) => `<li><a href="${item.href}"${state.sector === item.key ? ' aria-current="page"' : ""}>`
    + `<span>${escapeHtml(item.label)}</span><small>${item.count}</small>`
    + `<span class="chg ${numberClass(item.d1)}">${formatPercent(item.d1, 1)}</span></a></li>`).join("");
  $("#mobileNav").innerHTML = items.map((item) => `<a href="${item.href}"${state.sector === item.key ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("");

  const mode = state.snapshot?.mode === "fixture"
    ? "고정 fixture 검증 데이터 · 투자 판단 사용 금지"
    : `컨센 ${sourceDisplayName("consensus", state.snapshot?.sources?.consensus?.source)} · 실적 OpenDART`;
  $("#sourceFoot").textContent = RUNTIME.staticMode
    ? `${mode} · 실시간 아님(지연 스냅샷)`
    : mode;
  $("#lastUpdated").textContent = `최근 갱신 ${formatTimestamp(state.snapshot?.generatedAt)}`;
}

// ---------------------------------------------------------------------------
// KPI 6칸 + 시장 폭 상세
// ---------------------------------------------------------------------------
function kpiStripHtml() {
  const stocks = stocksInSector(state.sector);
  const kospi = state.snapshot?.marketBreadth?.indices?.KOSPI;
  const kosdaq = state.snapshot?.marketBreadth?.indices?.KOSDAQ;
  const scope = state.sector === "all" ? "커버리지" : state.sector;
  const weightedD1 = weightedPerformance(stocks, "d1");
  const direction = directionCounts(stocks, "d1");
  // 2026-08-30 사용자 결정: KPI 6칸을 "지금·오늘·이번 주에 어느 섹터·종목을 봐야 하나"로 바꿨다.
  //
  // 뺀 것과 이유
  //  - KOSPI·KOSDAQ 두 칸: 사이드바 미니마켓과 같은 값인데 라벨이 없어 어느 줄인지도 안 보였다.
  //  - 섹터 타일 8개: 1D가 사이드바와 8/8 동일하고 스파크라인은 위 차트의 축소판이었다.
  //  - 커버리지 1D 평균: 8섹터가 서로 상관이 낮아 한 숫자로 묶는 의미가 약하다.
  //    (커버리지 평균은 아래 시장 폭 줄에 그대로 있다)
  //
  // 리비전·목표주가 칸은 나중에 리포트 ingest가 생기면 만든다(메모 §3-5: 지금은 포맷을 설계하지 않는다).
  const extremeStock = (key) => {
    const ranked = [...stocks]
      .filter((stock) => Number.isFinite(stock.performance?.[key]))
      .sort((left, right) => right.performance[key] - left.performance[key]);
    return { best: ranked[0] || null, worst: ranked.length > 1 ? ranked.at(-1) : null };
  };
  // 섹터 최고·최저는 화면에 보이는 범위를 따른다. 섹터 페이지에서는 그 섹터 하나뿐이라 칸이 비고,
  // 대신 종목 최고·최저가 그 섹터 안에서 계산된다.
  const extremeSector = (key) => {
    const ranked = SECTOR_ORDER
      .map((sector) => ({ sector, value: weightedPerformance(stocksInSector(sector), key) }))
      .filter(({ value }) => Number.isFinite(value))
      .sort((left, right) => right.value - left.value);
    return { best: ranked[0] || null, worst: ranked.length > 1 ? ranked.at(-1) : null };
  };
  // 최고·최저는 같은 무게로 읽혀야 한다. 아래를 작게 두면 최저가 곁가지처럼 보인다.
  // 색만으로 방향을 알리지 않고 ▲▼를 붙인다.
  const pair = (top, bottom) => `<dd class="num pairtop">${top}</dd><small class="pairbot">${bottom}</small>`;
  const mark = (cls) => (cls === "positive" ? "▲" : "▼");
  const stockLine = (stock, key, cls) => (stock
    ? `<span class="${cls}"><i>${mark(cls)}</i>${escapeHtml(stock.name)} ${formatPercent(stock.performance[key], 1)}</span>`
    : "-");
  const sectorLine = (entry, cls) => (entry
    ? `<span class="${cls}"><i>${mark(cls)}</i>${escapeHtml(entry.sector)} ${formatPercent(entry.value, 1)}</span>`
    : "-");
  // 거래대금이 평소의 몇 배인지. 오늘 1D 최고·최저에 안 잡히는 종목을 짚어 준다
  // (2026-08-30 실측: 한화가 ×2.4인데 1D는 +3.6%라 최고에 안 들어왔고, 주간으로는 +34%였다).
  const surging = [...stocks]
    .filter((stock) => Number.isFinite(stock.quote?.tradingValueSurge))
    .sort((left, right) => right.quote.tradingValueSurge - left.quote.tradingValueSurge)
    .slice(0, 2);
  const surgeLine = (stock) => (stock
    ? `<span class="${numberClass(stock.performance?.d1)}"><i>×${formatNumber(stock.quote.tradingValueSurge, 1)}</i>${escapeHtml(stock.name)} ${formatPercent(stock.performance?.d1, 1)}</span>`
    : "-");
  const showSectorExtremes = state.sector === "all";
  const d1Stock = extremeStock("d1");
  const d5Stock = extremeStock("d5");
  const d1Sector = extremeSector("d1");
  const d5Sector = extremeSector("d5");
  const weightedD5 = weightedPerformance(stocks, "d5");

  return `<dl class="kpis" id="kpis">
    <div class="kpi" id="kpiMarket"><dt>지수 <u>KOSPI · KOSDAQ</u></dt>
      ${pair(
        `<span><em>KOSPI</em>${Number.isFinite(kospi?.level) ? formatNumber(kospi.level, 2) : "-"} <span class="${numberClass(kospi?.d1)}">${formatPercent(kospi?.d1, 2)}</span></span>`,
        `<span><em>KOSDAQ</em>${Number.isFinite(kosdaq?.level) ? formatNumber(kosdaq.level, 2) : "-"} <span class="${numberClass(kosdaq?.d1)}">${formatPercent(kosdaq?.d1, 2)}</span></span>`,
      )}</div>
    <div class="kpi"><dt>거래대금 급증 <u>20일 평균 대비</u></dt>
      ${pair(surgeLine(surging[0]), surgeLine(surging[1]))}</div>
    <div class="kpi"><dt>오늘 <u>섹터</u></dt>
      ${showSectorExtremes
        ? pair(sectorLine(d1Sector.best, "positive"), sectorLine(d1Sector.worst, "negative"))
        : pair(`<span class="${numberClass(weightedD1)}">${escapeHtml(scope)} ${formatPercent(weightedD1, 1)}</span>`, "섹터 1개")}</div>
    <div class="kpi"><dt>오늘 <u>종목</u></dt>
      ${pair(stockLine(d1Stock.best, "d1", "positive"), stockLine(d1Stock.worst, "d1", "negative"))}</div>
    <div class="kpi"><dt>주간 5D <u>섹터</u></dt>
      ${showSectorExtremes
        ? pair(sectorLine(d5Sector.best, "positive"), sectorLine(d5Sector.worst, "negative"))
        : pair(`<span class="${numberClass(weightedD5)}">${escapeHtml(scope)} ${formatPercent(weightedD5, 1)}</span>`, "섹터 1개")}</div>
    <div class="kpi"><dt>주간 5D <u>종목</u></dt>
      ${pair(stockLine(d5Stock.best, "d5", "positive"), stockLine(d5Stock.worst, "d5", "negative"))}</div>
  </dl>`;
}




// ---------------------------------------------------------------------------
// 홈 · 섹터 화면 블록
// ---------------------------------------------------------------------------
function rangeButtons() {
  return RANGES.map(([value, label]) => `<button class="btn tiny" type="button" data-range="${value}" aria-pressed="${String(state.range) === String(value)}">${label}</button>`).join("");
}

// YTD 창 길이. 기준일을 "전년 마지막 거래일"로 잡아야 차트의 100이 표의 YTD 0%와 같아진다
// (Decisions: YTD는 전년 마지막 거래일 종가 대비). 올해 첫 거래일부터 자르면 1월 첫날 등락이 사라진다.
function parseRangeValue(raw) {
  return raw === "ytd" ? "ytd" : Number(raw);
}

function ytdWindowLength(dates = indexDates()) {
  if (!dates.length) return 0;
  const year = dates.at(-1).slice(0, 4);
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    if (dates[index].slice(0, 4) < year) return dates.length - index;
  }
  return dates.length;
}

// 2026-08-30 사용자 결정: KOSPI·KOSDAQ 토글을 없애고 항상 둘 다 띄운다.
// 셋 중 하나를 고르는 버튼이었는데 사실상 늘 "둘 다"로 두고 썼다.
function benchmarkSeriesFor(dates) {
  const series = [];
  const kospi = benchmarkOf("KOSPI");
  if (kospi) series.push({ name: "KOSPI", values: windowSlice(kospi.values), cls: "s-ctx" });
  const kosdaq = benchmarkOf("KOSDAQ");
  if (kosdaq) series.push({ name: "KOSDAQ", values: windowSlice(kosdaq.values), cls: "s-ctx2" });
  return series.filter((item) => item.values.length === dates.length || item.values.length > 1);
}

// 2026-08-30 사용자 결정: 홈 비교 차트를 4그룹에서 8섹터로 바꿨다.
// 4그룹(금융·지주·보험·증권 / AI/SW / 정유·화학 / 희토류)으로 묶으면 섹터끼리의 차이가 뭉개진다.
// 8섹터 + KOSPI + KOSDAQ = 10선이다.
function homeGroupChart() {
  const dates = windowSlice(indexDates());
  if (dates.length < 2) return `<div class="card"><div class="card-head"><h3>섹터 상대주가</h3></div><p class="empty-state">섹터 지수를 만들 일봉이 아직 없습니다.</p></div>`;
  const series = SECTOR_ORDER.map((sector, index) => {
    const entry = sectorSeries(sector);
    return entry && entry.values.length
      ? { name: sector, short: sector, values: windowSlice(entry.values), cls: `s-${index + 1}`, members: entry.members }
      : null;
  }).filter(Boolean);
  const box = chartBox({ width: 900, height: 300 }, { width: 430, height: 300 });
  const chart = lineChart({ series: [...series, ...benchmarkSeriesFor(dates)], labels: dates, ...box });
  return `<div class="card" id="homeGroupChart">
    <div class="card-head"><h3>8섹터 상대주가 vs 벤치마크</h3>
      <span class="tools">${rangeButtons()}</span></div>
    ${chart}
    <div class="chart-legend">${SECTOR_ORDER.map((sector, index) => `<span><i class="s${index + 1}"></i>${escapeHtml(sector)}</span>`).join("")}
      <span><i class="ctx"></i>KOSPI</span><span><i class="ctx2"></i>KOSDAQ</span>
      <span class="unit">기간 시작 = 100 · 동일가중 · 일별 종가</span></div>
  </div>`;
}


function sectorExceptions(stocks) {
  const byReturn = [...stocks].filter((stock) => Number.isFinite(stock.performance?.d1)).sort((left, right) => right.performance.d1 - left.performance.d1);
  const byRevision = [...stocks]
    .map((stock) => ({ stock, value: consensusRevision(stock, "2026", profitMetricFor()) }))
    .filter(({ value }) => Number.isFinite(value) && value !== 0)
    .sort((left, right) => right.value - left.value);
  const item = (stock, value) => `<li><span><a href="#/stock/${stock.code}">${escapeHtml(stock.name)}</a>`
    + `<small>${formatNumber(stock.quote?.marketCap)}억</small></span>`
    + `<span class="num ${numberClass(value)}">${formatPercent(value, 1)}</span></li>`;
  // 2026-08-27: 네 묶음을 한 줄로 세우면 카드가 368px가 되고, .sec-grid 높이를 이쪽이 결정해
  // 차트를 줄여도 종목표가 올라오지 않는다. 2×2로 접어 절반 높이로 만든다.
  const block = (label, rows) => `<section class="exc-block"><h4>${label}</h4><ul class="exc">`
    + (rows.length ? rows.join("") : '<li><span class="na">해당 없음</span><span class="num na">-</span></li>')
    + "</ul></section>";
  return `<div class="exc-grid">
    ${block("1D 상승 상위", byReturn.slice(0, 2).map((stock) => item(stock, stock.performance.d1)))}
    ${block("1D 하락 상위", byReturn.slice(-2).reverse().map((stock) => item(stock, stock.performance.d1)))}
    ${block(`${profitShortFor()} 26E 컨센 1M 상향`, byRevision.slice(0, 2).map(({ stock, value }) => item(stock, value)))}
    ${block(`${profitShortFor()} 26E 컨센 1M 하향`, byRevision.slice(-2).reverse().map(({ stock, value }) => item(stock, value)))}
  </div>`;
}

function sectorTrend(sector, stocks) {
  const dates = windowSlice(indexDates());
  const global = sectorSeries(sector);
  const local = domesticSeries(sector);
  // 해외 peer가 있는 섹터는 국내선과 글로벌선을 함께 그린다(2026-08-30).
  // 합성선 하나만 그리면 국내 종목이 글로벌 테마를 따라가는지 아닌지가 보이지 않는다.
  const hasPeers = local !== global && local?.values?.length;
  const series = [];
  if (global?.values?.length) {
    series.push({
      name: hasPeers ? `${sector} 글로벌` : sector,
      short: hasPeers ? "글로벌" : sector,
      values: windowSlice(global.values),
      cls: "s-main",
    });
  }
  if (hasPeers) {
    series.push({ name: `${sector} 국내`, short: "국내", values: windowSlice(local.values), cls: "s-sector" });
  }
  const box = chartBox({ width: 820, height: 220 }, { width: 430, height: 300 }, { ratio: SECTOR_CHART_RATIO });
  const chart = dates.length >= 2 && series.length
    ? lineChart({ series: [...series, ...benchmarkSeriesFor(dates)], labels: dates, ...box })
    : '<p class="empty-state">섹터 지수를 만들 일봉이 아직 없습니다.</p>';
  const excluded = global?.excluded?.length ? ` · 제외 ${global.excluded.length}종목` : "";
  const globalLabel = hasPeers
    ? `<span><i></i>글로벌(동일가중 ${global?.members ?? 0}종목${excluded})</span><span><i class="sector"></i>국내(${local?.members ?? 0}종목)</span>`
    : `<span><i></i>${escapeHtml(sector)} 섹터(동일가중 ${global?.members ?? 0}종목${excluded})</span>`;
  return `<div class="sec-grid">
    <div class="card" id="sectorTrendCard">
      <div class="card-head"><h3>${escapeHtml(sector)} 섹터 지수 vs 벤치마크</h3>
        <span class="tools">${rangeButtons()}</span></div>
      ${chart}
      <div class="chart-legend">${globalLabel}
        <span><i class="ctx"></i>KOSPI</span><span><i class="ctx2"></i>KOSDAQ</span>
        <span class="unit">기간 시작 = 100 · 동일가중 · 일별 종가</span></div>
    </div>
    <div class="card"><div class="card-head"><h3>섹터 내 예외</h3><span class="unit">${stocks.length}종목</span></div>${sectorExceptions(stocks)}</div>
  </div>`;
}

// 지표 변화량. 금리·비율은 bp, 수준값은 %, 그 밖에는 원 단위 그대로.
function formatIndicatorChange(value, changeMode) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  if (changeMode === "bp") return `${sign}${formatNumber(value, 1)}bp`;
  if (changeMode === "pct") return formatPercent(value, 2);
  return `${sign}${formatNumber(value, 2)}`;
}

// 기간 라벨. 일별은 날짜, 월별은 YYYY-MM 그대로 읽힌다.
function indicatorPeriodLabel(tile) {
  const dates = tile.lines.map((line) => line.latestDate).filter(Boolean).sort();
  const latest = dates.at(-1);
  if (!latest) return "-";
  return tile.cycle === "D" ? latest.slice(5).replace("-", ".") : latest;
}

// 확정 원천이 붙은 지표 하나. 최신값 · 직전 대비 변화 · 스파크라인.
// 한 지표가 두 계열을 가질 수 있다(예대금리차 신규·잔액, 연체율 기업·가계).
function indicatorTile(tile) {
  const rows = tile.lines.map((line) => `<div class="ind-line">
    ${line.label ? `<em>${escapeHtml(line.label)}</em>` : ""}
    <b>${line.latest == null ? "-" : formatNumber(line.latest, tile.cycle === "D" ? 3 : 2)}<u>${escapeHtml(tile.unit)}</u></b>
    <span class="${numberClass(line.change)}">${formatIndicatorChange(line.change, tile.changeMode)}</span>
    <span class="ind-spark">${sparkline(line.spark, 84, 20)}</span>
  </div>`).join("");
  const title = `${tile.name} ${tile.lines.map((line) => `${line.label ? `${line.label} ` : ""}${line.latest ?? "-"}${tile.unit}`).join(", ")}`;
  return `<li class="is-live" data-indicator="${escapeHtml(tile.key)}" title="${escapeHtml(title)}">
    <b>${escapeHtml(tile.name)}<u>${escapeHtml(indicatorPeriodLabel(tile))}</u></b>
    ${rows}
    <i>${escapeHtml(tile.sources.join(" · "))}${tile.note ? ` · ${escapeHtml(tile.note)}` : ""}</i>
  </li>`;
}

// 해외 peer 표 (2026-08-30). 전체 종목표에는 넣지 않고 해당 섹터 페이지에서만 보여 준다.
// 컨센서스·실적이 국내 전용이라 매출·OP·P/E를 채울 수 없어, 주가·1D·YTD만 담는다.
function foreignPeerTable(sector) {
  const peers = state.snapshot?.sectorIndices?.foreignPeers?.[sector] || [];
  if (!peers.length) return "";
  const loaded = peers.filter((peer) => !peer.error && peer.days);
  const rows = peers.map((peer) => {
    if (peer.error) {
      return `<tr><td class="l">${escapeHtml(peer.name)}<small>${escapeHtml(peer.symbol)}</small></td>`
        + `<td class="na" colspan="3">받지 못함 · ${escapeHtml(peer.error)}</td></tr>`;
    }
    return `<tr><td class="l">${escapeHtml(peer.name)}<small>${escapeHtml(peer.symbol)} · ${escapeHtml(peer.exchange || "")}</small></td>`
      + `<td>${formatNumber(peer.price, 2)}<u>${escapeHtml(peer.currency || "")}</u></td>`
      + `<td class="${numberClass(peer.changePercent)}">${formatPercent(peer.changePercent, 1)}</td>`
      + `<td class="${numberClass(peer.ytd)}">${formatPercent(peer.ytd, 1)}</td></tr>`;
  }).join("");
  // 지수에 실제로 들어간 종목 수를 밝힌다. 상장이 늦은 종목은 기간에 따라 빠진다.
  const note = loaded.length < peers.length
    ? `${peers.length}종목 중 ${loaded.length}종목 수신`
    : `${peers.length}종목`;
  return `<div class="card" id="foreignPeers">
    <div class="card-head"><h3>${escapeHtml(sector)} 해외 peer</h3>
      <span class="unit">Yahoo Finance · 일별 종가 · ${escapeHtml(note)}</span></div>
    <div class="fin-wrap"><table class="fin peer">
      <thead><tr><th class="l">종목</th><th>주가</th><th>1D</th><th>YTD</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="note">섹터 지수에 국내 종목과 같은 무게로 들어갑니다. 상장일이 기간 시작보다 늦은 종목은 그 기간 지수에서 빠집니다.</p>
  </div>`;
}

function indicatorTiles(sector) {
  const live = state.snapshot?.indicators?.sectors?.[sector] || [];
  const items = INDICATOR_CATALOG[sector] || [];
  if (!live.length && !items.length) return "";
  const source = state.snapshot?.sources?.indicators || {};
  if (live.length) {
    // 확정된 지표는 실제 타일로, 아직 원천이 없는 지표는 같은 줄에 대기 카드로 남는다.
    const liveKeys = new Set(live.map((tile) => tile.name));
    const pending = items.filter((item) => !liveKeys.has(item.name));
    const note = state.snapshot?.indicators?.sampleKey
      ? "한국은행 ECOS · 공개 sample 키(요청당 10행 제한)"
      : "한국은행 ECOS";
    return `<div class="ind-head"><h3>${escapeHtml(sector)} 트래킹 지표</h3>
        <span>${escapeHtml(note)} · 기준 ${escapeHtml(formatTimestamp(source.updatedAt || state.snapshot?.indicators?.loadedAt))}${source.stale ? " · 갱신 지연" : ""}</span></div>
      <ul class="ind" id="indicatorTiles">${live.map(indicatorTile).join("")}${pending.map(pendingIndicatorTile).join("")}</ul>`;
  }
  return `<div class="ind-head"><h3>${escapeHtml(sector)} 트래킹 지표</h3>
      <span>${escapeHtml(indicatorWaitingNote(source))}</span></div>
    <ul class="ind" id="indicatorTiles">${items.map(pendingIndicatorTile).join("")}</ul>`;
}

function indicatorWaitingNote(source) {
  if (source.status === "not_configured") return "원천 확정 · ECOS 인증키 등록 대기 (값을 만들지 않습니다)";
  if (source.status === "error") return `원천 수집 실패 · ${source.note || "다음 갱신에 재시도"}`;
  return "원천 확정 전 · 값 연동 대기 (2026-08-23 실접속 검증한 후보)";
}

function pendingIndicatorTile(item) {
  const label = item.state === "paid" ? "유료·수기 검토" : item.state === "fixed" ? "원천 확정 · 연동 대기" : "자동 수집 후보";
  return `<li>
    <b>${escapeHtml(item.name)}</b><i>${escapeHtml(item.source)} · ${escapeHtml(item.cycle)}</i>
    <span class="state ${item.state === "paid" ? "paid" : ""}">${label}</span>
  </li>`;
}

// ---------------------------------------------------------------------------
// 종목 표
// ---------------------------------------------------------------------------
function sortButton(label, key, subLabel = "") {
  const active = state.sortKey === key;
  const arrow = active && state.sortDirection === "asc" ? "↑" : "↓";
  const full = subLabel ? `${label} ${subLabel}` : label;
  const sub = subLabel ? ` <span class="col-sub">${escapeHtml(subLabel)}</span>` : "";
  return `<button type="button" data-sort="${key}" data-active="${active}" data-arrow="${arrow}" aria-label="${escapeHtml(full)} 기준 정렬">${escapeHtml(label)}${sub}</button>`;
}

// 최고 보기에서는 추정 칸만 최고 추정치로 바꾼다. 확정 실적은 기준이 하나뿐이라 그대로다.
// 최고값이 없는 칸은 평균으로 되돌리지 않고 비운다. 되돌리면 어느 기준의 숫자인지 알 수 없다.
// 기준을 못 고르는 payload에서는 실려 온 값을 그대로 쓴다. 기대한 필드가 없다고 멀쩡한 숫자를 비우면 안 된다.
// horizons가 있는데 그 기준만 비어 있는 것은 진짜 결측이므로 다른 기준으로 되돌리지 않는다.
function financialValue(record, metric, basis = state.estimateBasis) {
  if (!record) return null;
  if (record.kind !== "estimate" || !record.horizons) return record[metric] ?? null;
  return record.horizons[basis]?.[metric] ?? null;
}

function financialCell(record, metric, extraClass = "") {
  const value = financialValue(record, metric);
  const className = record?.kind === "actual" ? "actual-cell" : record?.kind === "estimate" ? "estimate-cell" : "na";
  return `<td class="${className} ${extraClass}">${formatFinancial(value)}</td>`;
}

function performanceCell(stock, key, extraClass = "") {
  const value = stock.performance?.[key];
  const heat = returnHeatMeta(value, key);
  const heatAttributes = heat.weight ? ` data-heat-value="${value}" data-heat-strength="${heat.weight}" data-heat-bucket="${heat.bucket}"` : "";
  return `<td data-live-field="performance.${key}" class="${numberClass(value)} ${heat.className} ${extraClass}"${heatAttributes}>${formatPercent(value)}</td>`;
}

function revisionCell(stock, period, metric, extraClass = "") {
  const value = consensusRevision(stock, period, metric);
  return `<td data-revision-field="annual.${period}.${metric}" class="${numberClass(value)} ${extraClass}">${formatPercent(value)}</td>`;
}

// 배당수익률은 등락이 아니라 수준값이다. 부호와 상승·하락 색을 붙이지 않는다.
function formatLevelPercent(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Number(value).toFixed(digits)}%`;
}

function computedCell(stock, column, extraClass = "") {
  const value = COMPUTED[column.compute]?.(stock) ?? null;
  if (column.signed === false) {
    return `<td data-computed-field="${column.compute}" class="${value == null ? "na" : ""} ${extraClass}">${formatLevelPercent(value)}</td>`;
  }
  const heat = column.heat ? returnHeatMeta(value, column.heat) : { className: "", weight: 0, bucket: 0 };
  const attributes = heat.weight ? ` data-heat-value="${value}" data-heat-strength="${heat.weight}" data-heat-bucket="${heat.bucket}"` : "";
  return `<td data-computed-field="${column.compute}" class="${numberClass(value)} ${heat.className} ${extraClass}"${attributes}>${formatPercent(value)}</td>`;
}

function bodyCell(stock, column, extraClass = "") {
  switch (column.kind) {
    case "sector": return `<td class="${extraClass}">${escapeHtml(stock.sector)}</td>`;
    case "name": return `<td class="${extraClass}"><span class="stock-name" title="${escapeHtml(stock.name)}">${escapeHtml(stock.name)}</span></td>`;
    case "price": return `<td data-live-field="quote.price" class="${extraClass}">${formatPrice(stock.quote?.price)}</td>`;
    case "marketCap": return `<td data-live-field="quote.${column.field}" class="${extraClass}">${formatNumber(stock.quote?.[column.field])}</td>`;
    case "return": return performanceCell(stock, column.period, extraClass);
    case "financial": return financialCell(stock.annual?.[column.period], column.metric, extraClass);
    case "quarterFinancial": return financialCell(stock.quarter?.[column.period], column.metric, extraClass);
    case "revision": return revisionCell(stock, column.period, column.metric, extraClass);
    case "ratio": return `<td data-live-field="valuation.${column.period}.${column.ratio}" class="${extraClass}">${formatRatio(stock.valuation?.[column.period]?.[column.ratio], column.ratio)}</td>`;
    case "count": return `<td class="${extraClass}">${formatNumber(contributorCount(stock, column.period, column.metric))}</td>`;
    case "contributors": return `<td class="${extraClass}">${formatNumber(estimateContributors(stock, column.period))}</td>`;
    case "computed": return computedCell(stock, column, extraClass);
    default: return `<td class="na ${extraClass}">-</td>`;
  }
}

function sortValue(stock, key) {
  if (key === "consensus.contributors") return estimateContributors(stock, "2026");
  if (key.startsWith("computed.")) return COMPUTED[key.slice("computed.".length)]?.(stock) ?? null;
  // 화면에 보이는 값으로 정렬해야 한다. 최고 보기에서 평균으로 줄을 세우면 순서와 숫자가 어긋난다.
  if (/^(quarter|annual)\.[^.]+\.(revenue|operatingIncome|parentNetIncome)$/.test(key)) {
    const [scope, period, metric] = key.split(".");
    return financialValue(stock[scope]?.[period], metric);
  }
  if (key.startsWith("revision.annual.")) {
    const [, , period, metric] = key.split(".");
    return consensusRevision(stock, period, metric);
  }
  return getPath(stock, key);
}

function compareByMarketCap(left, right) {
  return ((right.quote?.marketCap ?? -Infinity) - (left.quote?.marketCap ?? -Infinity))
    || left.code.localeCompare(right.code);
}

function compareStocks(left, right) {
  // Pick 우선 정렬은 폐지됐다. 기본은 시가총액 내림차순.
  if (state.sortKey === "default") return compareByMarketCap(left, right);
  const a = sortValue(left, state.sortKey);
  const b = sortValue(right, state.sortKey);
  const missingA = a == null;
  const missingB = b == null;
  if (missingA !== missingB) return missingA ? 1 : -1;
  if (missingA) return left.code.localeCompare(right.code);
  const direction = state.sortDirection === "asc" ? 1 : -1;
  if (typeof a === "string") return a.localeCompare(b, "ko") * direction;
  return (Number(a) - Number(b)) * direction || left.code.localeCompare(right.code);
}

function filteredStocks() {
  const query = state.search.trim().toLocaleLowerCase("ko");
  return stocksInSector(state.sector).filter((stock) =>
    !query || stock.name.toLocaleLowerCase("ko").includes(query) || stock.code.includes(query));
}

// 2026-08-30 사용자 결정: 전체 화면은 76종목을 하나의 목록으로 세운다.
// 예전에는 섹터로 먼저 묶고 그 안에서만 정렬해서, 시총 열을 눌러도 시총 1위(지주 SK스퀘어 1,422,141억)가
// 금융 12종목 아래에 묻혔다. 어떤 열을 눌러도 화면에 있는 종목 전체가 그 기준으로 다시 선다.
// 섹터로 묶어 보고 싶으면 섹터 열 머리를 누른다.
function sortedBySector(stocks) {
  if (state.sortKey !== "sector") return [...stocks].sort(compareStocks);
  return SECTOR_ORDER.flatMap((sector) => stocks.filter((stock) => stock.sector === sector).sort(compareByMarketCap));
}

// 섹터 경계선은 섹터로 묶여 있을 때만 뜻이 있다. 섞여 있으면 거의 매 행에 걸려 잡음이 된다.
function isSectorGrouped() {
  return state.sortKey === "sector" || state.sector !== "all";
}

// 그룹 첫 칸에는 굵은 세로선, 그룹 안에서 성격이 바뀌는 칸(분기 → 연간)에는 같은 선을 한 번 더 긋는다.
// 그룹 이름 없이 세우는 칸(섹터·종목, 그리고 컨센서스 보기의 참여사).
function isPlainSection(section) {
  return section.key === "identity" || section.plain === true;
}

function columnEdgeClass(column, index) {
  if (index === 0) return "section-start";
  return column.subsection ? "subsection-start" : "";
}

function tableHtml() {
  const hidden = hiddenColumnsForSector();
  const sections = visibleSections(hidden);
  const groupRow = sections.map((section) => {
    if (isPlainSection(section)) {
      return section.columns.map((column, index) => `<th class="${column.className} ${section.key === "identity" ? "" : columnEdgeClass(column, index)}" rowspan="2" scope="col">${sortButton(column.label, column.sort, column.subLabel)}</th>`).join("");
    }
    return `<th class="group-head group-${section.key} section-start" colspan="${section.columns.length}" scope="colgroup">${escapeHtml(section.label)}</th>`;
  }).join("");
  const leafRow = sections
    .filter((section) => !isPlainSection(section))
    .flatMap((section) => section.columns.map((column, index) =>
      `<th class="${column.className} ${columnEdgeClass(column, index)}" scope="col">${column.sort ? sortButton(column.label, column.sort, column.subLabel) : escapeHtml(column.label)}</th>`))
    .join("");

  // table-layout: fixed 는 첫 행의 폭만 본다. 첫 행은 colspan 묶음 헤더라서 열마다 준 폭이 전부 무시되고
  // 모든 열이 똑같이 나뉘었다(2026-08-30 실측: 1440폭에서 17열이 전부 59px). colgroup 으로 폭을 되돌린다.
  const colGroup = `<colgroup>${sections.flatMap((section) => section.columns
    .map((column) => `<col class="${column.className.split(" ").filter((name) => name.endsWith("-col") || name.startsWith("sticky-")).join(" ")}"/>`)).join("")}</colgroup>`;

  const visible = sortedBySector(filteredStocks());
  let previousSector = null;
  const grouped = isSectorGrouped();
  const body = visible.map((stock) => {
    const sectorStart = grouped && previousSector !== null && stock.sector !== previousSector;
    previousSector = stock.sector;
    const cells = sections.flatMap((section) =>
      section.columns.map((column, index) => bodyCell(stock, column, section.key === "identity" ? "" : columnEdgeClass(column, index)))).join("");
    return `<tr data-code="${stock.code}" data-market="${marketForStock(stock)}" tabindex="0" aria-selected="${state.detailCode === stock.code}" class="${sectorStart ? "sector-start" : ""}">${cells}</tr>`;
  }).join("") || `<tr><td colspan="${visibleColumnCount(sections)}" class="empty-state">검색 결과가 없습니다.</td></tr>`;

  // 안내에는 지금 켜져 있는 열그룹만 적는다. 접혀 있는 열까지 적으면 무엇이 사라졌는지 흐려진다.
  const hiddenActive = [...hidden.values()].filter((column) => !column.group || state.columnGroups.has(column.group));
  const hiddenNote = hiddenActive.length
    ? `<p class="hidden-columns">${escapeHtml(state.sector)} 전 종목에 값이 없어 숨긴 열: ${hiddenActive.map(({ label }) => escapeHtml(label)).join(" · ")}</p>`
    : '<p class="hidden-columns"></p>';
  const pendingNote = PENDING_COLUMNS.length
    ? `<p class="pending-columns" id="pendingColumns">원천 연결 대기 열: ${PENDING_COLUMNS.map(({ label, pending }) => `${escapeHtml(label)} - ${escapeHtml(pending)}`).join(" · ")}</p>`
    : '<p class="pending-columns" id="pendingColumns"></p>';

  const basisSwitch = state.columnGroups.has(CONSENSUS_VIEW_KEY) && horizonsAvailable()
    ? `<span class="basis-switch" role="group" aria-label="컨센서스 기준">`
      + ESTIMATE_BASES
        .map(({ key, label, hint }) => `<button type="button" data-estimate-basis="${key}" aria-pressed="${state.estimateBasis === key}" title="${escapeHtml(hint)}">${escapeHtml(label)}</button>`)
        .join("")
      + "</span>"
    : "";
  return `<div class="toolbar">
      ${OPTIONAL_COLUMN_GROUPS.map((group) => `<button type="button" class="column-chip" data-column-group="${group.key}" aria-pressed="${state.columnGroups.has(group.key)}" title="${escapeHtml(group.hint)}">${escapeHtml(group.label)}</button>`).join("")}
      ${basisSwitch}
      <span class="spacer"></span>
      <span class="visible-count" id="visibleCount">${visible.length} / ${state.snapshot?.stocks?.length || 0}종목</span>
      <span class="return-heat-legend" aria-label="수익률 셀 색상: 0은 무채색, 상승은 빨강, 하락은 파랑, 진할수록 변동폭이 큼">하락<i class="return-heat-legend__bar" aria-hidden="true"></i>상승</span>
    </div>
    <div id="tableScroller" class="table-region" role="region" tabindex="0" aria-label="종목 비교표">
      <table id="universeTable" class="universe-table">
        ${colGroup}
        <thead id="tableHead"><tr>${groupRow}</tr><tr>${leafRow}</tr></thead>
        <tbody id="tableBody">${body}</tbody>
      </table>
    </div>
    ${pendingNote}
    ${hiddenNote}`;
}

// ---------------------------------------------------------------------------
// 화면 렌더
// ---------------------------------------------------------------------------
function viewHtml() {
  const stocks = stocksInSector(state.sector);
  const title = state.sector === "all"
    ? `전체 유니버스 — 8섹터 ${state.snapshot?.stocks?.length || 0}종목`
    : `${state.sector} — ${stocks.length}종목`;
  const middle = state.sector === "all"
    // 2026-08-30: 섹터 타일 8개를 없앴다. 1D가 사이드바와 8/8 동일하고 스파크라인은 위 차트의 축소판이라
    // 101px를 쓰면서 새 정보가 없었다. YTD−K는 차트 끝점에서 읽힌다.
    ? `<div class="home-grid">${homeGroupChart()}</div>`
    : `${sectorTrend(state.sector, stocks)}${foreignPeerTable(state.sector)}${indicatorTiles(state.sector)}`;
  const fixtureNote = state.snapshot?.mode === "fixture"
    ? "고정 fixture 검증 모드입니다. 실제 투자 판단에 사용할 수 없습니다."
    : "행을 클릭하면 오른쪽에 종목 상세가 열립니다.";
  return `<div class="topbar"><h2 id="viewTitle">${escapeHtml(title)}</h2></div>
    ${kpiStripHtml()}
    ${middle}
    ${tableHtml()}
    <p class="foot-note" id="footNote">자료: Kiwoom(시세) · ConsenDB 3M(컨센서스) · OpenDART(확정 실적). 가격·수익률은 KRX 정규장 기준이고 08~09시·15:30 이후에는 NXT 체결을 띄웁니다. 거래대금은 KRX+NXT 통합입니다. 결측은 보간 없이 빈칸입니다. ${escapeHtml(fixtureNote)}</p>`;
}

function renderView({ preserveScroll = false } = {}) {
  if (!state.snapshot) return;
  // 표가 더 이상 따로 스크롤되지 않는다(2026-08-27). 세로 위치는 페이지 스크롤에서 지킨다.
  // 실시간 체결이 1초마다 다시 그리므로 이걸 놓치면 화면이 계속 맨 위로 튄다.
  const scroller = $("#tableScroller");
  if (preserveScroll) {
    state.tableScrollLeft = scroller ? scroller.scrollLeft : 0;
    state.tableScrollTop = window.scrollY;
  }
  $("#view").innerHTML = viewHtml();
  const next = $("#tableScroller");
  syncTableOverflow(next);
  if (preserveScroll) {
    if (next) next.scrollLeft = state.tableScrollLeft;
    if (state.tableScrollTop) window.scrollTo({ top: state.tableScrollTop });
  }
}

// 넓은 화면에서는 표가 페이지와 같이 스크롤된다(열 이름이 화면 위에 붙어 있게 하려고).
// 열그룹 칩을 다 켜면 열이 30개까지 늘어 그 폭으로는 페이지 자체가 가로로 밀린다.
// 그때만 표를 자기 상자 안에서 스크롤시킨다. 페이지가 통째로 흔들리는 것보다 낫다.
function syncTableOverflow(region = $("#tableScroller")) {
  if (!region) return;
  const table = region.querySelector(".universe-table");
  if (!table) return;
  const overflows = table.getBoundingClientRect().width > region.clientWidth + 1;
  if (overflows) region.dataset.wide = "true";
  else delete region.dataset.wide;
}

function renderKpis() {
  const container = $("#kpis");
  if (!container) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = kpiStripHtml();
  container.replaceWith(wrapper.firstElementChild);
}

// ---------------------------------------------------------------------------
// 드로어 (우측 종목 상세)
// ---------------------------------------------------------------------------
// 2026-08-30 확정: 드로어는 과거 4분기 + 향후 4분기, 딱 8개다.
// 전체 표는 올해 4개 분기만 보여주므로 여기가 시계열을 길게 보는 유일한 자리다.
function quarterSeriesOf(stock, metric = profitMetricFor(stock.sector)) {
  const actuals = [...(stock.actuals?.quarter || [])]
    .filter((row) => row?.period)
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-QUARTER_HISTORY_COUNT);
  const consensus = stock.consensusComparison?.quarter || {};
  const lastActual = actuals.at(-1)?.period || "";
  const estimates = Object.keys(consensus)
    .filter((period) => period > lastActual && consensus[period]?.threeMonth)
    .sort()
    .slice(0, QUARTER_ESTIMATE_COUNT)
    .map((period) => ({ period, kind: "estimate", ...consensus[period].threeMonth }));
  return [...actuals, ...estimates].map((row) => ({
    period: row.period,
    label: quarterLabel(row.period),
    value: row[metric] ?? null,
    revenue: row.revenue ?? null,
    operatingIncome: row.operatingIncome ?? null,
    parentNetIncome: row.parentNetIncome ?? null,
    estimate: row.kind === "estimate",
    consensus: consensus[row.period]?.threeMonth?.[metric] ?? null,
  }));
}

function drawerConsensusTable(stock) {
  const rows = [
    ["매출액", "revenue"],
    ["영업이익", "operatingIncome"],
    ["지배순이익", "parentNetIncome"],
  ];
  // 한 칸에 1M·최고 두 값이 나란히 들어가면 그 행 때문에 표 전체가 드로어(460px)를 넘어
  // 가로 스크롤이 생겼다(2026-08-27 실측 472px vs 408px). 세로로 쌓아 칸 너비를 숫자 하나로 맞춘다.
  const horizonRow = (metric) => ANNUALS.map(([period]) => {
    const compare = stock.consensusComparison?.annual?.[period];
    if (!compare) return '<td class="est">-</td>';
    return `<td class="est stack"><span>${formatFinancial(compare.oneMonth?.[metric])}</span>`
      + `<span>${formatFinancial(compare.highest?.[metric])}</span></td>`;
  }).join("");
  return `<div class="fin-wrap"><table class="fin" id="drawerConsensus">
    <thead><tr><th class="l"></th>${ANNUALS.map(([period, label]) => `<th class="${period <= "2025" ? "" : "est"}">${label}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map(([label, metric]) => `<tr><td class="l">${label}</td>${ANNUALS.map(([period]) => {
        const row = stock.annual?.[period];
        const focus = metric === profitMetricFor(stock.sector) && period === "2026" ? " focus" : "";
        return `<td class="${row?.kind === "estimate" ? "est" : ""}${focus}">${formatFinancial(row?.[metric])}</td>`;
      }).join("")}</tr>`).join("")}
      <tr><td class="l">· ${profitLabelFor(stock.sector)} 1M / 최고</td>${horizonRow(profitMetricFor(stock.sector))}</tr>
      <tr><td class="l">참여 증권사</td>${ANNUALS.map(([period]) => `<td>${formatNumber(stock.annual?.[period]?.contributors)}</td>`).join("")}</tr>
      <tr><td class="l">지배주주지분</td>${ANNUALS.map(([period]) => `<td class="${stock.annual?.[period]?.kind === "estimate" ? "est" : ""}">${formatFinancial(stock.annual?.[period]?.parentEquity)}</td>`).join("")}</tr>
      <tr><td class="l">주당배당금 (원)</td>${ANNUALS.map(([period]) => `<td class="${stock.annual?.[period]?.kind === "estimate" ? "est" : ""}">${formatPrice(stock.annual?.[period]?.dividendPerShare)}</td>`).join("")}</tr>
    </tbody></table></div>`;
}

function drawerRevisionTable(stock) {
  const metrics = [["매출액", "revenue"], ["영업이익", "operatingIncome"], ["지배순이익", "parentNetIncome"]];
  const periods = ["2026", "2027"];
  const any = periods.some((period) => stock.consensusComparison?.annual?.[period]);
  if (!any) return '<p class="empty-state">1M · 3M · 최고 비교 데이터가 없습니다.</p>';
  return `<div class="fin-wrap"><table class="fin" id="drawerRevision">
    <thead><tr><th class="l"></th>${periods.flatMap((period) => [`<th>${period}E 3M</th>`, `<th>${period}E 1M변화</th>`]).join("")}</tr></thead>
    <tbody>${metrics.map(([label, metric]) => `<tr><td class="l">${label}</td>${periods.flatMap((period) => {
      const base = stock.consensusComparison?.annual?.[period]?.threeMonth?.[metric];
      const change = consensusRevision(stock, period, metric);
      return [`<td>${formatFinancial(base)}</td>`, `<td class="${numberClass(change)}">${formatPercent(change)}</td>`];
    }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="note">리포트 단위 어닝 리비전(증권사·목표주가·투자의견)은 사용자 추출 프로그램 연동 후 붙는다. 지금은 ConsenDB의 1M · 3M · 최고 비교만 쓴다.</p>`;
}

function drawerFilings(stock) {
  const rows = [...(stock.actuals?.annual || []), ...(stock.actuals?.quarter || [])]
    .filter((row) => row?.period)
    .sort((left, right) => right.period.localeCompare(left.period))
    .slice(0, 10);
  if (!rows.length) return '<p class="empty-state">OpenDART 확정 실적이 아직 적재되지 않았습니다.</p>';
  return `<ul class="events" id="drawerFilings">${rows.map((row) => `<li>
    <span><span class="tag">${escapeHtml(row.basis || "실적")}</span> ${escapeHtml(row.period)} 매출 ${formatFinancial(row.revenue)} · OP ${formatFinancial(row.operatingIncome)}</span>
    <span class="num">${row.filing?.receiptNumber
      ? `<a class="filing-link" href="${escapeHtml(row.filing.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.filing.receiptNumber)}</a>`
      : "-"}</span></li>`).join("")}</ul>`;
}

function drawerHtml(stock) {
  const dates = windowSlice(indexDates());
  const aligned = windowSlice(alignHistory(stock.history, indexDates()));
  const sector = sectorSeries(stock.sector);
  const series = [{ name: stock.name, values: aligned, cls: "s-main" }];
  if (sector?.values?.length) series.push({ name: `${stock.sector} 섹터`, values: windowSlice(sector.values), cls: "s-sector" });
  const chart = dates.length >= 2
    ? lineChart({ series: [...series, ...benchmarkSeriesFor(dates)], labels: dates, width: 430, height: 220 })
    : '<p class="empty-state">주가 이력이 아직 없습니다.</p>';
  // 금융·보험·증권·지주는 영업이익 대신 지배순이익이 주력 지표다(전체 화면 (C)안과 같은 규칙).
  const profitMetric = profitMetricFor(stock.sector);
  const profitName = profitLabelFor(stock.sector);
  const otherMetric = profitMetric === "parentNetIncome" ? "operatingIncome" : "parentNetIncome";
  const otherName = profitMetric === "parentNetIncome" ? "영업이익" : "지배순이익";
  const quarters = quarterSeriesOf(stock, profitMetric);
  const recent = quarters;
  const kospiYtd = benchmarkOf("KOSPI")?.ytd ?? null;
  const ytd = stock.performance?.ytd;
  const relative = Number.isFinite(ytd) && Number.isFinite(kospiYtd) ? ytd - kospiYtd : null;
  const opRevision = consensusRevision(stock, "2026", profitMetricFor(stock.sector));
  const valuation = stock.valuation?.["2026"] || {};
  const previousClose = stock.history?.at(-2)?.close ?? null;
  const change = Number.isFinite(stock.quote?.price) && Number.isFinite(previousClose) ? stock.quote.price - previousClose : null;

  return `<div class="drawer-inner">
    <div class="drawer-head">
      <div><p class="crumb">${escapeHtml(stock.sector)} · ${stock.code} · ${escapeHtml(marketForStock(stock))}</p><h2 id="drawerName">${escapeHtml(stock.name)}</h2></div>
      <button class="close" id="closeDrawer" type="button" aria-label="종목 상세 닫기">×</button>
    </div>
    <div class="price-line">
      <span class="px" id="detailPrice">${formatPrice(stock.quote?.price)}</span>
      <span class="chg ${numberClass(stock.performance?.d1)}" id="detailChange">${formatSignedNumber(change)} (${formatPercent(stock.performance?.d1, 2)})</span>
      <span class="sub" id="detailMarketCap">시가총액 ${formatMarketCap(stock.quote?.marketCap)} · ${escapeHtml(sourceDisplayName("quote", stock.quote?.source))} · ${formatTimestamp(stock.quote?.observedAt)}</span>
    </div>
    <dl class="dgrid" id="drawerRatios">
      <div><dt>P/E 26E</dt><dd data-live-field="valuation.2026.pe">${formatRatio(valuation.pe, "pe")}</dd><small>27E ${formatRatio(stock.valuation?.["2027"]?.pe, "pe")}</small></div>
      <div><dt>P/B 26E</dt><dd data-live-field="valuation.2026.pb">${formatRatio(valuation.pb, "pb")}</dd><small>ROE ${formatRatio(valuation.roe, "roe")}</small></div>
      <div><dt>${profitShortFor(stock.sector)} 26E 1M변화</dt><dd class="${numberClass(opRevision)}">${formatPercent(opRevision)}</dd><small>1M ÷ 3M − 1</small></div>
      <div><dt>YTD</dt><dd class="${numberClass(ytd)}" data-performance="ytd">${formatPercent(ytd)}</dd><small>vs KOSPI ${formatPercent(relative, 1)}</small></div>
      <div><dt>52주高比</dt><dd class="${numberClass(stock.performance?.drawdown52w)}" data-performance="drawdown52w">${formatPercent(stock.performance?.drawdown52w)}</dd><small>1Y ${formatPercent(stock.performance?.y1, 1)}</small></div>
      <div><dt>목표가 괴리</dt><dd class="${numberClass(COMPUTED.targetGap(stock))}">${formatPercent(COMPUTED.targetGap(stock))}</dd>
        <small>TP ${formatPrice(targetPriceOf(stock))} (${targetPriceLabel()}) · 배당 ${formatLevelPercent(COMPUTED.dividendYield(stock))}</small></div>
    </dl>
    <section class="panel"><div class="panel-head"><h3>주가 vs 섹터 · 벤치마크</h3>
        <span class="tools">${rangeButtons()}</span></div>
      ${chart}
      <div class="chart-legend"><span><i></i>${escapeHtml(stock.name)}</span><span><i class="sector"></i>${escapeHtml(stock.sector)} 섹터</span>
        <span><i class="ctx"></i>KOSPI</span><span><i class="ctx2"></i>KOSDAQ</span><span class="unit">기간 시작 = 100</span></div></section>
    <section class="panel"><div class="panel-head"><h3>컨센서스 · 연간</h3><span class="unit">억원 · 3M 평균</span></div>
      ${drawerConsensusTable(stock)}</section>
    <section class="panel"><div class="panel-head"><h3>분기 ${profitName} — 실적 ${quarters.filter((row) => !row.estimate).length} + 추정 ${quarters.filter((row) => row.estimate).length}</h3><span class="unit">억원</span></div>
      ${quarterBarChart(quarters)}
      <div class="chart-legend"><span><i class="solid"></i>확정 실적</span><span><i class="box-e"></i>3M 추정</span><span><i class="acc"></i>발표 전 컨센</span></div>
      <div class="fin-wrap"><table class="fin" id="drawerQuarters">
        <thead><tr><th class="l"></th>${recent.map((row) => `<th class="${row.estimate ? "est" : ""}">${escapeHtml(row.label)}</th>`).join("")}</tr></thead>
        <tbody>
          <tr><td class="l">${profitName}</td>${recent.map((row) => `<td class="${row.estimate ? "est" : ""}">${formatFinancial(row.value)}</td>`).join("")}</tr>
          <tr><td class="l">컨센 3M</td>${recent.map((row) => `<td>${formatFinancial(row.consensus)}</td>`).join("")}</tr>
          <tr><td class="l">서프라이즈</td>${recent.map((row) => {
            const surprise = !row.estimate && Number.isFinite(row.value) && Number.isFinite(row.consensus) && row.consensus > 0
              ? ((row.value / row.consensus) - 1) * 100 : null;
            return `<td class="${numberClass(surprise)}">${formatPercent(surprise)}</td>`;
          }).join("")}</tr>
          <tr><td class="l">${otherName}</td>${recent.map((row) => `<td class="${row.estimate ? "est" : ""}">${formatFinancial(row[otherMetric])}</td>`).join("")}</tr>
        </tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h3>컨센서스 리비전</h3><span class="unit">억원 · %</span></div>
      ${drawerRevisionTable(stock)}</section>
    <section class="panel"><div class="panel-head"><h3>확정 실적 공시</h3><span class="unit">OpenDART</span></div>
      ${drawerFilings(stock)}
      <p class="note source-line" data-source-keys="quote,actuals,consensus">${sourceLine(["quote", "actuals", "consensus"])}</p></section>
  </div>`;
}

function renderDrawer() {
  const drawer = $("#drawer");
  const main = $("#main");
  if (!state.detailCode) {
    drawer.hidden = true;
    drawer.innerHTML = "";
    main.classList.remove("has-drawer");
    document.title = state.sector === "all" ? "홍대현 Universe" : `${state.sector} · 홍대현 Universe`;
    return;
  }
  drawer.hidden = false;
  main.classList.add("has-drawer");
  if (state.detailLoading || !state.detail) {
    drawer.innerHTML = '<div class="loading-shell">종목 상세를 불러오는 중입니다.</div>';
    return;
  }
  drawer.innerHTML = drawerHtml(state.detail);
  document.title = `${state.detail.name} · 홍대현 Universe`;
}

async function loadDetail(code) {
  state.detailLoading = true;
  renderDrawer();
  try {
    const response = await fetch(RUNTIME.stockUrl(code), { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? "Universe에 없는 종목입니다." : "상세 API 오류");
    const stock = await response.json();
    if (state.detailCode !== code) return;
    if (state.snapshot && stock.sources) state.snapshot.sources = stock.sources;
    state.detail = stock;
    state.detailLoading = false;
    renderDrawer();
  } catch (error) {
    state.detailLoading = false;
    state.detail = null;
    $("#drawer").innerHTML = `<div class="drawer-inner"><div class="drawer-head"><div><h2>불러오지 못했습니다</h2></div>`
      + `<button class="close" id="closeDrawer" type="button" aria-label="종목 상세 닫기">×</button></div>`
      + `<p class="empty-state">${escapeHtml(error.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// 실시간 반영
// ---------------------------------------------------------------------------
function updateReturnCell(root, key, value) {
  const element = root?.querySelector(`[data-live-field="performance.${key}"]`);
  if (!element) return;
  const heat = returnHeatMeta(value, key);
  element.textContent = formatPercent(value);
  const sectionStart = element.classList.contains("section-start") ? "section-start" : "";
  element.className = `${numberClass(value)} ${heat.className} ${sectionStart}`;
  if (heat.weight) {
    element.dataset.heatValue = String(value);
    element.dataset.heatStrength = String(heat.weight);
    element.dataset.heatBucket = String(heat.bucket);
  } else {
    delete element.dataset.heatValue;
    delete element.dataset.heatStrength;
    delete element.dataset.heatBucket;
  }
}

// 값이 바뀐 셀을 잠깐 물들인다. 같은 클래스를 다시 붙이면 애니메이션이 재생되지 않으므로
// 지웠다가 강제 리플로우 뒤 다시 붙인다.
function flashTick(cell, delta) {
  if (!cell || !Number.isFinite(delta) || delta === 0) return;
  cell.classList.remove("tick-up", "tick-down");
  void cell.offsetWidth;
  cell.classList.add(delta > 0 ? "tick-up" : "tick-down");
}

// 화면에 찍혀 있던 숫자를 되읽어 방향을 구한다. 서버가 직전 값을 따로 주지 않으므로 이게 가장 단순하다.
function renderedNumber(text) {
  const parsed = Number(String(text ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function updateLiveRow(stock) {
  const row = $(`#tableBody tr[data-code="${stock.code}"]`);
  if (!row) return;
  const price = row.querySelector('[data-live-field="quote.price"]');
  const marketCap = row.querySelector('[data-live-field="quote.marketCap"]');
  if (price) {
    const nextText = formatPrice(stock.quote?.price);
    if (price.textContent !== nextText) {
      const before = renderedNumber(price.textContent);
      const after = renderedNumber(nextText);
      price.textContent = nextText;
      if (before != null && after != null) flashTick(price, after - before);
    }
  }
  if (marketCap) marketCap.textContent = formatNumber(stock.quote?.marketCap);
  for (const key of ["d1", "d5", "d20", "ytd", "y1", "drawdown52w"]) updateReturnCell(row, key, stock.performance?.[key]);
  for (const [compute, calculate] of Object.entries(COMPUTED)) {
    const cell = row.querySelector(`[data-computed-field="${compute}"]`);
    if (!cell) continue;
    const value = calculate(stock);
    const sectionStart = cell.classList.contains("section-start") ? "section-start" : "";
    if (compute === "dividendYield") {
      cell.textContent = formatLevelPercent(value);
      cell.className = `${value == null ? "na" : ""} ${sectionStart}`;
      continue;
    }
    cell.textContent = formatPercent(value);
    const heat = returnHeatMeta(value, "targetGap");
    cell.className = `${numberClass(value)} ${heat.className} ${sectionStart}`;
  }
  for (const period of ["2026", "2027"]) {
    for (const kind of ["pe", "pb", "roe"]) {
      const cell = row.querySelector(`[data-live-field="valuation.${period}.${kind}"]`);
      if (cell) cell.textContent = formatRatio(stock.valuation?.[period]?.[kind], kind);
    }
  }
}

function updateLiveDrawer(payload) {
  if (!state.detail || state.detailCode !== payload.quote?.code) return;
  state.detail.quote = { ...state.detail.quote, ...payload.quote };
  state.detail.performance = payload.performance || state.detail.performance;
  state.detail.valuation = payload.valuation || state.detail.valuation;
  const price = $("#detailPrice");
  const marketCap = $("#detailMarketCap");
  const change = $("#detailChange");
  if (price) price.textContent = formatPrice(state.detail.quote?.price);
  if (marketCap) {
    marketCap.textContent = `시가총액 ${formatMarketCap(state.detail.quote?.marketCap)} · ${sourceDisplayName("quote", state.detail.quote?.source)} · ${formatTimestamp(state.detail.quote?.observedAt)}`;
  }
  if (change) {
    const previousClose = state.detail.history?.at(-2)?.close ?? null;
    const delta = Number.isFinite(state.detail.quote?.price) && Number.isFinite(previousClose) ? state.detail.quote.price - previousClose : null;
    change.textContent = `${formatSignedNumber(delta)} (${formatPercent(state.detail.performance?.d1, 2)})`;
    change.className = `chg ${numberClass(state.detail.performance?.d1)}`;
  }
  for (const element of $$("#drawer [data-performance]")) {
    const value = state.detail.performance?.[element.dataset.performance];
    element.textContent = formatPercent(value);
    element.className = numberClass(value);
  }
  for (const element of $$("#drawer [data-live-field^='valuation.']")) {
    const [, period, kind] = element.dataset.liveField.split(".");
    element.textContent = formatRatio(state.detail.valuation?.[period]?.[kind], kind);
  }
  for (const element of $$("#drawer .source-line[data-source-keys]")) {
    element.textContent = sourceLine(element.dataset.sourceKeys.split(","));
  }
}

function flushLiveUpdates() {
  if (!state.liveUpdates.size) return;
  const updates = [...state.liveUpdates.values()];
  state.liveUpdates.clear();
  for (const payload of updates) {
    const stock = state.snapshot?.stocks.find(({ code }) => code === payload.quote?.code);
    if (stock) updateLiveRow(stock);
    updateLiveDrawer(payload);
  }
  renderKpis();
  renderSidebar();
}

// ---------------------------------------------------------------------------
// 라우팅 · 이벤트
// ---------------------------------------------------------------------------
function route() {
  const hash = location.hash || "#/";
  const stockMatch = /^#\/stock\/(\d{6})$/.exec(hash);
  const sectorMatch = /^#\/sector\/(.+)$/.exec(hash);
  const previousSector = state.sector;
  const previousCode = state.detailCode;

  if (stockMatch) {
    state.detailCode = stockMatch[1];
    const stock = state.snapshot?.stocks.find(({ code }) => code === state.detailCode);
    if (stock && state.sector !== "all" && state.sector !== stock.sector) state.sector = stock.sector;
  } else if (sectorMatch) {
    const sector = decodeURIComponent(sectorMatch[1]);
    state.sector = SECTOR_ORDER.includes(sector) ? sector : "all";
    state.detailCode = null;
  } else {
    state.sector = "all";
    state.detailCode = null;
  }

  if (previousCode !== state.detailCode) {
    state.detail = null;
    state.detailLoading = false;
  }
  renderSidebar();
  renderView({ preserveScroll: previousSector === state.sector });
  if (state.detailCode) {
    if (state.detailCode !== previousCode || !state.detail) loadDetail(state.detailCode);
    else renderDrawer();
  } else {
    renderDrawer();
  }
}

function handleSort(key) {
  if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  else {
    state.sortKey = key;
    state.sortDirection = ["name", "sector"].includes(key) ? "asc" : "desc";
  }
  renderView({ preserveScroll: true });
}

function toggleColumnGroup(key) {
  if (state.columnGroups.has(key)) state.columnGroups.delete(key);
  else state.columnGroups.add(key);
  writeStorage(COLUMN_GROUP_STORAGE_KEY, JSON.stringify([...state.columnGroups]));
  renderView({ preserveScroll: true });
  $(`[data-column-group="${key}"]`)?.focus();
}


function setEstimateBasis(basis) {
  if (state.estimateBasis === basis || !ESTIMATE_BASES.some(({ key }) => key === basis)) return;
  state.estimateBasis = basis;
  writeStorage(ESTIMATE_BASIS_STORAGE_KEY, basis);
  renderView({ preserveScroll: true });
  $(`[data-estimate-basis="${basis}"]`)?.focus();
}

function bindEvents() {
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    const matches = filteredStocks().length;
    $("#searchHint").textContent = state.search.trim() ? String(matches) : "";
    renderView({ preserveScroll: true });
  });

  $("#view").addEventListener("click", (event) => {
    const sort = event.target.closest("[data-sort]");
    if (sort) return handleSort(sort.dataset.sort);
    const chip = event.target.closest("[data-column-group]");
    if (chip) return toggleColumnGroup(chip.dataset.columnGroup);
    const basis = event.target.closest("[data-estimate-basis]");
    if (basis) return setEstimateBasis(basis.dataset.estimateBasis);
    const range = event.target.closest("[data-range]");
    if (range) { state.range = parseRangeValue(range.dataset.range); return renderView({ preserveScroll: true }); }
    const row = event.target.closest("tr[data-code]");
    if (row) location.hash = `#/stock/${row.dataset.code}`;
  });

  $("#view").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const row = event.target.closest("tr[data-code]");
    if (row) { event.preventDefault(); location.hash = `#/stock/${row.dataset.code}`; }
  });

  $("#drawer").addEventListener("click", (event) => {
    if (event.target.closest("#closeDrawer")) {
      location.hash = state.sector === "all" ? "#/" : `#/sector/${encodeURIComponent(state.sector)}`;
      return;
    }
    const range = event.target.closest("[data-range]");
    if (range) {
      state.range = parseRangeValue(range.dataset.range);
      renderDrawer();
      renderView({ preserveScroll: true });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.detailCode) {
      location.hash = state.sector === "all" ? "#/" : `#/sector/${encodeURIComponent(state.sector)}`;
    }
  });
  window.addEventListener("hashchange", route);

  // 차트 폭을 실제 컨테이너에서 재므로 창 크기가 바뀌면 다시 그려야 한다.
  // 드래그 중에 매번 그리면 무거워서 멈춘 뒤 한 번만 그린다.
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;   // 세로만 바뀌면 차트 폭은 그대로다
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderView({ preserveScroll: true });
      if (state.detailCode) renderDrawer();
    }, 150);
  });
}

function setConnection(className, text) {
  const element = $("#connectionState");
  element.className = `status ${className}`;
  element.textContent = text;
}

function connectQuoteSocket() {
  if (RUNTIME.staticMode) {
    // 2026-08-25 확정 #4·#7: 실시간은 로컬 8848 전용, 공개 정적본은 지연 스냅샷만 본다.
    const fixture = state.snapshot?.mode === "fixture" ? "Fixture 검증 모드 · " : "";
    setConnection("delayed", `${fixture}지연 스냅샷 · ${formatTimestamp(state.snapshot?.generatedAt)} 기준`);
    return;
  }
  if (state.snapshot?.mode === "fixture") {
    setConnection("", "Fixture 검증 모드");
    return;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws/quotes`);
  socket.addEventListener("open", () => setConnection("live", "실시간 채널 연결"));
  socket.addEventListener("message", (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === "snapshot" && payload.snapshot?.stocks) {
      state.liveUpdates.clear();
      state.snapshot = payload.snapshot;
      renderSidebar();
      renderView({ preserveScroll: true });
      if (state.detailCode) loadDetail(state.detailCode);
      return;
    }
    if (payload.type !== "quote") return;
    const stock = state.snapshot?.stocks.find(({ code }) => code === payload.quote?.code);
    if (!stock) return;
    stock.quote = { ...stock.quote, ...payload.quote };
    stock.performance = payload.performance || stock.performance;
    stock.valuation = payload.valuation || stock.valuation;
    if (payload.source) state.snapshot.sources.quote = payload.source;
    state.snapshot.generatedAt = payload.quote?.observedAt || state.snapshot.generatedAt;
    state.liveUpdates.set(stock.code, payload);
  });
  socket.addEventListener("close", () => {
    setConnection("offline", "재연결 대기");
    setTimeout(connectQuoteSocket, 2500);
  });
  socket.addEventListener("error", () => socket.close());
}

async function initialize() {
  loadPreferences();
  applyTheme();
  bindEvents();
  const response = await fetch(RUNTIME.snapshotUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("스냅샷 API를 불러오지 못했습니다.");
  state.snapshot = await response.json();
  route();
  connectQuoteSocket();
  setInterval(flushLiveUpdates, 1000);
  setInterval(async () => {
    if (document.hidden) return;
    try {
      if (RUNTIME.staticMode) {
        await refreshStaticQuotes();
        return;
      }
      const next = await fetch(RUNTIME.snapshotUrl, { cache: "no-store" });
      if (!next.ok) return;
      state.liveUpdates.clear();
      state.snapshot = await next.json();
      renderSidebar();
      renderView({ preserveScroll: true });
      if (state.detailCode) loadDetail(state.detailCode);
    } catch { /* WebSocket 재연결 표시가 주 신호다. */ }
  }, 60_000);
}

// 정적 배포본 갱신. 가벼운 시세 델타만 읽어 스냅샷 위에 덮어쓴다.
// 델타가 다른 전체 스냅샷을 가리키면(컨센·실적이 갱신됐다는 뜻) 그때만 스냅샷을 통째로 다시 받는다.
async function refreshStaticQuotes() {
  const response = await fetch(RUNTIME.quotesUrl, { cache: "no-store" });
  if (!response.ok) return;
  const quotes = await response.json();
  if (quotes.snapshotGeneratedAt && quotes.snapshotGeneratedAt !== state.snapshot?.generatedAt) {
    const next = await fetch(RUNTIME.snapshotUrl, { cache: "no-store" });
    if (next.ok) {
      state.liveUpdates.clear();
      state.snapshot = await next.json();
      renderSidebar();
      renderView({ preserveScroll: true });
      if (state.detailCode) loadDetail(state.detailCode);
      return;
    }
  }
  applyQuotesDelta(quotes);
}

// 시세 델타를 스냅샷에 병합한다. WebSocket 경로가 종목 하나씩 하는 일을 한 번에 하는 것이다.
function mergeQuotesDelta(snapshot, quotes) {
  if (!snapshot?.stocks || !Array.isArray(quotes?.stocks)) return snapshot;
  const byCode = new Map(snapshot.stocks.map((stock) => [stock.code, stock]));
  for (const incoming of quotes.stocks) {
    const stock = byCode.get(incoming.code);
    if (!stock) continue;
    if (incoming.quote) stock.quote = { ...stock.quote, ...incoming.quote };
    if (incoming.performance) stock.performance = incoming.performance;
    if (incoming.valuation) stock.valuation = incoming.valuation;
  }
  if (quotes.sources?.quote) snapshot.sources = { ...snapshot.sources, quote: quotes.sources.quote };
  if (quotes.marketBreadth) snapshot.marketBreadth = quotes.marketBreadth;
  if (quotes.generatedAt) snapshot.generatedAt = quotes.generatedAt;
  return snapshot;
}

// 브라우저 QA 전용 seam. state와 렌더 함수가 모듈 스코프라 밖에서 실제 경로를 태울 방법이 없다.
//  - mergeQuotesDelta: 60초 주기를 기다리지 않고 합성 시세 델타를 병합해 본다(정적 배포본).
//  - simulateTick: 장이 닫혀 체결이 없을 때도 틱 플래시 경로를 검사한다. 값은 되돌린다.
window.__hduTest = {
  mergeQuotesDelta: (quotes) => applyQuotesDelta(quotes),
  // 옛 payload(기준별 값 없음)에서도 숫자가 그대로 나오는지 확인하는 회귀 검사용.
  financialValue: (record, metric, basis) => financialValue(record, metric, basis),
  horizonsAvailable: () => horizonsAvailable(),
  simulateTick: (code, delta) => {
    const stock = state.snapshot?.stocks.find((item) => item.code === code);
    if (!stock) return null;
    const original = stock.quote.price;
    stock.quote = { ...stock.quote, price: original + delta };
    // flushLiveUpdates는 payload.quote.code로 종목을 찾는다. fixture의 quote에는 code가 없어
    // 여기서 반드시 채워 줘야 실제 갱신 경로를 탄다.
    state.liveUpdates.set(code, { quote: { ...stock.quote, code } });
    return () => {
      stock.quote = { ...stock.quote, price: original };
      state.liveUpdates.set(code, { quote: { ...stock.quote, code } });
    };
  },
};

function applyQuotesDelta(quotes) {
  if (!state.snapshot) return;
  mergeQuotesDelta(state.snapshot, quotes);
  state.liveUpdates.clear();
  renderSidebar();
  renderView({ preserveScroll: true });
  const fixture = state.snapshot?.mode === "fixture" ? "Fixture 검증 모드 · " : "";
  setConnection("delayed", `${fixture}지연 스냅샷 · ${formatTimestamp(state.snapshot?.generatedAt)} 기준`);
}

initialize().catch((error) => {
  setConnection("offline", "로드 실패");
  $("#view").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
