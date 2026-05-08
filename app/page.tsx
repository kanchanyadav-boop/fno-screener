"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { detectPattern, PatternResult, Segment } from "./lib/pattern";
import { ChartModal } from "./components/ChartModal";

const PRESETS = [
  { label: "Top F&O", syms: "RELIANCE,HDFCBANK,TCS,INFY,ICICIBANK" },
  { label: "Mid picks", syms: "TATAMOTORS,BAJFINANCE,SBIN,AXISBANK,WIPRO" },
  { label: "Mixed", syms: "ADANIENT,ADANIPORTS,LTIM,HCLTECH,SUNPHARMA" },
  { label: "Indices", syms: "NIFTY50,BANKNIFTY" },
];

interface StockResult {
  symbol: string;
  price: number;
  prevClose: number;
  pattern: PatternResult;
  segments: Segment[];
  error?: string;
}

function fv(v: number) {
  if (!v) return "—";
  if (v >= 1e7) return (v / 1e7).toFixed(1) + " Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(1) + " L";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toString();
}

const BADGE: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  breakdown: { bg: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",   border: "border-l-red-500",   dot: "bg-red-500",   label: "Breakdown ↓" },
  watch:     { bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", border: "border-l-amber-500", dot: "bg-amber-400", label: "Watch ⚠" },
  uptrend:   { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", border: "border-l-emerald-500", dot: "bg-emerald-500", label: "Uptrend ↑" },
  neutral:   { bg: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",   border: "border-l-gray-300",  dot: "bg-gray-400",  label: "Neutral" },
};

// Positioned bar chart showing H-L range of each segment
function MiniChart({ segments, breakdown }: { segments: Segment[]; breakdown: boolean }) {
  const maxH = Math.max(...segments.map((s) => s.h));
  const minL = Math.min(...segments.map((s) => s.l));
  const range = maxH - minL || 1;
  const H = 48;

  return (
    <div className="relative flex gap-1.5 mb-3" style={{ height: H }}>
      {segments.map((seg, i) => {
        const isLast = i === 4;
        const isDown = isLast && breakdown;
        const isBull = seg.c >= (seg.h + seg.l) / 2;
        const top = ((maxH - seg.h) / range) * H;
        const height = Math.max(4, ((seg.h - seg.l) / range) * H);
        const color = isDown ? "bg-red-500" : isBull ? "bg-emerald-500" : "bg-red-400";
        return (
          <div key={i} className="flex-1 relative rounded-sm overflow-hidden bg-gray-100 dark:bg-gray-800" style={{ height: H }}>
            <div className={`absolute inset-x-0 rounded-sm ${color}`} style={{ top, height, opacity: isDown ? 1 : 0.75 }} />
          </div>
        );
      })}
    </div>
  );
}

type FlashDir = "up" | "down";
interface Flash { dir: FlashDir; n: number; }

function ResultCard({ r, onChartClick, flash }: { r: StockResult; onChartClick: () => void; flash?: Flash }) {
  if (r.error) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 border-l-4 border-l-gray-300">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono font-bold text-sm text-gray-800 dark:text-gray-200">{r.symbol}</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">ERROR</span>
        </div>
        <p className="text-xs text-red-500 font-mono">{r.error}</p>
      </div>
    );
  }

  const { pattern, segments, hh, hl, hv, breakdown, strongBreakdown, breakdownVolSpike, score } = r.pattern;
  const b = BADGE[pattern];
  const chg = ((r.price - r.prevClose) / r.prevClose) * 100;

  return (
    <div
      className={`relative overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 border-l-4 ${b.border} cursor-pointer hover:shadow-md transition-shadow group`}
      onClick={onChartClick}
    >
      {/* Price tick flash overlay — key forces animation restart on each tick */}
      {flash && (
        <div key={flash.n} className={`pointer-events-none absolute inset-0 rounded-xl ${flash.dir === "up" ? "tick-up" : "tick-down"}`} />
      )}

      {/* ── Row 1: Symbol / badge / price ── */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-[15px] tracking-wide text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {r.symbol}
          </span>
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${b.bg}`}>{b.label}</span>
          <span className="text-[10px] text-gray-400 hidden group-hover:inline-block">↗ chart</span>
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className={`font-mono font-semibold text-sm transition-colors duration-300 ${
            flash?.dir === "up" ? "text-emerald-500" : flash?.dir === "down" ? "text-red-500" : "text-gray-900 dark:text-white"
          }`}>₹{r.price.toFixed(2)}</div>
          <div className={`font-mono text-xs mt-0.5 ${chg >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* ── Row 2: Mini price chart ── */}
      <MiniChart segments={segments} breakdown={breakdown} />

      {/* ── Row 3: Segment grid ── */}
      <div className="grid grid-cols-5 gap-1.5 mb-4">
        {segments.map((seg, i) => (
          <div key={i} className={`rounded-lg p-2 text-center font-mono text-xs ${
            i === 4 && breakdown
              ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
              : "bg-gray-50 dark:bg-gray-800/60"
          }`}>
            <div className="text-[10px] text-gray-400 mb-1 font-sans">S{i + 1}</div>
            <div className="font-semibold text-gray-800 dark:text-gray-100">{seg.h.toFixed(0)}</div>
            <div className="text-red-400 dark:text-red-400">{seg.l.toFixed(0)}</div>
            <div className="text-[10px] text-gray-400 mt-1">{fv(seg.avgVol)}</div>
            <div className="mt-1 text-[10px] font-semibold">
              {i < 4
                ? hh[i]
                  ? <span className="text-emerald-600 dark:text-emerald-400">HH</span>
                  : <span className="text-gray-300 dark:text-gray-600">—</span>
                : breakdown
                  ? <span className="text-red-500 font-bold">LL</span>
                  : <span className="text-gray-300 dark:text-gray-600">—</span>
              }
            </div>
          </div>
        ))}
      </div>

      {/* ── Row 4: Signal indicators + score ── */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
        {/* Dot indicators for HH / HL / Vol */}
        <div className="flex items-center gap-4">
          {([ ["HH", hh, "bg-emerald-500"], ["HL", hl, "bg-emerald-500"], ["Vol", hv, "bg-blue-500"] ] as [string, boolean[], string][]).map(([label, arr, activeColor]) => (
            <div key={label} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 font-medium w-5">{label}</span>
              {arr.map((v, i) => (
                <span key={i} className={`w-2 h-2 rounded-full inline-block ${v ? activeColor : "bg-gray-200 dark:bg-gray-700"}`} />
              ))}
            </div>
          ))}
        </div>

        {/* Special signals + score */}
        <div className="flex items-center gap-1.5">
          {strongBreakdown && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-semibold">
              Close LL
            </span>
          )}
          {breakdownVolSpike && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-semibold">
              Vol Spike
            </span>
          )}
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${
            score >= 7 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
            : score >= 5 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
            : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          }`}>{score}/9</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState("RELIANCE,HDFCBANK,TCS");
  const [interval, setInterval] = useState("1d");
  const [results, setResults] = useState<StockResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSymbol, setLoadingSymbol] = useState("");
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const activeSymsRef = useRef<string[]>([]);
  const prevPricesRef = useRef<Record<string, number>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const runScan = useCallback(async () => {
    const syms = input.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!syms.length) return;
    setLoading(true);
    setResults([]);

    for (const sym of syms) {
      setLoadingSymbol(sym);
      try {
        const res = await fetch(`/api/quote?symbol=${sym}&interval=${interval}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setResults((prev) => [...prev, { symbol: sym, price: 0, prevClose: 0, pattern: {} as PatternResult, segments: [], error: err.error || `HTTP ${res.status}` }]);
          continue;
        }
        const data = await res.json();
        if (data.error) {
          setResults((prev) => [...prev, { symbol: sym, price: 0, prevClose: 0, pattern: {} as PatternResult, segments: [], error: data.error }]);
          continue;
        }
        const pattern = detectPattern(data.candles);
        setResults((prev) => [...prev, { symbol: sym, price: data.price, prevClose: data.prevClose, pattern, segments: pattern.segments }]);
      } catch (e: any) {
        setResults((prev) => [...prev, { symbol: sym, price: 0, prevClose: 0, pattern: {} as PatternResult, segments: [], error: String(e) }]);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    setLoading(false);
    setLoadingSymbol("");
    setLastUpdated(new Date());
    const scannedSyms = input.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    activeSymsRef.current = scannedSyms;
    // Seed prev-prices so first tick compares correctly
    setResults(prev => {
      prev.forEach(r => { if (r.price) prevPricesRef.current[r.symbol] = r.price; });
      return prev;
    });
  }, [input, interval]);

  // Live price refresh — 3-second batch poll
  useEffect(() => {
    if (results.length === 0) return;

    const flashSym = (sym: string, dir: FlashDir) => {
      if (flashTimers.current[sym]) clearTimeout(flashTimers.current[sym]);
      setFlashes(f => ({ ...f, [sym]: { dir, n: (f[sym]?.n ?? 0) + 1 } }));
      flashTimers.current[sym] = setTimeout(() => {
        setFlashes(f => { const n = { ...f }; delete n[sym]; return n; });
      }, 900);
    };

    const tick = async () => {
      const syms = activeSymsRef.current.filter(Boolean);
      if (!syms.length) return;
      try {
        const r = await fetch(`/api/prices?symbols=${syms.join(",")}`);
        const data: Record<string, { price: number; prevClose: number }> = await r.json();
        if ((data as any).error) return;
        setResults(prev => prev.map(x => {
          const d = data[x.symbol];
          if (!d?.price) return x;
          const old = prevPricesRef.current[x.symbol];
          if (old !== undefined && d.price !== old) flashSym(x.symbol, d.price > old ? "up" : "down");
          prevPricesRef.current[x.symbol] = d.price;
          return { ...x, price: d.price, prevClose: d.prevClose };
        }));
        setLastUpdated(new Date());
      } catch { /* silent */ }
    };

    const id = window.setInterval(tick, 3_000);
    return () => window.clearInterval(id);
  }, [results.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ORDER: Record<string, number> = { breakdown: 0, watch: 1, uptrend: 2, neutral: 3 };
  const sorted = [...results].sort((a, b) =>
    (ORDER[a.pattern?.pattern ?? "neutral"] ?? 4) - (ORDER[b.pattern?.pattern ?? "neutral"] ?? 4)
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">

        {/* ── Header ── */}
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            NSE F&amp;O · Breakdown Screener
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Detects HH + HL uptrends breaking down with volume. Click any card for full chart.
          </p>
        </div>

        {/* ── Controls ── */}
        <div className="flex gap-2 mb-3">
          <input
            className="flex-1 px-3 py-2.5 text-sm font-mono uppercase bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 tracking-wider placeholder:normal-case placeholder:text-gray-300 dark:placeholder:text-gray-600"
            placeholder="RELIANCE, HDFCBANK, TCS …"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runScan()}
          />
          <select
            className="px-3 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none text-gray-700 dark:text-gray-300"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            <option value="1d">Daily</option>
            <option value="1wk">Weekly</option>
          </select>
          <button
            onClick={runScan}
            disabled={loading}
            className="px-5 py-2.5 text-sm font-semibold bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg disabled:opacity-40 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
          >
            {loading ? "···" : "Scan ↗"}
          </button>
        </div>

        {/* ── Presets ── */}
        <div className="flex gap-2 flex-wrap mb-6 items-center">
          <span className="text-xs text-gray-400">Quick:</span>
          {PRESETS.map((pr) => (
            <button key={pr.label} onClick={() => setInput(pr.syms)}
              className="text-xs font-medium px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              {pr.label}
            </button>
          ))}
        </div>

        {/* ── Legend + live indicator ── */}
        {results.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-gray-500">
            {Object.entries(BADGE).map(([key, val]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full inline-block ${val.dot}`} />
                {val.label}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-gray-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
              <span className="text-emerald-500 font-semibold text-[11px]">LIVE</span>
              {lastUpdated && (
                <span className="text-gray-400 text-[10px]">{lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              )}
            </span>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            Fetching {loadingSymbol}…
          </div>
        )}

        {/* ── Results ── */}
        <div className="space-y-3">
          {sorted.map((r) => (
            <ResultCard key={r.symbol} r={r} flash={flashes[r.symbol]} onChartClick={() => setChartSymbol(r.symbol)} />
          ))}
        </div>

        {!loading && results.length === 0 && (
          <div className="text-center py-20 text-sm text-gray-400">
            Enter symbols above and click <strong className="text-gray-500">Scan ↗</strong>
          </div>
        )}

        <p className="text-xs text-gray-400 mt-10 text-center">
          Educational only · Not trading advice · Data delayed ~15 min
        </p>
      </div>

      {chartSymbol && <ChartModal symbol={chartSymbol} onClose={() => setChartSymbol(null)} />}
    </div>
  );
}
