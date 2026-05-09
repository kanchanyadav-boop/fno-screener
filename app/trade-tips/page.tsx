"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { FNO_STOCKS } from "../lib/fnoStocks";
import { generateTradeTip, TradeTip, TipSignal } from "../lib/tradeTip";
import { Candle } from "../lib/pattern";
import { SwingPoint } from "../lib/dowTheory";
import { ChartModal } from "../components/ChartModal";

interface StockResult {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  tip: TradeTip;
}

type FilterKey = "ALL" | "BUY" | "NEAR" | "WATCH";
type SortKey   = "signal" | "rr" | "dist" | "chg";
type FlashDir  = "up" | "down";
interface Flash { dir: FlashDir; n: number }

const SIGNAL_META: Record<TipSignal, { label: string; short: string; border: string; badge: string }> = {
  BUY:   { label: "Buy Zone ▲",    short: "BUY",  border: "border-l-emerald-500", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  NEAR:  { label: "Approaching ↓", short: "NEAR", border: "border-l-amber-500",   badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  WATCH: { label: "Watch 👁",       short: "WATCH",border: "border-l-blue-400",    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
};

const SHORT_SIGNAL_META: Record<TipSignal, { label: string; short: string; border: string; badge: string }> = {
  BUY:   { label: "Sell Zone ▼",   short: "SELL", border: "border-l-red-500",   badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  NEAR:  { label: "Approaching ↑", short: "NEAR", border: "border-l-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  WATCH: { label: "Watch 👁",       short: "WATCH",border: "border-l-blue-400",  badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
};

const CONF_BADGE: Record<string, string> = {
  high:   "bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low:    "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const STRENGTH_LABEL: Record<string, string> = {
  strong:   "Strong ↑↑",
  moderate: "Uptrend ↑",
  weak:     "Developing ↗",
  none:     "No Trend",
};

const DOWN_STRENGTH_LABEL: Record<string, string> = {
  strong:   "Strong ↓↓",
  moderate: "Downtrend ↓",
  weak:     "Developing ↘",
  none:     "No Trend",
};

const SIGNAL_ORDER: Record<TipSignal, number> = { BUY: 0, NEAR: 1, WATCH: 2 };

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toFixed(0);
}

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

// ─── Zone Bar ────────────────────────────────────────────────────────────────
function ZoneBar({ tip, currentPrice }: { tip: TradeTip; currentPrice: number }) {
  const isShort = tip.direction === "short";

  // For longs:  bar spans [stopLoss → target], price approaches zone from above
  // For shorts: bar spans [target → stopLoss], price approaches zone from below
  const lo   = isShort ? tip.target   : tip.stopLoss;
  const hi   = isShort ? tip.stopLoss : tip.target;
  const span = hi - lo;
  if (span <= 0) return null;

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));

  const zBotPct      = pct(tip.zone.bottom);
  const zTopPct      = pct(tip.zone.top);
  const pricePct     = pct(currentPrice);
  const zoneWidthPct = zTopPct - zBotPct;

  const zoneFill       = isShort ? "bg-red-200 dark:bg-red-900/50"     : "bg-emerald-200 dark:bg-emerald-900/50";
  const zoneEntryColor = isShort ? "bg-red-500"                         : "bg-emerald-500";
  // entry line: zone bottom for short (prevLL), zone top for long (prevHH)
  const entryLinePct   = isShort ? zBotPct : zTopPct;
  const targetColor    = isShort ? "bg-red-600"                         : "bg-emerald-600";

  return (
    <div className="relative h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-visible my-2">
      {/* Zone fill */}
      <div
        className={`absolute top-0 h-full rounded-full ${zoneFill}`}
        style={{ left: `${zBotPct}%`, width: `${zoneWidthPct}%` }}
      />
      {/* Entry line (zone top for long, zone bottom for short) */}
      <div
        className={`absolute top-0 h-full w-px ${zoneEntryColor}`}
        style={{ left: `${entryLinePct}%` }}
      />
      {/* Stop marker */}
      <div
        className="absolute top-1/2 w-1.5 h-1.5 rounded-full bg-red-500"
        style={{ left: isShort ? "99%" : "1%", transform: "translate(-50%, -50%)" }}
      />
      {/* Target marker */}
      <div
        className={`absolute top-1/2 w-1.5 h-1.5 rounded-full ${targetColor}`}
        style={{ left: isShort ? "1%" : "99%", transform: "translate(-50%, -50%)" }}
      />
      {/* Current price marker */}
      <div
        className="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 bg-blue-500 shadow-sm"
        style={{ left: `${pricePct}%`, transform: "translate(-50%, -50%)", zIndex: 10 }}
      />
    </div>
  );
}

// ─── Swing Sequence ──────────────────────────────────────────────────────────
function SwingSequence({ points, label }: { points: SwingPoint[]; label: string }) {
  const last4 = points.slice(-4);
  if (!last4.length) return null;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[10px] text-gray-400 font-bold w-4 shrink-0">{label}</span>
      <div className="flex items-center gap-0.5 flex-wrap">
        {last4.map((p, i) => {
          const isUp   = i > 0 && p.price > last4[i - 1].price;
          const isFirst = i === 0;
          return (
            <div key={i} className="flex items-center gap-0.5">
              {!isFirst && (
                <span className={`text-[10px] font-bold ${isUp ? "text-emerald-500" : "text-red-400"}`}>
                  {isUp ? "↑" : "↓"}
                </span>
              )}
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded leading-none ${
                isFirst
                  ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                  : isUp
                    ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400"
              }`}>
                {fmt(p.price)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tip Card ────────────────────────────────────────────────────────────────
function TipCard({
  r,
  onChartClick,
  flash,
}: {
  r: StockResult;
  onChartClick: () => void;
  flash?: Flash;
}) {
  const { tip } = r;
  const isShort = tip.direction === "short";
  const meta    = isShort ? SHORT_SIGNAL_META[tip.signal] : SIGNAL_META[tip.signal];
  const chg     = r.changePct ?? 0;

  const strengthKey = isShort ? tip.dow.downStrength : tip.dow.strength;
  const strengthLabel = isShort
    ? DOWN_STRENGTH_LABEL[strengthKey]
    : STRENGTH_LABEL[strengthKey];

  const distLabel =
    tip.bouncingFromZone
      ? isShort ? "Rejecting from zone" : "Bouncing from zone"
      : tip.touchedZone
        ? "Touched zone"
        : tip.distToZonePct < 0
          ? `${Math.abs(tip.distToZonePct).toFixed(1)}% inside zone`
          : isShort
            ? `${tip.distToZonePct.toFixed(1)}% below zone`
            : `${tip.distToZonePct.toFixed(1)}% above zone`;

  const entryLabel = isShort ? "Short" : "Entry";
  const dirBadge = isShort
    ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded"
    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded";

  return (
    <div
      className={`relative overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 border-l-4 ${meta.border} cursor-pointer hover:shadow-md transition-shadow group`}
      onClick={onChartClick}
    >
      {flash && (
        <div
          key={flash.n}
          className={`pointer-events-none absolute inset-0 rounded-xl ${flash.dir === "up" ? "tick-up" : "tick-down"}`}
        />
      )}

      {/* Row 1: Symbol + badges + price */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-[15px] tracking-wide text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {r.symbol}
          </span>
          <span className={dirBadge}>{isShort ? "SHORT" : "LONG"}</span>
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${meta.badge}`}>
            {meta.label}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CONF_BADGE[tip.confidence]}`}>
            {tip.confidence}
          </span>
          <span className="text-[10px] text-gray-400 hidden group-hover:inline-block">↗ chart</span>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`font-mono font-semibold text-sm transition-colors duration-300 ${
            flash?.dir === "up" ? "text-emerald-500" : flash?.dir === "down" ? "text-red-500" : "text-gray-900 dark:text-white"
          }`}>
            ₹{fmtPrice(r.price)}
          </div>
          <div className={`font-mono text-xs mt-0.5 ${chg >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Row 2: Trend strength + R:R */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {strengthLabel}
        </span>
        <span className={`text-[11px] font-mono font-bold ${
          tip.riskReward >= 2
            ? "text-emerald-600 dark:text-emerald-400"
            : tip.riskReward >= 1
              ? "text-amber-600 dark:text-amber-400"
              : "text-gray-500"
        }`}>
          R:R&nbsp;1:{tip.riskReward.toFixed(1)}
        </span>
      </div>

      {/* Zone visual bar */}
      <ZoneBar tip={tip} currentPrice={r.price} />

      {/* Row 3: Trade levels */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {([
          [entryLabel, tip.entry,    "text-blue-600 dark:text-blue-400"],
          ["Target",   tip.target,   isShort ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"],
          ["Stop",     tip.stopLoss, "text-red-500 dark:text-red-400"],
        ] as [string, number, string][]).map(([label, price, cls]) => (
          <div key={label} className="text-center">
            <div className="text-[9px] text-gray-400 uppercase tracking-wide">{label}</div>
            <div className={`font-mono text-[12px] font-bold ${cls}`}>₹{fmt(price)}</div>
          </div>
        ))}
      </div>

      {/* Row 4: Swing sequences */}
      <div className="space-y-1.5 mb-3">
        <SwingSequence points={tip.dow.swingHighs} label="H" />
        <SwingSequence points={tip.dow.swingLows}  label="L" />
      </div>

      {/* Row 5: Zone distance + zone range */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
        <span className="text-[10px] text-gray-400">{distLabel}</span>
        <span className="text-[10px] text-gray-400 font-mono">
          {isShort ? "Supply" : "Demand"} Zone ₹{fmt(tip.zone.bottom)}–{fmt(tip.zone.top)}
        </span>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function TradeTipsScreen() {
  const [results,     setResults]     = useState<StockResult[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [progress,    setProgress]    = useState({ done: 0, total: 0, found: 0 });
  const [filter,      setFilter]      = useState<FilterKey>("ALL");
  const [sort,        setSort]        = useState<SortKey>("signal");
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [flashes,     setFlashes]     = useState<Record<string, Flash>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const cancelRef      = useRef(false);
  const activeSymsRef  = useRef<string[]>([]);
  const prevPricesRef  = useRef<Record<string, number>>({});
  const flashTimers    = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flashSym = useCallback((sym: string, dir: FlashDir) => {
    if (flashTimers.current[sym]) clearTimeout(flashTimers.current[sym]);
    setFlashes((f) => ({ ...f, [sym]: { dir, n: (f[sym]?.n ?? 0) + 1 } }));
    flashTimers.current[sym] = setTimeout(() => {
      setFlashes((f) => { const n = { ...f }; delete n[sym]; return n; });
    }, 900);
  }, []);

  const runScan = useCallback(async () => {
    cancelRef.current = false;
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: FNO_STOCKS.length, found: 0 });
    activeSymsRef.current = [];
    prevPricesRef.current = {};

    for (const sym of FNO_STOCKS) {
      if (cancelRef.current) break;

      try {
        const res = await fetch(
          `/api/quote?symbol=${encodeURIComponent(sym)}&interval=1d&mode=screen`
        );
        if (res.ok) {
          const data = await res.json();
          if (!data.error && Array.isArray(data.candles) && data.candles.length >= 15) {
            const tip = generateTradeTip(data.candles as Candle[]);
            if (tip) {
              const result: StockResult = {
                symbol: sym,
                price: data.price,
                prevClose: data.prevClose,
                changePct: data.changePct ?? 0,
                tip,
              };
              prevPricesRef.current[sym] = data.price;
              setResults((prev) => {
                const next = [...prev, result];
                activeSymsRef.current = next.map((r) => r.symbol);
                return next;
              });
              setProgress((p) => ({ ...p, done: p.done + 1, found: p.found + 1 }));
              await new Promise((r) => setTimeout(r, 200));
              continue;
            }
          }
        }
      } catch { /* silent */ }

      setProgress((p) => ({ ...p, done: p.done + 1 }));
      await new Promise((r) => setTimeout(r, 200));
    }

    setScanning(false);
    setLastUpdated(new Date());
  }, []);

  // Live price refresh every 3 seconds
  useEffect(() => {
    const tick = async () => {
      const syms = activeSymsRef.current;
      if (!syms.length) return;
      try {
        const res = await fetch(`/api/prices?symbols=${syms.map(encodeURIComponent).join(",")}`);
        const data: Record<string, { price: number; prevClose: number; changePct: number }> = await res.json();
        if ((data as any).error) return;
        setResults((prev) =>
          prev.map((x) => {
            const d = data[x.symbol];
            if (!d?.price) return x;
            const old = prevPricesRef.current[x.symbol];
            if (old !== undefined && d.price !== old)
              flashSym(x.symbol, d.price > old ? "up" : "down");
            prevPricesRef.current[x.symbol] = d.price;
            return { ...x, price: d.price, prevClose: d.prevClose, changePct: d.changePct ?? x.changePct };
          })
        );
        setLastUpdated(new Date());
      } catch { /* silent */ }
    };

    const id = window.setInterval(tick, 3_000);
    return () => window.clearInterval(id);
  }, [flashSym]);

  const filtered = results.filter((r) =>
    filter === "ALL" ? true : r.tip.signal === filter
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "signal") {
      const sd = SIGNAL_ORDER[a.tip.signal] - SIGNAL_ORDER[b.tip.signal];
      return sd !== 0 ? sd : b.tip.riskReward - a.tip.riskReward;
    }
    if (sort === "rr")   return b.tip.riskReward - a.tip.riskReward;
    if (sort === "dist") return a.tip.distToZonePct - b.tip.distToZonePct;
    return (b.changePct ?? 0) - (a.changePct ?? 0);
  });

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const countFor = (f: FilterKey) =>
    f === "ALL" ? results.length : results.filter((r) => r.tip.signal === f).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            Trade Tips · Demand &amp; Supply Zones
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Uptrend stocks pulling back to demand zone (long) · Downtrend stocks bouncing to supply zone (short)
          </p>
        </div>

        {/* Scan button */}
        <div className="flex gap-2 mb-6">
          {scanning ? (
            <button
              onClick={() => { cancelRef.current = true; }}
              className="flex-1 px-5 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop ✕
            </button>
          ) : (
            <button
              onClick={runScan}
              className="flex-1 px-5 py-2.5 text-sm font-semibold bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
            >
              Scan All F&amp;O ↗
            </button>
          )}
        </div>

        {/* Progress */}
        {(scanning || progress.done > 0) && (
          <div className="mb-6">
            <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">
                {scanning
                  ? `Scanning ${progress.done} / ${progress.total}…`
                  : `Scanned ${progress.done} / ${progress.total}`}
              </span>
              <span className="text-emerald-600 font-semibold">{progress.found} setups found</span>
            </div>
          </div>
        )}

        {/* Filter + sort */}
        {results.length > 0 && (
          <>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {(["ALL", "BUY", "NEAR", "WATCH"] as FilterKey[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                    filter === f
                      ? f === "BUY"
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : f === "NEAR"
                          ? "bg-amber-500 border-amber-500 text-white"
                          : f === "WATCH"
                            ? "bg-blue-500 border-blue-500 text-white"
                            : "bg-gray-900 dark:bg-white border-gray-900 dark:border-white text-white dark:text-gray-900"
                      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {f === "ALL" ? `All (${countFor("ALL")})` : `${f} (${countFor(f)})`}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className="text-xs text-gray-400">Sort:</span>
              {(
                [
                  ["signal", "Signal"],
                  ["rr",     "R:R"],
                  ["dist",   "Distance"],
                  ["chg",    "% Change"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSort(key)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    sort === key
                      ? "border-gray-900 dark:border-white bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                      : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1.5 text-gray-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                <span className="text-emerald-500 font-semibold text-[11px]">LIVE</span>
                {lastUpdated && (
                  <span className="text-gray-400 text-[10px]">
                    {lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </span>
            </div>
          </>
        )}

        {/* Results */}
        <div className="space-y-3">
          {sorted.map((r) => (
            <TipCard
              key={r.symbol}
              r={r}
              flash={flashes[r.symbol]}
              onChartClick={() => setChartSymbol(r.symbol)}
            />
          ))}
        </div>

        {/* Empty states */}
        {!scanning && results.length === 0 && progress.done === 0 && (
          <div className="text-center py-20 text-sm text-gray-400">
            Click <strong className="text-gray-500">Scan All F&amp;O ↗</strong> to find demand/supply zone setups
          </div>
        )}

        {!scanning && results.length === 0 && progress.done > 0 && (
          <div className="text-center py-10 text-sm text-gray-400">
            No zone setups found right now. Try again when the market has pulled back or bounced.
          </div>
        )}

        {!scanning && results.length > 0 && sorted.length === 0 && (
          <div className="text-center py-10 text-sm text-gray-400">
            No setups match the current filter. Try <strong className="text-gray-500">All</strong>.
          </div>
        )}

        {/* Legend */}
        {results.length > 0 && (
          <div className="mt-8 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <div className="font-semibold text-gray-700 dark:text-gray-300 mb-2">How zones are built</div>
            <div>• <span className="font-medium text-emerald-600 dark:text-emerald-400">Long (demand)</span>: Dow Theory HH+HL uptrend pulling back to prior swing high level</div>
            <div>• <span className="font-medium text-red-500 dark:text-red-400">Short (supply)</span>: Dow Theory LH+LL downtrend bouncing back to prior swing low level</div>
            <div>• Zone width = wave trough/peak between the two confirming swing pivots</div>
            <div>• <span className="font-medium text-emerald-600 dark:text-emerald-400">BUY / SELL</span> = price at zone · <span className="font-medium text-amber-600 dark:text-amber-400">NEAR</span> = within 6% · <span className="font-medium text-blue-500">WATCH</span> = within 20%</div>
            <div>• Stop placed 1% beyond zone edge; target = last confirmed swing pivot · min R:R 1:3</div>
          </div>
        )}

        <p className="text-xs text-gray-400 mt-8 text-center">
          Educational only · Not trading advice · Data delayed ~15 min
        </p>
      </div>

      {chartSymbol && (
        <ChartModal symbol={chartSymbol} onClose={() => setChartSymbol(null)} defaultTf="1D" onlyDemandZones />
      )}
    </div>
  );
}
