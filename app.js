const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// 실행 모드. 라이브 서버는 /api/*, 정적 배포본은 빌드된 상대경로 JSON을 읽는다.
// 정적 배포본은 index.html의 <script src="app.js?mode=static"> 로만 구분한다(추가 요청 없음).
const RUNTIME = (() => {
  const staticMode = new URL(import.meta.url).searchParams.get("mode") === "static";
  return {
    staticMode,
    snapshotUrl: staticMode ? "data/snapshot.json" : "/api/snapshot",
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
const ANNUALS = [["2025", "2025"], ["2026", "2026E"], ["2027", "2027E"], ["2028", "2028E"]];
// 분기는 확정 실적 8개 + 추정 4개.
const QUARTER_ESTIMATE_COUNT = 4;
const SOURCE_LABELS = { quote: "시세", actuals: "공시", consensus: "컨센서스" };
const HORIZON_LABELS = { oneMonth: "1M 평균", threeMonth: "3M 평균", highest: "3M 최고" };
const RANGES = [[62, "3M"], [124, "6M"], [0, "1Y"]];
const BENCHMARK_MODES = [["KOSPI", "KOSPI"], ["KOSDAQ", "KOSDAQ"], ["both", "둘 다"]];
const RETURN_HEAT_CAPS = {
  d1: { positive: 10, negative: 5 },
  d5: { positive: 20, negative: 10 },
  d20: { positive: 50, negative: 25 },
  ytd: { positive: 200, negative: 100 },
  y1: { positive: 200, negative: 100 },
  targetGap: { positive: 50, negative: 25 },
};
const THEME_STORAGE_KEY = "hongdaehyun-universe:theme-v1";
const KPI_COLLAPSE_STORAGE_KEY = "hongdaehyun-universe:kpi-summary-collapsed-v2";
const COLUMN_GROUP_STORAGE_KEY = "hongdaehyun-universe:column-groups-v1";

// 섹터별 트래킹 지표 — 2026-08-23 실접속으로 확인한 원천 "후보"다. 정본은 docs/indicator-sources.md.
// 원천이 확정되기 전까지는 값을 만들지 않고 대기 카드로만 노출한다(예시 수치 금지).
const INDICATOR_CATALOG = {
  "금융": [
    { name: "국고채 3년", source: "한은 ECOS 817Y002", cycle: "일", state: "auto" },
    { name: "은행채 AAA 1년", source: "한국자산평가 민평", cycle: "일", state: "auto" },
    { name: "예대금리차", source: "ECOS 121Y002 / 121Y006", cycle: "월", state: "auto" },
    { name: "가계·기업 대출잔액", source: "ECOS 104Y016", cycle: "월", state: "auto" },
    { name: "기준금리", source: "ECOS 722Y001", cycle: "수시", state: "auto" },
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
  kpiCollapsed: true,
  columnGroups: new Set(),
  range: 0,
  bench: "both",
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
  const collapsed = readStorage(KPI_COLLAPSE_STORAGE_KEY);
  state.kpiCollapsed = collapsed == null ? true : collapsed === "true";
  try {
    const saved = JSON.parse(readStorage(COLUMN_GROUP_STORAGE_KEY) || "[]");
    state.columnGroups = new Set(Array.isArray(saved) ? saved.filter((key) => OPTIONAL_COLUMN_GROUPS.some((group) => group.key === key)) : []);
  } catch {
    state.columnGroups = new Set();
  }
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
  // 장이 닫혀 있으면 시세가 안 움직이는 게 정상이다. 오래됐다고 겁줄 일이 아니다.
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
const OPTIONAL_COLUMN_GROUPS = [
  { key: "returnsPlus", label: "수익률+", hint: "5D · 20D · 1Y · 52주高比" },
  { key: "profitPlus", label: "순이익·P/B", hint: "순이익 26E·27E · P/B 26E" },
  { key: "consensusDetail", label: "컨센 상세", hint: "추정 참여 증권사 수" },
];

const COLUMN_SECTIONS = [
  {
    key: "identity",
    columns: [
      { key: "sector", label: "섹터", sort: "sector", className: "sticky-sector", kind: "sector" },
      { key: "name", label: "종목", sort: "name", className: "sticky-stock", kind: "name" },
    ],
  },
  {
    key: "quote",
    label: "시세",
    columns: [
      { key: "price", label: "현재가", sort: "quote.price", className: "base-col price-col", kind: "price" },
      { key: "d1", label: "1D", sort: "performance.d1", className: "base-col return-col", kind: "return", period: "d1" },
      { key: "marketCap", label: "시총", sort: "quote.marketCap", className: "base-col market-cap-col", kind: "marketCap", field: "marketCap" },
      { key: "tradingValue", label: "거래대금", sort: "quote.tradingValue", className: "base-col market-cap-col", kind: "marketCap", field: "tradingValue" },
    ],
  },
  {
    key: "returns",
    label: "수익률",
    columns: [
      { key: "ytd", label: "YTD", sort: "performance.ytd", className: "base-col return-col", kind: "return", period: "ytd" },
      { key: "d5", label: "5D", sort: "performance.d5", className: "base-col return-col", kind: "return", period: "d5", group: "returnsPlus" },
      { key: "d20", label: "20D", sort: "performance.d20", className: "base-col return-col", kind: "return", period: "d20", group: "returnsPlus" },
      { key: "y1", label: "1Y", sort: "performance.y1", className: "base-col return-col", kind: "return", period: "y1", group: "returnsPlus" },
      { key: "drawdown52w", label: "52주高比", sort: "performance.drawdown52w", className: "base-col return-col", kind: "return", period: "drawdown52w", group: "returnsPlus" },
    ],
  },
  {
    key: "consensus",
    label: "컨센서스 (억원)",
    columns: [
      { key: "rev2026", label: "매출 26E", sort: "annual.2026.revenue", className: "metric-col", kind: "financial", period: "2026", metric: "revenue" },
      { key: "rev2027", label: "매출 27E", sort: "annual.2027.revenue", className: "metric-col", kind: "financial", period: "2027", metric: "revenue" },
      { key: "op2026", label: "OP 26E", sort: "annual.2026.operatingIncome", className: "metric-col", kind: "financial", period: "2026", metric: "operatingIncome" },
      { key: "op2027", label: "OP 27E", sort: "annual.2027.operatingIncome", className: "metric-col", kind: "financial", period: "2027", metric: "operatingIncome" },
      { key: "opRevision", label: "OP 1M변화", sort: "revision.annual.2026.operatingIncome", className: "metric-col revision-col", kind: "revision", period: "2026", metric: "operatingIncome" },
      { key: "np2026", label: "순이익 26E", sort: "annual.2026.parentNetIncome", className: "metric-col", kind: "financial", period: "2026", metric: "parentNetIncome", group: "profitPlus" },
      { key: "np2027", label: "순이익 27E", sort: "annual.2027.parentNetIncome", className: "metric-col", kind: "financial", period: "2027", metric: "parentNetIncome", group: "profitPlus" },
    ],
  },
  {
    key: "valuation",
    label: "밸류에이션 26E",
    columns: [
      { key: "pe", label: "P/E", sort: "valuation.2026.pe.value", className: "ratio-col", kind: "ratio", period: "2026", ratio: "pe" },
      { key: "roe", label: "ROE", sort: "valuation.2026.roe.value", className: "ratio-col", kind: "ratio", period: "2026", ratio: "roe" },
      { key: "pb", label: "P/B", sort: "valuation.2026.pb.value", className: "ratio-col", kind: "ratio", period: "2026", ratio: "pb", group: "profitPlus" },
    ],
  },
  {
    key: "consensusDetail",
    label: "컨센 상세",
    columns: [
      { key: "contributors", label: "참여사", sort: "annual.2026.contributors", className: "metric-col", kind: "count", period: "2026", group: "consensusDetail" },
      { key: "dividendYield", label: "배당수익률", sort: "computed.dividendYield", className: "metric-col", kind: "computed", compute: "dividendYield", signed: false, group: "consensusDetail" },
      { key: "targetGap", label: "목표가 괴리", sort: "computed.targetGap", className: "metric-col revision-col", kind: "computed", compute: "targetGap", heat: "targetGap", group: "consensusDetail" },
    ],
  },
];

const PENDING_COLUMNS = COLUMN_SECTIONS.flatMap(({ columns }) => columns.filter(({ pending }) => pending));

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
    const target = stock.annual?.["2026"]?.targetPrice;
    const price = stock.quote?.price;
    if (!Number.isFinite(target) || !Number.isFinite(price) || price <= 0) return null;
    return ((target / price) - 1) * 100;
  },
};

// 결측 판정용 원시값. 섹터 페이지에서 "전원이 결측인 열"을 숨길 때 쓴다.
function columnValue(stock, column) {
  switch (column.kind) {
    case "price": return stock.quote?.price ?? null;
    case "marketCap": return stock.quote?.[column.field] ?? null;
    case "return": return stock.performance?.[column.period] ?? null;
    case "financial": return stock.annual?.[column.period]?.[column.metric] ?? null;
    case "revision": return consensusRevision(stock, column.period, column.metric);
    case "ratio": {
      const result = stock.valuation?.[column.period]?.[column.ratio];
      return result && result.status === "ok" ? result.value : null;
    }
    case "count": return stock.annual?.[column.period]?.contributors ?? null;
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
  for (const section of COLUMN_SECTIONS) {
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
  return COLUMN_SECTIONS
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

// 시총가중 평균 수익률. 시총 또는 수익률이 없는 종목은 분모에서도 뺀다.
function weightedPerformance(stocks = [], key = "d1") {
  let weight = 0;
  let total = 0;
  for (const stock of stocks) {
    const value = stock.performance?.[key];
    const marketCap = stock.quote?.marketCap;
    if (!Number.isFinite(value) || !Number.isFinite(marketCap) || marketCap <= 0) continue;
    weight += marketCap;
    total += value * marketCap;
  }
  return weight > 0 ? total / weight : null;
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

function revisionCounts(stocks = []) {
  let up = 0;
  let down = 0;
  for (const stock of stocks) {
    const value = consensusRevision(stock, "2026", "operatingIncome");
    if (!Number.isFinite(value) || value === 0) continue;
    if (value > 0) up += 1;
    else down += 1;
  }
  return { up, down };
}

function coverageBreadth(stocks = []) {
  const periods = {};
  for (const period of ["d1", "d5", "d20", "ytd"]) {
    const summary = { up: 0, down: 0, flat: 0, unavailable: 0 };
    for (const stock of stocks) {
      const value = stock.performance?.[period];
      if (!Number.isFinite(value)) summary.unavailable += 1;
      else if (value > 0) summary.up += 1;
      else if (value < 0) summary.down += 1;
      else summary.flat += 1;
    }
    summary.available = summary.up + summary.down + summary.flat;
    summary.directional = summary.up + summary.down;
    summary.upRate = summary.directional ? (summary.up / summary.directional) * 100 : null;
    periods[period] = summary;
  }
  return { total: stocks.length, periods };
}

function benchmarkOf(market) {
  return state.snapshot?.sectorIndices?.benchmarks?.[market] || null;
}

function indexDates() {
  return state.snapshot?.sectorIndices?.dates || [];
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
  if (!range || range <= 0 || range >= values.length) return values;
  return values.slice(-range);
}

// ---------------------------------------------------------------------------
// 차트
// ---------------------------------------------------------------------------
// 좁은 화면에서 가로로 긴 viewBox를 그대로 쓰면 축 글자가 4px 아래로 줄어 읽히지 않는다.
function chartBox(wide, narrow) {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? narrow : wide;
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
  const indices = state.snapshot?.marketBreadth?.indices || {};
  $("#marketMini").innerHTML = ["KOSPI", "KOSDAQ"].map((market) => {
    const index = indices[market];
    return `<div><dt>${market}</dt><dd id="mini${market}">${Number.isFinite(index?.level) ? formatNumber(index.level, 2) : "-"}</dd>`
      + `<small id="mini${market}Return" class="${numberClass(index?.d1)}">${formatPercent(index?.d1, 2)}</small></div>`;
  }).join("");

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
  const scope = state.sector === "all" ? "커버리지" : state.sector;
  const kospi = state.snapshot?.marketBreadth?.indices?.KOSPI;
  const kosdaq = state.snapshot?.marketBreadth?.indices?.KOSDAQ;
  const kospiYtd = benchmarkOf("KOSPI")?.ytd ?? null;
  const kosdaqYtd = benchmarkOf("KOSDAQ")?.ytd ?? null;
  const weightedD1 = weightedPerformance(stocks, "d1");
  const weightedYtd = weightedPerformance(stocks, "ytd");
  const relative = Number.isFinite(weightedYtd) && Number.isFinite(kospiYtd) ? weightedYtd - kospiYtd : null;
  const direction = directionCounts(stocks, "d1");
  const revisions = revisionCounts(stocks);
  const ranked = [...stocks].filter((stock) => Number.isFinite(stock.performance?.d1)).sort((left, right) => right.performance.d1 - left.performance.d1);
  const best = ranked[0];
  const worst = ranked.at(-1);
  return `<dl class="kpis" id="kpis">
    <div class="kpi"><dt>KOSPI</dt><dd class="num" id="kpiKospiIndex">${Number.isFinite(kospi?.level) ? formatNumber(kospi.level, 2) : "-"}</dd>
      <small><span id="kpiKospiIndexReturn" class="${numberClass(kospi?.d1)}">${formatPercent(kospi?.d1, 2)}</span> · YTD ${formatPercent(kospiYtd, 1)}</small></div>
    <div class="kpi"><dt>KOSDAQ</dt><dd class="num" id="kpiKosdaqIndex">${Number.isFinite(kosdaq?.level) ? formatNumber(kosdaq.level, 2) : "-"}</dd>
      <small><span id="kpiKosdaqIndexReturn" class="${numberClass(kosdaq?.d1)}">${formatPercent(kosdaq?.d1, 2)}</span> · YTD ${formatPercent(kosdaqYtd, 1)}</small></div>
    <div class="kpi"><dt>${escapeHtml(scope)} 1D (시총가중)</dt><dd class="num ${numberClass(weightedD1)}" id="kpiCoverageReturn">${formatPercent(weightedD1, 2)}</dd>
      <small>상승 ${direction.up} · 하락 ${direction.down} / ${stocks.length}종목</small></div>
    <div class="kpi"><dt>YTD vs KOSPI</dt><dd class="num ${numberClass(relative)}" id="kpiRelative">${formatPercent(relative, 1)}</dd>
      <small>절대 ${formatPercent(weightedYtd, 1)}</small></div>
    <div class="kpi"><dt>OP 26E 컨센 1M</dt><dd class="num compact" id="kpiRevision"><span class="positive">${revisions.up}</span> 상향 · <span class="negative">${revisions.down}</span> 하향</dd>
      <small>1M 평균 ÷ 3M 평균 − 1</small></div>
    <div class="kpi"><dt>1D 최대 상승 / 하락</dt>
      <dd class="num compact">${best ? `<span class="positive">${escapeHtml(best.name)} ${formatPercent(best.performance.d1, 1)}</span>` : "-"}</dd>
      <small>${worst && worst !== best ? `<span class="negative">${escapeHtml(worst.name)} ${formatPercent(worst.performance.d1, 1)}</span>` : "-"}</small></div>
  </dl>`;
}

function breadthRowHtml(market, label, totalLabel) {
  const marketId = { KOSPI: "Kospi", KOSDAQ: "Kosdaq", COVERAGE: "Coverage" }[market];
  const periods = [["d1", "1D", "D1"], ["d5", "5D", "D5"], ["d20", "20D", "D20"], ["ytd", "YTD", "Ytd"]];
  return `<div class="kpi-market-row" data-kpi-row="${market}" role="group" aria-label="${escapeHtml(label)} 시장 폭">
    <div class="kpi-market-row__label"><strong>${escapeHtml(label)}</strong><span>${totalLabel} <b data-kpi-total="${market}">-</b>개</span></div>
    ${periods.map(([period, periodLabel, periodId]) => `<article class="kpi-period" data-kpi-market="${market}" data-kpi-period="${period}" aria-label="${escapeHtml(label)} ${periodLabel}">
      <div class="kpi-period__label"><span>${periodLabel}</span></div>
      <div class="kpi-direction">
        <span class="kpi-up"><em>상승</em><strong id="kpi${marketId}${periodId}Up">-</strong></span>
        <span class="kpi-down"><em>하락</em><strong id="kpi${marketId}${periodId}Down">-</strong></span>
        <span class="kpi-rate"><em>비중</em><strong id="kpi${marketId}${periodId}Rate">-</strong></span>
      </div></article>`).join("")}
  </div>`;
}

function breadthHtml() {
  return `<section id="kpiStrip" class="kpi-strip${state.kpiCollapsed ? " is-collapsed" : ""}" aria-label="상장기업 시장 폭">
    <button id="kpiSummaryToggle" class="kpi-summary-toggle" type="button" aria-expanded="${!state.kpiCollapsed}" aria-controls="kpiDetails">
      <span class="kpi-summary-title">시장 폭 상세</span>
      <span class="kpi-summary-metric"><span>KOSPI</span><strong id="kpiKospiBreadth">-</strong></span>
      <span class="kpi-summary-metric"><span>KOSDAQ</span><strong id="kpiKosdaqBreadth">-</strong></span>
      <span class="kpi-summary-metric"><span>내 커버리지 1D 평균</span><em id="kpiCoverageAverage">-</em></span>
      <span class="kpi-summary-chevron" aria-hidden="true">▾</span>
    </button>
    <div id="kpiDetails" class="kpi-details"${state.kpiCollapsed ? " hidden" : ""}>
      ${breadthRowHtml("KOSPI", "KOSPI", "기업")}
      ${breadthRowHtml("KOSDAQ", "KOSDAQ", "기업")}
      ${breadthRowHtml("COVERAGE", "내 커버리지", "종목")}
    </div>
  </section>`;
}

function renderBreadthValues() {
  const breadth = state.snapshot?.marketBreadth;
  const summaries = {
    KOSPI: breadth?.summary?.KOSPI,
    KOSDAQ: breadth?.summary?.KOSDAQ,
    COVERAGE: coverageBreadth(state.snapshot?.stocks || []),
  };
  const marketIds = { KOSPI: "Kospi", KOSDAQ: "Kosdaq", COVERAGE: "Coverage" };
  const periodIds = { d1: "D1", d5: "D5", d20: "D20", ytd: "Ytd" };
  for (const [market, marketId] of Object.entries(marketIds)) {
    const marketSummary = summaries[market];
    $$(`[data-kpi-total="${market}"]`).forEach((element) => {
      element.textContent = Number.isFinite(marketSummary?.total) ? formatNumber(marketSummary.total) : "-";
    });
    for (const [period, periodId] of Object.entries(periodIds)) {
      const summary = marketSummary?.periods?.[period];
      const up = $(`#kpi${marketId}${periodId}Up`);
      const down = $(`#kpi${marketId}${periodId}Down`);
      const rate = $(`#kpi${marketId}${periodId}Rate`);
      if (up) up.textContent = Number.isFinite(summary?.up) ? formatNumber(summary.up) : "-";
      if (down) down.textContent = Number.isFinite(summary?.down) ? formatNumber(summary.down) : "-";
      if (rate) rate.textContent = Number.isFinite(summary?.upRate) ? `${summary.upRate.toFixed(1)}%` : "-";
    }
  }
  const kospiSummary = summaries.KOSPI?.periods?.d1;
  const kosdaqSummary = summaries.KOSDAQ?.periods?.d1;
  const kospiBreadth = $("#kpiKospiBreadth");
  const kosdaqBreadth = $("#kpiKosdaqBreadth");
  const average = $("#kpiCoverageAverage");
  if (kospiBreadth) kospiBreadth.textContent = kospiSummary ? `${formatNumber(kospiSummary.up)} / ${formatNumber(kospiSummary.down)}` : "-";
  if (kosdaqBreadth) kosdaqBreadth.textContent = kosdaqSummary ? `${formatNumber(kosdaqSummary.up)} / ${formatNumber(kosdaqSummary.down)}` : "-";
  if (average) {
    const values = (state.snapshot?.stocks || []).map((stock) => stock.performance?.d1).filter(Number.isFinite);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    average.textContent = formatPercent(mean, 2);
    average.className = numberClass(mean);
  }
}

// ---------------------------------------------------------------------------
// 홈 · 섹터 화면 블록
// ---------------------------------------------------------------------------
function rangeButtons() {
  return RANGES.map(([value, label]) => `<button class="btn tiny" type="button" data-range="${value}" aria-pressed="${state.range === value}">${label}</button>`).join("");
}

function benchButtons() {
  return BENCHMARK_MODES.map(([value, label]) => `<button class="btn tiny" type="button" data-bench="${value}" aria-pressed="${state.bench === value}">${label}</button>`).join("");
}

function benchmarkSeriesFor(dates) {
  const series = [];
  if (state.bench !== "KOSDAQ") {
    const kospi = benchmarkOf("KOSPI");
    if (kospi) series.push({ name: "KOSPI", values: windowSlice(kospi.values), cls: "s-ctx" });
  }
  if (state.bench !== "KOSPI") {
    const kosdaq = benchmarkOf("KOSDAQ");
    if (kosdaq) series.push({ name: "KOSDAQ", values: windowSlice(kosdaq.values), cls: "s-ctx2" });
  }
  return series.filter((item) => item.values.length === dates.length || item.values.length > 1);
}

function homeGroupChart() {
  const dates = windowSlice(indexDates());
  if (dates.length < 2) return `<div class="card"><div class="card-head"><h3>4그룹 상대주가</h3></div><p class="empty-state">섹터 지수를 만들 일봉이 아직 없습니다.</p></div>`;
  const series = HOME_GROUPS.map((group, index) => {
    const entry = groupSeries(group.label);
    return entry && entry.values.length
      ? { name: group.label, short: group.short, values: windowSlice(entry.values), cls: `s-${index + 1}`, members: entry.members }
      : null;
  }).filter(Boolean);
  const box = chartBox({ width: 900, height: 260 }, { width: 430, height: 300 });
  const chart = lineChart({ series: [...series, ...benchmarkSeriesFor(dates)], labels: dates, ...box });
  return `<div class="card" id="homeGroupChart">
    <div class="card-head"><h3>4그룹 상대주가 vs 벤치마크</h3>
      <span class="tools">${benchButtons()}<span class="gap"></span>${rangeButtons()}</span></div>
    ${chart}
    <div class="chart-legend">${HOME_GROUPS.map((group, index) => `<span><i class="s${index + 1}"></i>${escapeHtml(group.label)}</span>`).join("")}
      <span><i class="ctx"></i>KOSPI</span><span><i class="ctx2"></i>KOSDAQ</span>
      <span class="unit">기간 시작 = 100 · 시총가중 · 일별 종가</span></div>
  </div>`;
}

function sectorTiles() {
  const kospiYtd = benchmarkOf("KOSPI")?.ytd ?? null;
  return `<div class="tiles" role="list">${SECTOR_ORDER.map((sector) => {
    const members = stocksInSector(sector);
    const d1 = weightedPerformance(members, "d1");
    const ytd = weightedPerformance(members, "ytd");
    const relative = Number.isFinite(ytd) && Number.isFinite(kospiYtd) ? ytd - kospiYtd : null;
    const entry = sectorSeries(sector);
    return `<a class="tile" role="listitem" href="#/sector/${encodeURIComponent(sector)}" aria-current="${state.sector === sector}" data-sector-tile="${escapeHtml(sector)}">
      <span class="t">${escapeHtml(sector)}<small>${members.length}</small></span>
      <span class="v"><b class="${numberClass(d1)}">${formatPercent(d1, 1)}</b></span>
      <span class="r">YTD−K <b class="${numberClass(relative)}">${formatPercent(relative, 1)}</b></span>
      ${sparkline((entry?.values || []).slice(-60))}</a>`;
  }).join("")}</div>`;
}

function sectorExceptions(stocks) {
  const byReturn = [...stocks].filter((stock) => Number.isFinite(stock.performance?.d1)).sort((left, right) => right.performance.d1 - left.performance.d1);
  const byRevision = [...stocks]
    .map((stock) => ({ stock, value: consensusRevision(stock, "2026", "operatingIncome") }))
    .filter(({ value }) => Number.isFinite(value) && value !== 0)
    .sort((left, right) => right.value - left.value);
  const item = (stock, value) => `<li><span><a href="#/stock/${stock.code}">${escapeHtml(stock.name)}</a>`
    + `<small>${formatNumber(stock.quote?.marketCap)}억</small></span>`
    + `<span class="num ${numberClass(value)}">${formatPercent(value, 1)}</span></li>`;
  const block = (label, rows) => `<li class="eyebrow">${label}</li>`
    + (rows.length ? rows.join("") : '<li><span class="na">해당 없음</span><span class="num na">-</span></li>');
  return `<ul class="exc">
    ${block("1D 상승 상위", byReturn.slice(0, 2).map((stock) => item(stock, stock.performance.d1)))}
    ${block("1D 하락 상위", byReturn.slice(-2).reverse().map((stock) => item(stock, stock.performance.d1)))}
    ${block("OP 26E 컨센 1M 상향", byRevision.slice(0, 2).map(({ stock, value }) => item(stock, value)))}
    ${block("OP 26E 컨센 1M 하향", byRevision.slice(-2).reverse().map(({ stock, value }) => item(stock, value)))}
  </ul>`;
}

function sectorTrend(sector, stocks) {
  const dates = windowSlice(indexDates());
  const entry = sectorSeries(sector);
  const series = entry && entry.values.length ? [{ name: sector, values: windowSlice(entry.values), cls: "s-main" }] : [];
  const box = chartBox({ width: 820, height: 250 }, { width: 430, height: 300 });
  const chart = dates.length >= 2 && series.length
    ? lineChart({ series: [...series, ...benchmarkSeriesFor(dates)], labels: dates, ...box })
    : '<p class="empty-state">섹터 지수를 만들 일봉이 아직 없습니다.</p>';
  const excluded = entry?.excluded?.length ? ` · 제외 ${entry.excluded.length}종목` : "";
  return `<div class="sec-grid">
    <div class="card" id="sectorTrendCard">
      <div class="card-head"><h3>${escapeHtml(sector)} 섹터 지수 vs 벤치마크</h3>
        <span class="tools">${benchButtons()}<span class="gap"></span>${rangeButtons()}</span></div>
      ${chart}
      <div class="chart-legend"><span><i></i>${escapeHtml(sector)} 섹터(시총가중 ${entry?.members ?? 0}종목${excluded})</span>
        <span><i class="ctx"></i>KOSPI</span><span><i class="ctx2"></i>KOSDAQ</span>
        <span class="unit">기간 시작 = 100 · 일별 종가</span></div>
    </div>
    <div class="card"><div class="card-head"><h3>섹터 내 예외</h3><span class="unit">${stocks.length}종목</span></div>${sectorExceptions(stocks)}</div>
  </div>`;
}

function indicatorTiles(sector) {
  const items = INDICATOR_CATALOG[sector] || [];
  if (!items.length) return "";
  return `<div class="ind-head"><h3>${escapeHtml(sector)} 트래킹 지표</h3>
      <span>원천 확정 전 · 값 연동 대기 (2026-08-23 실접속 검증한 후보)</span></div>
    <ul class="ind" id="indicatorTiles">${items.map((item) => `<li>
      <b>${escapeHtml(item.name)}</b><i>${escapeHtml(item.source)} · ${escapeHtml(item.cycle)}</i>
      <span class="state ${item.state === "paid" ? "paid" : ""}">${item.state === "paid" ? "유료·수기 검토" : "자동 수집 후보"}</span>
    </li>`).join("")}</ul>`;
}

// ---------------------------------------------------------------------------
// 종목 표
// ---------------------------------------------------------------------------
function sortButton(label, key) {
  const active = state.sortKey === key;
  const arrow = active && state.sortDirection === "asc" ? "↑" : "↓";
  return `<button type="button" data-sort="${key}" data-active="${active}" data-arrow=" ${arrow}" aria-label="${escapeHtml(label)} 기준 정렬">${escapeHtml(label)}</button>`;
}

function financialCell(record, metric, extraClass = "") {
  const value = record?.[metric] ?? null;
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
    case "revision": return revisionCell(stock, column.period, column.metric, extraClass);
    case "ratio": return `<td data-live-field="valuation.${column.period}.${column.ratio}" class="${extraClass}">${formatRatio(stock.valuation?.[column.period]?.[column.ratio], column.ratio)}</td>`;
    case "count": return `<td class="${extraClass}">${formatNumber(stock.annual?.[column.period]?.contributors)}</td>`;
    case "computed": return computedCell(stock, column, extraClass);
    default: return `<td class="na ${extraClass}">-</td>`;
  }
}

function sortValue(stock, key) {
  if (key.startsWith("computed.")) return COMPUTED[key.slice("computed.".length)]?.(stock) ?? null;
  if (key.startsWith("revision.annual.")) {
    const [, , period, metric] = key.split(".");
    return consensusRevision(stock, period, metric);
  }
  return getPath(stock, key);
}

function compareStocks(left, right) {
  if (state.sortKey === "default") {
    // Pick 우선 정렬은 폐지됐다. 섹터 안에서는 시가총액 내림차순.
    return ((right.quote?.marketCap ?? -Infinity) - (left.quote?.marketCap ?? -Infinity))
      || left.code.localeCompare(right.code);
  }
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

function sortedBySector(stocks) {
  if (state.sortKey === "sector") return [...stocks].sort(compareStocks);
  return SECTOR_ORDER.flatMap((sector) => stocks.filter((stock) => stock.sector === sector).sort(compareStocks));
}

function tableHtml() {
  const hidden = hiddenColumnsForSector();
  const sections = visibleSections(hidden);
  const groupRow = sections.map((section) => {
    if (section.key === "identity") {
      return section.columns.map((column) => `<th class="${column.className}" rowspan="2" scope="col">${sortButton(column.label, column.sort)}</th>`).join("");
    }
    return `<th class="group-head group-${section.key} section-start" colspan="${section.columns.length}" scope="colgroup">${escapeHtml(section.label)}</th>`;
  }).join("");
  const leafRow = sections
    .filter(({ key }) => key !== "identity")
    .flatMap((section) => section.columns.map((column, index) =>
      `<th class="${column.className} ${index === 0 ? "section-start" : ""}" scope="col">${column.sort ? sortButton(column.label, column.sort) : escapeHtml(column.label)}</th>`))
    .join("");

  const visible = sortedBySector(filteredStocks());
  let previousSector = null;
  const body = visible.map((stock) => {
    const sectorStart = stock.sector !== previousSector;
    previousSector = stock.sector;
    const cells = sections.flatMap((section) =>
      section.columns.map((column, index) => bodyCell(stock, column, section.key !== "identity" && index === 0 ? "section-start" : ""))).join("");
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

  return `<div class="toolbar">
      <span class="label">열그룹</span>
      ${OPTIONAL_COLUMN_GROUPS.map((group) => `<button type="button" class="column-chip" data-column-group="${group.key}" aria-pressed="${state.columnGroups.has(group.key)}" title="${escapeHtml(group.hint)}">${escapeHtml(group.label)}</button>`).join("")}
      <span class="spacer"></span>
      <span class="visible-count" id="visibleCount">${visible.length} / ${state.snapshot?.stocks?.length || 0}종목</span>
      <span class="return-heat-legend" aria-label="수익률 셀 색상: 0은 무채색, 상승은 빨강, 하락은 파랑, 진할수록 변동폭이 큼">하락<i class="return-heat-legend__bar" aria-hidden="true"></i>상승</span>
    </div>
    <div id="tableScroller" class="table-region" role="region" tabindex="0" aria-label="종목 비교표 (가로·세로 스크롤)">
      <table id="universeTable" class="universe-table">
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
    ? `<div class="home-grid">${homeGroupChart()}</div>${sectorTiles()}`
    : `${sectorTrend(state.sector, stocks)}${indicatorTiles(state.sector)}`;
  const fixtureNote = state.snapshot?.mode === "fixture"
    ? "고정 fixture 검증 모드입니다. 실제 투자 판단에 사용할 수 없습니다."
    : "행을 클릭하면 오른쪽에 종목 상세가 열립니다.";
  const quoteSource = String(state.snapshot?.sources?.quote?.source || "").toLowerCase();
  const cadence = RUNTIME.staticMode
    ? "지연 스냅샷 · 실시간 아님"
    : quoteSource === "toss"
      ? "현재가·시총 토스 통합시세(KRX+NXT)"
      : "현재가·1D·시총·P/E·P/B 실시간";
  return `<div class="topbar"><h2 id="viewTitle">${escapeHtml(title)}</h2>
      <div class="meta"><span>${cadence}</span><span>컨센·실적 08:00 · 12:00 · 18:00</span>
        <span>단위: 원 · 억원 · % · 배</span></div></div>
    ${kpiStripHtml()}
    ${middle}
    ${breadthHtml()}
    ${tableHtml()}
    <p class="foot-note" id="footNote">자료: Kiwoom(시세) · ConsenDB 3M(컨센서스) · OpenDART(확정 실적). 결측은 보간 없이 빈칸입니다. ${escapeHtml(fixtureNote)}</p>`;
}

function renderView({ preserveScroll = false } = {}) {
  if (!state.snapshot) return;
  const scroller = $("#tableScroller");
  if (preserveScroll && scroller) {
    state.tableScrollLeft = scroller.scrollLeft;
    state.tableScrollTop = scroller.scrollTop;
  }
  $("#view").innerHTML = viewHtml();
  renderBreadthValues();
  const next = $("#tableScroller");
  if (preserveScroll && next) {
    next.scrollLeft = state.tableScrollLeft;
    next.scrollTop = state.tableScrollTop;
  }
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
function quarterSeriesOf(stock) {
  const actuals = [...(stock.actuals?.quarter || [])]
    .filter((row) => row?.period)
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-8);
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
    value: row.operatingIncome ?? null,
    revenue: row.revenue ?? null,
    parentNetIncome: row.parentNetIncome ?? null,
    estimate: row.kind === "estimate",
    consensus: consensus[row.period]?.threeMonth?.operatingIncome ?? null,
  }));
}

function drawerConsensusTable(stock) {
  const rows = [
    ["매출액", "revenue"],
    ["영업이익", "operatingIncome"],
    ["지배순이익", "parentNetIncome"],
  ];
  const horizonRow = (metric) => ANNUALS.map(([period]) => {
    const compare = stock.consensusComparison?.annual?.[period];
    if (!compare) return '<td class="est">-</td>';
    return `<td class="est">${formatFinancial(compare.oneMonth?.[metric])} / ${formatFinancial(compare.highest?.[metric])}</td>`;
  }).join("");
  return `<div class="fin-wrap"><table class="fin" id="drawerConsensus">
    <thead><tr><th class="l"></th>${ANNUALS.map(([period, label]) => `<th class="${period === "2025" ? "" : "est"}">${label}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map(([label, metric]) => `<tr><td class="l">${label}</td>${ANNUALS.map(([period]) => {
        const row = stock.annual?.[period];
        const focus = metric === "operatingIncome" && period === "2026" ? " focus" : "";
        return `<td class="${row?.kind === "estimate" ? "est" : ""}${focus}">${formatFinancial(row?.[metric])}</td>`;
      }).join("")}</tr>`).join("")}
      <tr><td class="l">· 영업이익 1M / 최고</td>${horizonRow("operatingIncome")}</tr>
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
  const quarters = quarterSeriesOf(stock);
  const recent = quarters.slice(-8);
  const kospiYtd = benchmarkOf("KOSPI")?.ytd ?? null;
  const ytd = stock.performance?.ytd;
  const relative = Number.isFinite(ytd) && Number.isFinite(kospiYtd) ? ytd - kospiYtd : null;
  const opRevision = consensusRevision(stock, "2026", "operatingIncome");
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
      <div><dt>OP 26E 1M변화</dt><dd class="${numberClass(opRevision)}">${formatPercent(opRevision)}</dd><small>1M ÷ 3M − 1</small></div>
      <div><dt>YTD</dt><dd class="${numberClass(ytd)}" data-performance="ytd">${formatPercent(ytd)}</dd><small>vs KOSPI ${formatPercent(relative, 1)}</small></div>
      <div><dt>52주高比</dt><dd class="${numberClass(stock.performance?.drawdown52w)}" data-performance="drawdown52w">${formatPercent(stock.performance?.drawdown52w)}</dd><small>1Y ${formatPercent(stock.performance?.y1, 1)}</small></div>
      <div><dt>목표가 괴리</dt><dd class="${numberClass(COMPUTED.targetGap(stock))}">${formatPercent(COMPUTED.targetGap(stock))}</dd>
        <small>TP ${formatPrice(stock.annual?.["2026"]?.targetPrice)} · 배당 ${formatLevelPercent(COMPUTED.dividendYield(stock))}</small></div>
    </dl>
    <section class="panel"><div class="panel-head"><h3>주가 vs 섹터 · 벤치마크</h3>
        <span class="tools">${rangeButtons()}</span></div>
      ${chart}
      <div class="chart-legend"><span><i></i>${escapeHtml(stock.name)}</span><span><i class="sector"></i>${escapeHtml(stock.sector)} 섹터</span>
        <span><i class="ctx"></i>KOSPI</span><span><i class="ctx2"></i>KOSDAQ</span><span class="unit">기간 시작 = 100</span></div></section>
    <section class="panel"><div class="panel-head"><h3>컨센서스 · 연간</h3><span class="unit">억원 · 3M 평균</span></div>
      ${drawerConsensusTable(stock)}</section>
    <section class="panel"><div class="panel-head"><h3>분기 영업이익 — 실적 ${quarters.filter((row) => !row.estimate).length} + 추정 ${quarters.filter((row) => row.estimate).length}</h3><span class="unit">억원</span></div>
      ${quarterBarChart(quarters)}
      <div class="chart-legend"><span><i class="solid"></i>확정 실적</span><span><i class="box-e"></i>3M 추정</span><span><i class="acc"></i>발표 전 컨센</span></div>
      <div class="fin-wrap"><table class="fin" id="drawerQuarters">
        <thead><tr><th class="l"></th>${recent.map((row) => `<th class="${row.estimate ? "est" : ""}">${escapeHtml(row.label)}</th>`).join("")}</tr></thead>
        <tbody>
          <tr><td class="l">영업이익</td>${recent.map((row) => `<td class="${row.estimate ? "est" : ""}">${formatFinancial(row.value)}</td>`).join("")}</tr>
          <tr><td class="l">컨센 3M</td>${recent.map((row) => `<td>${formatFinancial(row.consensus)}</td>`).join("")}</tr>
          <tr><td class="l">서프라이즈</td>${recent.map((row) => {
            const surprise = !row.estimate && Number.isFinite(row.value) && Number.isFinite(row.consensus) && row.consensus > 0
              ? ((row.value / row.consensus) - 1) * 100 : null;
            return `<td class="${numberClass(surprise)}">${formatPercent(surprise)}</td>`;
          }).join("")}</tr>
          <tr><td class="l">지배순이익</td>${recent.map((row) => `<td class="${row.estimate ? "est" : ""}">${formatFinancial(row.parentNetIncome)}</td>`).join("")}</tr>
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

function updateLiveRow(stock) {
  const row = $(`#tableBody tr[data-code="${stock.code}"]`);
  if (!row) return;
  const price = row.querySelector('[data-live-field="quote.price"]');
  const marketCap = row.querySelector('[data-live-field="quote.marketCap"]');
  if (price) price.textContent = formatPrice(stock.quote?.price);
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
  renderBreadthValues();
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

function toggleKpiDetails() {
  state.kpiCollapsed = !state.kpiCollapsed;
  writeStorage(KPI_COLLAPSE_STORAGE_KEY, String(state.kpiCollapsed));
  const strip = $("#kpiStrip");
  const details = $("#kpiDetails");
  const button = $("#kpiSummaryToggle");
  if (!strip || !details || !button) return;
  strip.classList.toggle("is-collapsed", state.kpiCollapsed);
  details.hidden = state.kpiCollapsed;
  button.setAttribute("aria-expanded", String(!state.kpiCollapsed));
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
    const range = event.target.closest("[data-range]");
    if (range) { state.range = Number(range.dataset.range); return renderView({ preserveScroll: true }); }
    const bench = event.target.closest("[data-bench]");
    if (bench) { state.bench = bench.dataset.bench; return renderView({ preserveScroll: true }); }
    if (event.target.closest("#kpiSummaryToggle")) return toggleKpiDetails();
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
      state.range = Number(range.dataset.range);
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
      const next = await fetch(RUNTIME.snapshotUrl, { cache: "no-store" });
      if (!next.ok) return;
      state.liveUpdates.clear();
      state.snapshot = await next.json();
      renderSidebar();
      renderView({ preserveScroll: true });
      if (RUNTIME.staticMode) connectQuoteSocket();
      if (state.detailCode) loadDetail(state.detailCode);
    } catch { /* WebSocket 재연결 표시가 주 신호다. */ }
  }, 60_000);
}

initialize().catch((error) => {
  setConnection("offline", "로드 실패");
  $("#view").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
