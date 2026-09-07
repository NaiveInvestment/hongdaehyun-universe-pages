// Shared, side-effect-free display contracts for the live and public surfaces.
const MINUTE = 60_000;

export function kstSession(now = Date.now()) {
  const date = new Date(Number(now) + 9 * 60 * MINUTE);
  const weekday = date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return {
    date: date.toISOString().slice(0, 10),
    // This is the existing weekday publication window, not a holiday calendar.
    publishing: weekday && minutes >= 8 * 60 && minutes <= 20 * 60 + 15,
    regular: weekday && minutes >= 9 * 60 && minutes <= 15 * 60 + 30,
  };
}

function age(timestamp, now) {
  const parsed = Date.parse(timestamp || "");
  return Number.isFinite(parsed) ? Math.max(0, Number(now) - parsed) : Infinity;
}

export function quoteVenue(quote = {}) {
  // A fallback merge may retain the prior stream's venue. Naver's adapter is KRX-only.
  if (String(quote.source).toLowerCase() === "naver") return "KRX";
  const raw = String(quote.venue || quote.exchange || "").toUpperCase();
  if (["KRX", "NXT", "KRX/NXT"].includes(raw)) return raw;
  if (String(quote.source).toLowerCase() === "toss") return "KRX+NXT";
  return "거래소 미확인";
}

export function combinedQuoteVenue(stocks = []) {
  const venues = [...new Set(stocks.map(stock => quoteVenue(stock.quote)).filter(value => value !== "거래소 미확인"))];
  return venues.length > 1 ? "KRX/NXT" : venues[0] || "거래소 미확인";
}

export function quoteSourceName(sourceName, quote = {}, staticMode = false) {
  const source = String(sourceName || "").trim();
  const venue = quoteVenue({ source, ...quote });
  let name;
  if (source.toLowerCase() === "fixture") name = "Fixture 시세";
  else if (source.toLowerCase() === "kiwoom") name = `Kiwoom ${venue}`;
  else if (source.toLowerCase() === "naver") name = `Naver ${venue} 지연`;
  else if (source.toLowerCase() === "toss") name = "토스 통합시세(KRX+NXT)";
  else if (source.toLowerCase() === "mixed") name = `혼합 시세 ${venue} (${(quote.providers || []).join("/") || "복수 원천"})`;
  else name = source || "미적재";
  return staticMode ? `${name}, 공개본 5분 주기` : name;
}

export function quoteFreshness({ source = {}, builtAt, now = Date.now(), staticMode = false, pollError = null } = {}) {
  const session = kstSession(now);
  const quoteAgeMs = age(source.updatedAt, now);
  const publicationAgeMs = age(builtAt, now);
  const threshold = staticMode ? 15 * MINUTE : 2 * MINUTE;
  const publicationStopped = staticMode && session.publishing && publicationAgeMs > 15 * MINUTE;
  const stale = session.publishing && quoteAgeMs > threshold;
  const closed = !session.publishing;
  const label = pollError ? "조회 실패"
    : publicationStopped ? "게시 갱신 중단"
      : stale ? "시세 갱신 지연"
        : closed ? "장마감"
          : staticMode ? "5분 주기"
            : source.delayed ? "지연"
              : String(source.source).toLowerCase() === "toss" ? "통합시세"
              : session.regular ? "LIVE" : "시간외";
  return { label, className: pollError || publicationStopped ? "error" : closed ? "closed" : stale || source.delayed || staticMode ? "stale" : "ok", stale, closed, publicationStopped, quoteAgeMs, publicationAgeMs };
}

export function resolveDisplayPeriods(snapshot = {}, now = Date.now()) {
  const stocks = snapshot.stocks || [];
  const annualRows = stocks.flatMap(stock => Object.entries(stock.annual || {}));
  const estimates = [...new Set(annualRows.filter(([, row]) => row?.kind === "estimate").map(([period]) => period))].filter(period => /^\d{4}$/.test(period)).sort();
  const actuals = [...new Set(annualRows.filter(([, row]) => row?.kind === "actual").map(([period]) => period))].filter(period => /^\d{4}$/.test(period)).sort();
  const baseDates = annualRows.filter(([, row]) => row?.kind === "estimate").map(([, row]) => row.baseDate).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || "")).sort();
  // The workbook's business date anchors the display; opening an old snapshot
  // in a new year must not relabel its estimates as current-year observations.
  const year = Number(baseDates.at(-1)?.slice(0, 4) || estimates[0] || actuals.at(-1)
    || kstSession(Date.parse(snapshot.generatedAt || "") || Number(now)).date.slice(0, 4));
  const tableAnnuals = [year, year + 1].map(value => [String(value), `${String(value).slice(2)}${estimates.includes(String(value)) || !actuals.includes(String(value)) ? "E" : ""}`]);
  const tableQuarters = [1, 2, 3, 4].map(quarter => [`${year}Q${quarter}`, `${quarter}Q${String(year).slice(2)}`]);
  const drawerAnnuals = [
    // The compact snapshot omits the older actual year; it is present in the detail payload.
    ...[year - 2, year - 1].map(value => [String(value), String(value)]),
    ...estimates.filter(period => Number(period) >= year).slice(0, 3).map(period => [period, `${period}E`]),
  ];
  return { year: String(year), tableAnnuals, tableQuarters, drawerAnnuals };
}

// One common calendar cutoff and endpoint. No invented daily prices or FX returns.
// A market holiday uses the last observed close at/before the cutoff (at most 7 days).
// Later listings are excluded, and gaps between actual observations remain gaps in data.
export function relativePeerSeries(companies = [], range = "ytd") {
  const clean = companies.map(company => ({ ...company, history: (company.history || [])
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date)) }));
  const lastDates = clean.map(item => item.history.at(-1)?.date).filter(Boolean).sort();
  if (!lastDates.length) return { dates: [], series: [], excluded: clean.map(item => ({ symbol: item.symbol, name: item.name, reason: "일봉 미수신" })) };
  // All comparisons end at the oldest available latest close. The source dates remain visible.
  const endDate = lastDates[0];
  const end = new Date(`${endDate}T00:00:00Z`);
  let baseDate;
  if (range === "ytd") baseDate = `${end.getUTCFullYear() - 1}-12-31`;
  else {
    const months = ({ "1m": 1, "3m": 3, "6m": 6, "1y": 12 })[range] || 6;
    const first = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(end.getUTCDate(), lastDay));
    baseDate = first.toISOString().slice(0, 10);
  }
  const excluded = [], series = [];
  for (const company of clean) {
    const base = company.history.filter(row => row.date <= baseDate).at(-1);
    const elapsed = base ? Date.parse(baseDate) - Date.parse(base.date) : Infinity;
    const after = company.history.filter(row => row.date > baseDate && row.date <= endDate);
    if (!base || elapsed > 7 * 86400000 || !after.length) {
      excluded.push({ symbol: company.symbol, name: company.name, reason: !company.history.length ? "일봉 미수신" : !base ? "기간 시작 종가 없음" : "기준일 부근 종가 부족" });
      continue;
    }
    const points = [{ date: baseDate, value: 100 }, ...after.map(row => ({ date: row.date, value: row.close / base.close * 100 }))];
    series.push({ symbol: company.symbol, name: company.name, baseDate: base.date, baseClose: base.close, endDate: after.at(-1).date,
      endClose: after.at(-1).close, returnPct: (after.at(-1).close / base.close - 1) * 100, points });
  }
  const dates = [...new Set(series.flatMap(item => item.points.map(point => point.date)))].sort();
  return { baseDate, endDate, dates, series: series.map(item => { const byDate = new Map(item.points.map(point => [point.date, point.value])); return { ...item, values: dates.map(date => byDate.get(date) ?? null) }; }), excluded };
}
// Display conversion only. Preserve source values and fail closed when a fiscal FX rate is absent.
export function rareUsdValue(value, { currency, unit = "millions", kind, fiscalEnd, fx } = {}) {
  const scale = unit === "hundredMillion" ? 100 : unit === "millions" ? 1 : null;
  const rate = currency === "USD" ? { usdPerUnit: 1 } : kind === "actual"
    ? fx?.actuals?.[`${currency}:${fiscalEnd}`] : fx?.spot?.rates?.[currency];
  return { value: Number.isFinite(value) && scale && Number.isFinite(rate?.usdPerUnit) && rate.usdPerUnit > 0
    ? value * scale * rate.usdPerUnit : null, rate: rate || null,
    basis: currency === "USD" ? "USD 원본" : kind === "actual" ? "회계연도 일별 환율 평균" : "조회 기준 고정환율" };
}

export function rareMoneyValue(value, { target = "USD", currency, unit = "millions", kind, fiscalEnd, fx } = {}) {
  if (target === "USD") return rareUsdValue(value, { currency, unit, kind, fiscalEnd, fx });
  const scale = unit === "hundredMillion" ? 1 : unit === "millions" ? 0.01 : null;
  const rate = currency === "KRW" ? { krwPerUnit: 1 } : kind === "actual"
    ? fx?.krw?.actuals?.[`${currency}:${fiscalEnd}`] : fx?.krw?.spot?.rates?.[currency];
  return { value: target === "KRW" && Number.isFinite(value) && scale && Number.isFinite(rate?.krwPerUnit) && rate.krwPerUnit > 0
    ? value * scale * rate.krwPerUnit : null, rate: rate || null,
    basis: currency === "KRW" ? "KRW 원본" : kind === "actual" ? "회계연도 일별 환율 평균" : "조회 기준 고정환율" };
}

// Financial display uses fiscal average FX; valuation ratios use the same spot
// FX for both sides so changing display currency cannot change a multiple.
export function rareComparisonRow(company, stock, fx, { target = "KRW", basis = "threeMonth", years = [2025, 2026, 2027, 2028] } = {}) {
  const fin = company.financials;
  const currency = company.domestic ? "KRW" : fin?.currency;
  const unit = company.domestic ? "hundredMillion" : "millions";
  const nativeCap = company.domestic ? stock?.quote?.marketCap : fin?.marketCap?.value;
  const capCurrency = company.domestic ? "KRW" : fin?.marketCap?.currency;
  const capUsd = rareMoneyValue(nativeCap, { target: "USD", currency: capCurrency, unit, fx }).value;
  const cap = company.private
    ? (target === "USD" ? company.equityValue?.value : company.equityValue?.value * company.equityValue?.krwPerUsd / 100)
    : rareMoneyValue(nativeCap, { target, currency: capCurrency, unit, fx }).value;
  const financials = {};
  const ratios = {};
  const evSource = company.valuation?.enterpriseValue;
  const evUsd = rareMoneyValue(evSource?.value, { target: "USD", currency: evSource?.currency, unit: evSource?.unit, fx }).value;
  const ev = !company.private ? rareMoneyValue(evSource?.value, { target, currency: evSource?.currency, unit: evSource?.unit, fx }).value : null;
  for (const year of years) {
    const raw = company.domestic ? stock?.annual?.[year] : fin?.annual?.[year];
    const selected = company.domestic && raw?.kind === "estimate" && raw.horizons ? raw.horizons[basis] : raw;
    const fiscalEnd = raw?.fiscalEnd || `${year}-${fin?.fiscalYearEnd || "12-31"}`;
    financials[year] = {};
    for (const metric of ["revenue", "operatingIncome", "netIncome", "normalizedNetIncome"]) {
      const key = company.domestic && metric === "netIncome" ? "parentNetIncome" : metric;
      const native = selected?.[key];
      financials[year][metric] = { ...rareMoneyValue(native, { target, currency, unit, kind: raw?.kind, fiscalEnd, fx }),
        native: Number.isFinite(native) ? native : null, currency, unit, kind: raw?.kind || null, fiscalEnd, note: raw?.notes?.[key] || "" };
    }
    ratios[year] = {};
    for (const [ratio, metric] of [["ps", "revenue"], ["pe", "netIncome"]]) {
      const denominator = rareMoneyValue(financials[year][metric].native, { target: "USD", currency, unit, fx }).value;
      const available = !company.private && Number.isFinite(capUsd) && capUsd > 0 && Number.isFinite(denominator);
      ratios[year][ratio] = { value: available && denominator > 0 ? capUsd / denominator : null,
        status: !available ? "missing" : denominator <= 0 ? "nm" : "ok", kind: raw?.kind || null };
    }
    for (const [ratio, metric] of [["evEbitda", "ebitda"], ["evEbit", "ebit"]]) {
      const record = company.valuation?.annual?.[year];
      const denominator = rareMoneyValue(record?.[metric], { target: "USD", currency: company.valuation?.currency, unit: "millions", fx }).value;
      const available = !company.private && Number.isFinite(evUsd) && Number.isFinite(denominator);
      ratios[year][ratio] = { value: available && denominator > 0 ? evUsd / denominator : null,
        status: !available ? "missing" : denominator <= 0 ? "nm" : "ok", kind: record?.kind || null,
        numerator: evSource?.value ?? null, numeratorCurrency: evSource?.currency || null,
        denominator: record?.[metric] ?? null, denominatorCurrency: company.valuation?.currency || null };
    }
  }
  const history = (company.history || []).filter(r => Number.isFinite(r.close) && r.close > 0).slice().sort((a,b) => a.date.localeCompare(b.date));
  const end = history.at(-1);
  const prior = history.at(-2);
  const year = end?.date?.slice(0, 4);
  const ytdBase = history.filter(r => r.date.slice(0,4) < year).at(-1);
  const ytdHigh = end ? Math.max(...history.filter(r => r.date.slice(0,4) === year).map(r => r.close)) : null;
  const change = (v,b) => Number.isFinite(v) && b > 0 ? (v / b - 1) * 100 : null;
  return { symbol: company.symbol, company, cap: Number.isFinite(cap) ? cap : null, ev, financials, ratios,
    price: company.private ? null : company.domestic ? stock?.quote?.price : end?.close,
    priceDate: company.domestic ? stock?.quote?.observedAt : end?.date,
    d1: company.private ? null : company.domestic ? stock?.performance?.d1 : change(end?.close, prior?.close),
    ytd: company.private ? null : company.domestic ? stock?.performance?.ytd : change(end?.close, ytdBase?.close),
    mdd: company.private ? null : company.domestic ? stock?.performance?.ytdDrawdown : change(end?.close, ytdHigh) };
}
