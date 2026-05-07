"use client";

import { useState, useCallback } from "react";
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

function formatVol(v: number) {
  if (!v) return "—";
  if (v >= 1e7) return (v / 1e7).toFixed(1) + " Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(1) + " L";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toString();
}

const BADGE: Record<string, { bg: string; border: string; label: string }> = {
  breakdown: { bg: "bg-red-100 text-red-800", border: "border-l-red-500", label: "Breakdown ↓" },
  watch:     { bg: "bg-amber-100 text-amber-800", border: "border-l-amber-500", label: "Breaking Down" },
  uptrend:   { bg: "bg-green-100 text-green-800", border: "border-l-green-600", label: "Uptrend ↑" },
  neutral:   { bg: "bg-gray-100 text-gray-600", border: "border-l-gray-400", label: "No Pattern" },
};

function MiniChart({ segments, breakdown }: { segments: Segment[]; breakdown: boolean }) {
  const allH = segments.map((s) => s.h);
  const allL = segments.map((s) => s.l);
  const maxH = Math.max(...allH);
  const minL = Math.min(...allL);
  const range = maxH - minL || 1;

  return (
    <div className="flex items-end gap-1 h-10 mb-2">
      {segments.map((seg, i) => {
        const isLast = i === 4;
        const hPct = ((seg.h - minL) / range) * 38;
        const lPct = ((seg.l - minL) / range) * 38;
        const bodyH = Math.max(3, hPct - lPct);
        const isDown = isLast && breakdown;
        const color = isDown ? "bg-red-400" : seg.c >= (seg.h + seg.l) / 2 ? "bg-green-600" : "bg-red-300";
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="flex-1 flex items-end w-full">
              <div className={`w-2 mx-auto rounded-sm ${color}`} style={{ height: `${bodyH}px` }} />
            </div>
            <span className={`text-[8px] ${isDown ? "text-red-500" : "text-gray-300"}`}>{isLast ? "↓" : "·"}</span>
          </div>
        );
      })}
    </div>
  );
}

function VolBar({ segments }: { segments: Segment[] }) {
  const maxVol = Math.max(...segments.map((s) => s.avgVol)) || 1;
  return (
    <div className="flex items-end gap-1 h-6 mb-3">
      {segments.map((seg, i) => {
        const pct = (seg.avgVol / maxVol) * 22;
        const isLast = i === 4;
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end">
            <div
              className={`w-full rounded-sm ${isLast ? "bg-red-300" : "bg-blue-200 dark:bg-blue-900"}`}
              style={{ height: `${Math.max(2, pct)}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function ResultCard({ r, onChartClick }: { r: StockResult; onChartClick: () => void }) {
  if (r.error) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 border-l-4 border-l-gray-300">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-base">{r.symbol}</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">ERROR</span>
        </div>
        <p className="text-xs text-red-500 mt-1 font-mono">{r.error}</p>
      </div>
    );
  }

  const { pattern, segments, hh, hl, hv, breakdown, strongBreakdown, breakdownVolSpike, score } = r.pattern;
  const b = BADGE[pattern];
  const chg = ((r.price - r.prevClose) / r.prevClose) * 100;
  const hhC = hh.filter(Boolean).length;
  const hlC = hl.filter(Boolean).length;
  const hvC = hv.filter(Boolean).length;
  const lastSeg = segments[4];

  return (
    <div
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 border-l-4 ${b.border} cursor-pointer hover:shadow-md transition-shadow group`}
      onClick={onChartClick}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-base tracking-wide text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {r.symbol}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${b.bg}`}>{b.label}</span>
          <span className="text-[10px] text-gray-400 hidden group-hover:inline">↗ click for chart</span>
        </div>
        <div className="text-right">
          <div className="font-mono font-semibold text-sm text-gray-900 dark:text-white">₹{r.price.toFixed(2)}</div>
          <div className={`font-mono text-xs ${chg >= 0 ? "text-green-700" : "text-red-500"}`}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Mini price chart + vol bar */}
      <MiniChart segments={segments} breakdown={breakdown} />
      <VolBar segments={segments} />

      {/* Segment grid */}
      <div className="grid grid-cols-5 gap-1 mb-3">
        {segments.map((seg, i) => (
          <div key={i} className={`rounded-md p-1.5 text-center text-[10px] font-mono ${
            i === 4 && breakdown ? "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
            : "bg-gray-50 dark:bg-gray-800"
          }`}>
            <div className="text-gray-400 mb-0.5">S{i + 1}{i === 4 ? " ◀" : ""}</div>
            <div className="font-semibold text-green-700 dark:text-green-400">▲{seg.h.toFixed(1)}</div>
            <div className="text-red-500">▼{seg.l.toFixed(1)}</div>
            <div className="text-gray-400 text-[9px] mt-0.5">{formatVol(seg.avgVol)}</div>
            <div className="mt-0.5">
              {i < 4
                ? hh[i]
                  ? <span className="text-green-600">↑HH</span>
                  : <span className="text-red-400">↓</span>
                : breakdown
                  ? <span className="text-red-600 font-semibold">LL✓</span>
                  : <span className="text-gray-400">—</span>
              }
            </div>
          </div>
        ))}
      </div>

      {/* Signal chips */}
      <div className="flex gap-1.5 flex-wrap">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${hhC >= 2 ? "bg-green-50 text-green-800 border-green-300" : "bg-amber-50 text-amber-800 border-amber-300"}`}>HH {hhC}/3</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${hlC >= 2 ? "bg-green-50 text-green-800 border-green-300" : "bg-amber-50 text-amber-800 border-amber-300"}`}>HL {hlC}/3</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${hvC >= 2 ? "bg-blue-50 text-blue-800 border-blue-300" : "bg-gray-100 text-gray-500 border-gray-300"}`}>Vol ↑ {hvC}/3</span>
        {breakdown
          ? <span className="text-[11px] px-2 py-0.5 rounded-full border bg-red-50 text-red-800 border-red-300">Lower Low ✓</span>
          : <span className="text-[11px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-300">No LL</span>
        }
        {strongBreakdown && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-red-100 text-red-900 border-red-400 font-semibold">Close Below LL ✓</span>}
        {breakdownVolSpike && <span className="text-[11px] px-2 py-0.5 rounded-full border bg-purple-50 text-purple-800 border-purple-300 font-semibold">Vol Spike on BD 🔥</span>}
        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-300">Score {score}/9</span>
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
  }, [input, interval]);

  const ORDER: Record<string, number> = { breakdown: 0, watch: 1, uptrend: 2, neutral: 3 };
  const sorted = [...results].sort((a, b) =>
    (ORDER[a.pattern?.pattern ?? "neutral"] ?? 4) - (ORDER[b.pattern?.pattern ?? "neutral"] ?? 4)
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
            NSE F&amp;O · Breakdown Screener
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            HH + HL uptrend → lower low breakdown, with volume confirmation. Click any stock for chart.
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-2 mb-3">
          <input
            className="flex-1 px-3 py-2 text-sm font-mono uppercase bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 tracking-wider"
            placeholder="RELIANCE, HDFCBANK, TCS ..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runScan()}
          />
          <select
            className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            <option value="1d">Daily</option>
            <option value="1wk">Weekly</option>
          </select>
          <button
            onClick={runScan}
            disabled={loading}
            className="px-5 py-2 text-sm font-semibold bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg disabled:opacity-40 hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
          >
            {loading ? "···" : "Scan ↗"}
          </button>
        </div>

        {/* Presets */}
        <div className="flex gap-2 flex-wrap mb-6 items-center">
          <span className="text-xs text-gray-400">Quick:</span>
          {PRESETS.map((pr) => (
            <button key={pr.label} onClick={() => setInput(pr.syms)}
              className="text-xs font-mono px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              {pr.label}
            </button>
          ))}
        </div>

        {/* Score legend */}
        {results.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Breakdown</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Breaking Down</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Uptrend</span>
            <span className="ml-auto">Score /9 = price (6) + volume (3)</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-8 text-sm text-gray-400">
            <div className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mr-2 align-middle" />
            Fetching {loadingSymbol}...
          </div>
        )}

        {/* Results */}
        <div className="space-y-3">
          {sorted.map((r) => (
            <ResultCard key={r.symbol} r={r} onChartClick={() => setChartSymbol(r.symbol)} />
          ))}
        </div>

        {!loading && results.length === 0 && (
          <div className="text-center py-16 text-sm text-gray-400">
            Enter symbols above and click Scan ↗
          </div>
        )}

        <p className="text-xs text-gray-400 mt-8 text-center">
          Educational only · Not trading advice · Data delayed ~15 min
        </p>
      </div>

      {/* Chart modal */}
      {chartSymbol && <ChartModal symbol={chartSymbol} onClose={() => setChartSymbol(null)} />}
    </div>
  );
}
