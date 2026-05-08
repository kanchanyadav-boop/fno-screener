"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { FNO_STOCKS } from "../lib/fnoStocks";
import { analyzeDowTheory, DowTheoryResult, SwingPoint } from "../lib/dowTheory";
import { Candle } from "../lib/pattern";
import { ChartModal } from "../components/ChartModal";

interface StockResult {
  symbol: string;
  price: number;
  prevClose: number;
  dow: DowTheoryResult;
}

type SortKey = "score" | "hhCount" | "hlCount" | "chg";
type FlashDir = "up" | "down";
interface Flash { dir: FlashDir; n: number }

const STRENGTH = {
  strong:   { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", border: "border-l-emerald-500", label: "Strong Uptrend ↑↑" },
  moderate: { bg: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",             border: "border-l-blue-500",    label: "Uptrend ↑" },
  weak:     { bg: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",             border: "border-l-teal-500",    label: "Developing ↗" },
  none:     { bg: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",                border: "border-l-gray-300",    label: "No Trend" },
};

function SwingSequence({ points, label }: { points: SwingPoint[]; label: string }) {
  const last4 = points.slice(-4);
  if (!last4.length) return null;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[10px] text-gray-400 font-bold w-4 shrink-0">{label}</span>
      <div className="flex items-center gap-0.5 flex-wrap">
        {last4.map((p, i) => {
          const isUp = i > 0 && p.price > last4[i - 1].price;
          const isFirst = i === 0;
          const priceStr = p.price >= 1000
            ? (p.price / 1000).toFixed(1) + "k"
            : p.price.toFixed(0);
          return (
            <div key={i} className="flex items-center gap-0.5">
              {!isFirst && (
                <span className={`text-[10px] font-bold leading-none ${isUp ? "text-emerald-500" : "text-red-400"}`}>
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
                {priceStr}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DowCard({
  r,
  onChartClick,
  flash,
}: {
  r: StockResult;
  onChartClick: () => void;
  flash?: Flash;
}) {
  const { dow } = r;
  const b = STRENGTH[dow.strength];
  const chg = r.prevClose ? ((r.price - r.prevClose) / r.prevClose) * 100 : 0;

  return (
    <div
      className={`relative overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 border-l-4 ${b.border} cursor-pointer hover:shadow-md transition-shadow group`}
      onClick={onChartClick}
    >
      {flash && (
        <div
          key={flash.n}
          className={`pointer-events-none absolute inset-0 rounded-xl ${flash.dir === "up" ? "tick-up" : "tick-down"}`}
        />
      )}

      {/* Row 1: Symbol + badge + price */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-[15px] tracking-wide text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {r.symbol}
          </span>
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${b.bg}`}>
            {b.label}
          </span>
          <span className="text-[10px] text-gray-400 hidden group-hover:inline-block">↗ chart</span>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`font-mono font-semibold text-sm transition-colors duration-300 ${
            flash?.dir === "up" ? "text-emerald-500" : flash?.dir === "down" ? "text-red-500" : "text-gray-900 dark:text-white"
          }`}>
            ₹{r.price.toFixed(2)}
          </div>
          <div className={`font-mono text-xs mt-0.5 ${chg >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Row 2: Swing sequences */}
      <div className="space-y-2 mb-4">
        <SwingSequence points={dow.swingHighs} label="H" />
        <SwingSequence points={dow.swingLows} label="L" />
      </div>

      {/* Row 3: HH/HL dots + score */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-4">
          {(
            [
              ["HH", dow.hhCount, "bg-emerald-500"],
              ["HL", dow.hlCount, "bg-emerald-500"],
            ] as [string, number, string][]
          ).map(([label, count, activeColor]) => (
            <div key={label} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 font-medium w-5">{label}</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full inline-block ${i < count ? activeColor : "bg-gray-200 dark:bg-gray-700"}`}
                />
              ))}
            </div>
          ))}
        </div>
        <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${
          dow.score >= 7
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
            : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
        }`}>
          {dow.score}/10
        </span>
      </div>
    </div>
  );
}

export default function DowUptrendScreen() {
  const [results, setResults] = useState<StockResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, found: 0 });
  const [timeframe, setTimeframe] = useState("1d");
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const [sort, setSort] = useState<SortKey>("score");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const cancelRef = useRef(false);
  const activeSymsRef = useRef<string[]>([]);
  const prevPricesRef = useRef<Record<string, number>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
          `/api/quote?symbol=${encodeURIComponent(sym)}&interval=${timeframe}&mode=screen`
        );
        if (res.ok) {
          const data = await res.json();
          if (!data.error && Array.isArray(data.candles) && data.candles.length >= 13) {
            const dow = analyzeDowTheory(data.candles as Candle[]);
            if (dow.isUptrend) {
              const result: StockResult = {
                symbol: sym,
                price: data.price,
                prevClose: data.prevClose,
                dow,
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
  }, [timeframe]);

  // Live price refresh every 3 seconds for found stocks
  useEffect(() => {
    const tick = async () => {
      const syms = activeSymsRef.current;
      if (!syms.length) return;
      try {
        const res = await fetch(`/api/prices?symbols=${syms.map(encodeURIComponent).join(",")}`);
        const data: Record<string, { price: number; prevClose: number }> = await res.json();
        if ((data as any).error) return;
        setResults((prev) =>
          prev.map((x) => {
            const d = data[x.symbol];
            if (!d?.price) return x;
            const old = prevPricesRef.current[x.symbol];
            if (old !== undefined && d.price !== old)
              flashSym(x.symbol, d.price > old ? "up" : "down");
            prevPricesRef.current[x.symbol] = d.price;
            return { ...x, price: d.price, prevClose: d.prevClose };
          })
        );
        setLastUpdated(new Date());
      } catch { /* silent */ }
    };

    const id = window.setInterval(tick, 3_000);
    return () => window.clearInterval(id);
  }, [flashSym]);

  const sorted = [...results].sort((a, b) => {
    if (sort === "score") return b.dow.score - a.dow.score;
    if (sort === "hhCount") return b.dow.hhCount - a.dow.hhCount;
    if (sort === "hlCount") return b.dow.hlCount - a.dow.hlCount;
    const achg = a.prevClose ? (a.price - a.prevClose) / a.prevClose : 0;
    const bchg = b.prevClose ? (b.price - b.prevClose) / b.prevClose : 0;
    return bchg - achg;
  });

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            Dow Theory · Uptrend Scanner
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Scans all {FNO_STOCKS.length} NSE F&amp;O stocks for consecutive Higher Highs + Higher Lows
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-2 mb-6">
          <select
            className="px-3 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none text-gray-700 dark:text-gray-300"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            disabled={scanning}
          >
            <option value="1d">Daily</option>
            <option value="1wk">Weekly</option>
          </select>
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
                {scanning ? `Scanning ${progress.done} / ${progress.total}…` : `Scanned ${progress.done} / ${progress.total}`}
              </span>
              <span className="text-emerald-600 font-semibold">{progress.found} in uptrend</span>
            </div>
          </div>
        )}

        {/* Sort + live indicator */}
        {results.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="text-xs text-gray-400">Sort:</span>
            {(
              [
                ["score", "Score"],
                ["hhCount", "HH Count"],
                ["hlCount", "HL Count"],
                ["chg", "% Change"],
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
        )}

        {/* Results */}
        <div className="space-y-3">
          {sorted.map((r) => (
            <DowCard
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
            Click <strong className="text-gray-500">Scan All F&amp;O ↗</strong> to find NSE F&amp;O stocks in Dow Theory uptrend
          </div>
        )}

        {!scanning && results.length === 0 && progress.done > 0 && (
          <div className="text-center py-10 text-sm text-gray-400">
            No confirmed Dow Theory uptrends found. Try switching to Weekly timeframe.
          </div>
        )}

        <p className="text-xs text-gray-400 mt-10 text-center">
          Educational only · Not trading advice · Data delayed ~15 min
        </p>
      </div>

      {chartSymbol && <ChartModal symbol={chartSymbol} onClose={() => setChartSymbol(null)} defaultTf="1D" />}
    </div>
  );
}
