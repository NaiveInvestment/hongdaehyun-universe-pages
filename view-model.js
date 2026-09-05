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
