"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { calcEMA, calcSRLevels, detectManipulation, calcSDZones, ManipulationEvent, SRLevel, SDZone } from "../lib/technicals";
import { findDowMarkers, analyzeDowTheory } from "../lib/dowTheory";

// ─── Types ────────────────────────────────────────────────────────────────────
interface RawCandle { time: number; o: number; h: number; l: number; c: number; v: number; }
interface ChartData { symbol: string; price: number; prevClose: number; candles5m: RawCandle[]; candles1h: RawCandle[]; candles4h: RawCandle[]; candles1d: RawCandle[]; candles1w: RawCandle[]; }
interface StrikeOI { strike: number; callOI: number; putOI: number; callOIChange: number; putOIChange: number; callVolume: number; putVolume: number; callIV: number; putIV: number; callLTP: number; putLTP: number; }
interface OptionsData { symbol: string; underlyingValue: number; expiryDates: string[]; selectedExpiry: string; strikes: StrikeOI[]; maxCallOIStrike: number; maxPutOIStrike: number; maxCallOI: number; maxPutOI: number; totalCallOI: number; totalPutOI: number; pcr: number; maxPainStrike: number; }
type TF = "5M" | "1H" | "4H" | "1D" | "1W";
type Tab = "chart" | "oi" | "signals";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fv(v: number) {
  if (!v) return "—";
  if (v >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return (v / 1e5).toFixed(1) + " L";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toString();
}
function pct(v: number, total: number) { return total ? Math.round(v / total * 100) : 0; }
// Format expiry: Unix timestamp string → "29 May '25", plain string passes through
function fmtExpiry(d: string) {
  if (/^\d{9,}$/.test(d)) {
    return new Date(parseInt(d) * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  }
  return d;
}

// ─── OI Panel ─────────────────────────────────────────────────────────────────
function OIPanel({ opts, price }: { opts: OptionsData; price: number }) {
  const atmIdx = opts.strikes.reduce((best, s, i) =>
    Math.abs(s.strike - price) < Math.abs(opts.strikes[best].strike - price) ? i : best, 0);
  const from = Math.max(0, atmIdx - 10);
  const to = Math.min(opts.strikes.length, atmIdx + 11);
  const visible = opts.strikes.slice(from, to);
  const maxOI = Math.max(...visible.flatMap(s => [s.callOI, s.putOI])) || 1;
  const strikeStep = visible.length >= 2 ? visible[1].strike - visible[0].strike : 100;

  return (
    <div>
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-red-400" />Call OI</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-green-500" />Put OI</span>
        <span className="ml-auto text-[11px]">ATM ≈ ₹{price.toFixed(0)}</span>
      </div>
      <div className="space-y-0.5">
        {visible.map(s => {
          const isATM = Math.abs(s.strike - price) < strikeStep / 2;
          const isMaxCall = s.strike === opts.maxCallOIStrike;
          const isMaxPut = s.strike === opts.maxPutOIStrike;
          const isMaxPain = s.strike === opts.maxPainStrike;
          const callW = pct(s.callOI, maxOI);
          const putW = pct(s.putOI, maxOI);
          return (
            <div key={s.strike} className={`grid grid-cols-[1fr_64px_1fr] gap-1 items-center text-[11px] rounded py-0.5 px-1 ${isATM ? "bg-blue-50 dark:bg-blue-950/40" : ""} ${isMaxPain ? "ring-1 ring-orange-300" : ""}`}>
              <div className="flex items-center justify-end gap-1">
                {isMaxCall && <span className="text-red-500 font-bold text-[9px]">MAX</span>}
                <span className="text-gray-400 w-12 text-right">{fv(s.callOI)}</span>
                <div className="w-20 flex justify-end"><div className={`h-4 rounded-sm ${isMaxCall ? "bg-red-500" : "bg-red-300 dark:bg-red-700"}`} style={{ width: `${callW}%`, minWidth: s.callOI > 0 ? 2 : 0 }} /></div>
              </div>
              <div className={`text-center font-mono font-semibold px-1 ${isATM ? "text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-300"}`}>
                {s.strike}{isATM && <span className="block text-[8px] text-blue-400 leading-none">ATM</span>}
              </div>
              <div className="flex items-center gap-1">
                <div className="w-20"><div className={`h-4 rounded-sm ${isMaxPut ? "bg-green-600" : "bg-green-400 dark:bg-green-700"}`} style={{ width: `${putW}%`, minWidth: s.putOI > 0 ? 2 : 0 }} /></div>
                <span className="text-gray-400 w-12">{fv(s.putOI)}</span>
                {isMaxPut && <span className="text-green-600 font-bold text-[9px]">MAX</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { label: "PCR", value: opts.pcr.toFixed(2), note: opts.pcr > 1.2 ? "Bullish" : opts.pcr < 0.8 ? "Bearish" : "Neutral", color: opts.pcr > 1.2 ? "text-green-600" : opts.pcr < 0.8 ? "text-red-500" : "text-gray-500" },
          { label: "Max Pain", value: `₹${opts.maxPainStrike}`, note: `${price > opts.maxPainStrike ? "Above" : "Below"} CMP`, color: "text-orange-500" },
          { label: "Max Call OI", value: `₹${opts.maxCallOIStrike}`, note: "Resistance", color: "text-red-500" },
        ].map(({ label, value, note, color }) => (
          <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
            <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
            <div className="text-[10px] text-gray-400">{note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── OI Table ─────────────────────────────────────────────────────────────────
function OITable({ opts, price }: { opts: OptionsData; price: number }) {
  const atmIdx = opts.strikes.reduce((best, s, i) =>
    Math.abs(s.strike - price) < Math.abs(opts.strikes[best].strike - price) ? i : best, 0);
  const from = Math.max(0, atmIdx - 8);
  const to = Math.min(opts.strikes.length, atmIdx + 9);
  const visible = opts.strikes.slice(from, to);
  const strikeStep = visible.length >= 2 ? visible[1].strike - visible[0].strike : 100;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-right py-1.5 px-2 text-red-500 font-semibold">OI</th>
            <th className="text-right py-1.5 px-2 text-red-400">Chg OI</th>
            <th className="text-right py-1.5 px-2 text-red-400">IV%</th>
            <th className="text-right py-1.5 px-2 text-red-400">LTP</th>
            <th className="text-center py-1.5 px-3 text-gray-500 font-bold bg-gray-50 dark:bg-gray-800">STRIKE</th>
            <th className="text-left py-1.5 px-2 text-green-400">LTP</th>
            <th className="text-left py-1.5 px-2 text-green-400">IV%</th>
            <th className="text-left py-1.5 px-2 text-green-400">Chg OI</th>
            <th className="text-left py-1.5 px-2 text-green-600 font-semibold">OI</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(s => {
            const isATM = Math.abs(s.strike - price) < strikeStep / 2;
            const isMaxCall = s.strike === opts.maxCallOIStrike;
            const isMaxPut = s.strike === opts.maxPutOIStrike;
            const isMaxPain = s.strike === opts.maxPainStrike;
            return (
              <tr key={s.strike} className={`border-b border-gray-100 dark:border-gray-800 ${isATM ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}>
                <td className={`text-right py-1 px-2 font-mono ${isMaxCall ? "text-red-600 font-bold" : "text-gray-700 dark:text-gray-300"}`}>{fv(s.callOI)}{isMaxCall && " ★"}</td>
                <td className={`text-right py-1 px-2 font-mono ${s.callOIChange >= 0 ? "text-red-400" : "text-green-500"}`}>{s.callOIChange >= 0 ? "+" : ""}{fv(Math.abs(s.callOIChange))}</td>
                <td className="text-right py-1 px-2 font-mono text-gray-500">{s.callIV ? s.callIV.toFixed(1) : "—"}</td>
                <td className="text-right py-1 px-2 font-mono text-gray-600 dark:text-gray-400">{s.callLTP ? s.callLTP.toFixed(1) : "—"}</td>
                <td className={`text-center py-1 px-3 font-mono font-bold text-xs ${isATM ? "text-blue-600 dark:text-blue-400" : isMaxPain ? "text-orange-500" : "text-gray-700 dark:text-gray-200"}`}>
                  {s.strike}{isMaxPain && <span className="block text-[8px] text-orange-400 leading-none">MAX PAIN</span>}{isATM && !isMaxPain && <span className="block text-[8px] text-blue-400 leading-none">ATM</span>}
                </td>
                <td className="text-left py-1 px-2 font-mono text-gray-600 dark:text-gray-400">{s.putLTP ? s.putLTP.toFixed(1) : "—"}</td>
                <td className="text-left py-1 px-2 font-mono text-gray-500">{s.putIV ? s.putIV.toFixed(1) : "—"}</td>
                <td className={`text-left py-1 px-2 font-mono ${s.putOIChange >= 0 ? "text-green-500" : "text-red-400"}`}>{s.putOIChange >= 0 ? "+" : ""}{fv(Math.abs(s.putOIChange))}</td>
                <td className={`text-left py-1 px-2 font-mono ${isMaxPut ? "text-green-600 font-bold" : "text-gray-700 dark:text-gray-300"}`}>{fv(s.putOI)}{isMaxPut && " ★"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Signals Panel ─────────────────────────────────────────────────────────────
function SignalsPanel({ candles, symbol }: { candles: RawCandle[]; symbol: string }) {
  const events = detectManipulation(candles as any);
  const recent = events.slice(-20).reverse();

  const colorMap = {
    bear_trap: "border-l-green-500 bg-green-50 dark:bg-green-950/20",
    stop_hunt_low: "border-l-green-400 bg-green-50/50 dark:bg-green-950/10",
    fakeout_down: "border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/20",
    bull_trap: "border-l-red-500 bg-red-50 dark:bg-red-950/20",
    stop_hunt_high: "border-l-red-400 bg-red-50/50 dark:bg-red-950/10",
    fakeout_up: "border-l-orange-500 bg-orange-50 dark:bg-orange-950/20",
  };
  const sevColor = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-500" };

  const isBullish = (type: string) => ["bear_trap", "stop_hunt_low", "fakeout_down"].includes(type);

  return (
    <div className="px-5 py-4">
      <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
        <strong>What to look for:</strong> Bear Traps and Fakeout Downs are long entry signals — price was pushed below key lows by large players to trigger retail stop losses, then snapped back. Trade the recovery with tight stop below the wick extreme.
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Total Signals", v: events.length.toString(), color: "text-gray-700 dark:text-gray-200" },
          { label: "Bullish (Long)", v: events.filter(e => isBullish(e.type)).length.toString(), color: "text-green-600" },
          { label: "Bearish (Short)", v: events.filter(e => !isBullish(e.type)).length.toString(), color: "text-red-500" },
        ].map(({ label, v, color }) => (
          <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-[10px] text-gray-400 mb-1">{label}</div>
            <div className={`text-lg font-bold ${color}`}>{v}</div>
          </div>
        ))}
      </div>

      {recent.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">
          No manipulation signals detected in the current timeframe.
          <p className="text-xs mt-1 text-gray-400">Try switching to 1H or 4H for more granular signals.</p>
        </div>
      )}

      <div className="space-y-2">
        {recent.map((e, idx) => {
          const date = new Date(e.time * 1000);
          const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
          const bull = isBullish(e.type);
          return (
            <div key={idx} className={`border-l-4 rounded-r-xl p-3 ${colorMap[e.type]}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{e.label}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sevColor[e.severity]}`}>{e.severity.toUpperCase()}</span>
                  {e.volumeSpike && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">VOL SPIKE</span>}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${bull ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {bull ? "▲ LONG" : "▼ SHORT"}
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">{dateStr}</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{e.description}</p>
              <div className="flex gap-3 mt-1.5 text-[10px] text-gray-500 font-mono">
                <span>Close: ₹{e.price.toFixed(2)}</span>
                <span>Wick: ₹{e.wickExtreme.toFixed(2)}</span>
                {e.recoveryBars > 0 && <span>Recovery: {e.recoveryBars} bar{e.recoveryBars > 1 ? "s" : ""}</span>}
              </div>
              <div className={`mt-2 text-[10px] px-2 py-1 rounded font-mono ${bull ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"}`}>
                {bull
                  ? `📈 Entry: above ₹${e.price.toFixed(2)}  |  Stop: below ₹${e.wickExtreme.toFixed(2)}`
                  : `📉 Entry: below ₹${e.price.toFixed(2)}  |  Stop: above ₹${e.wickExtreme.toFixed(2)}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Candlestick Chart ─────────────────────────────────────────────────────────
function CandleChart({
  candles, tf, opts, srLevels, manipEvents, sdZones,
}: {
  candles: RawCandle[];
  tf: TF;
  opts: OptionsData | null;
  srLevels: SRLevel[];
  manipEvents: ManipulationEvent[];
  sdZones: SDZone[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !candles.length) return;
    let destroyed = false;
    let chartInstance: any = null;
    let ro: ResizeObserver | null = null;

    const load = async () => {
      const LWC = await import("lightweight-charts");
      if (destroyed || !containerRef.current) return;

      const el = containerRef.current;
      el.innerHTML = "";
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const bg = isDark ? "#0f172a" : "#ffffff";
      const textC = isDark ? "#94a3b8" : "#64748b";
      const gridC = isDark ? "#1e293b" : "#f8fafc";
      const borderC = isDark ? "#334155" : "#e2e8f0";

      const chartH = el.clientHeight || Math.max(400, window.innerHeight * 0.6);
      const chart = LWC.createChart(el, {
        width: el.clientWidth,
        height: chartH,
        layout: { background: { color: bg }, textColor: textC },
        grid: { vertLines: { color: gridC }, horzLines: { color: gridC } },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        rightPriceScale: { borderColor: borderC },
        timeScale: { borderColor: borderC, timeVisible: true, secondsVisible: false },
      });
      chartInstance = chart;

      // ── Candlesticks ──
      const candleSeries = chart.addSeries(LWC.CandlestickSeries, {
        upColor: "#16a34a", downColor: "#ef4444",
        borderUpColor: "#16a34a", borderDownColor: "#ef4444",
        wickUpColor: "#16a34a", wickDownColor: "#ef4444",
      });

      // ── Volume ──
      const volSeries = chart.addSeries(LWC.HistogramSeries, {
        color: "#94a3b8", priceFormat: { type: "volume" }, priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      // ── EMA 20 ──
      const emaSeries = chart.addSeries(LWC.LineSeries, {
        color: "#f59e0b",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "EMA 20",
        crosshairMarkerVisible: false,
      });

      const sorted = [...candles].sort((a, b) => a.time - b.time);

      candleSeries.setData(sorted.map(c => ({ time: c.time as any, open: c.o, high: c.h, low: c.l, close: c.c })));
      volSeries.setData(sorted.map(c => ({ time: c.time as any, value: c.v, color: c.c >= c.o ? "rgba(22,163,74,0.45)" : "rgba(239,68,68,0.45)" })));

      const emaPoints = calcEMA(sorted as any, 20);
      emaSeries.setData(emaPoints.map(p => ({ time: p.time as any, value: p.value })));

      // ── S/R Price Lines ──
      const srColors = { support: "#10b981", resistance: "#ef4444" };
      const srStyles = { 1: 2, 2: 2, 3: 1, 4: 1, 5: 0 }; // dotted → dashed → solid by strength
      for (const sr of srLevels.slice(0, 6)) {
        candleSeries.createPriceLine({
          price: sr.price,
          color: srColors[sr.type],
          lineWidth: sr.strength >= 3 ? 2 : 1,
          lineStyle: (srStyles as any)[sr.strength] ?? 1,
          axisLabelVisible: true,
          title: `${sr.label} (${sr.strength}×)`,
        });
      }

      // ── OI Price Lines ──
      if (opts) {
        candleSeries.createPriceLine({ price: opts.maxCallOIStrike, color: "#dc2626", lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: `Max Call OI ₹${opts.maxCallOIStrike}` });
        candleSeries.createPriceLine({ price: opts.maxPutOIStrike, color: "#16a34a", lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: `Max Put OI ₹${opts.maxPutOIStrike}` });
        if (opts.maxPainStrike !== opts.maxCallOIStrike && opts.maxPainStrike !== opts.maxPutOIStrike) {
          candleSeries.createPriceLine({ price: opts.maxPainStrike, color: "#f97316", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `Max Pain ₹${opts.maxPainStrike}` });
        }
      }

      // ── Supply / Demand Zones ──
      for (const zone of sdZones) {
        const isDemand = zone.type === "demand";
        const lineColor = isDemand ? "#10b981" : "#ef4444";
        const alpha = zone.fresh ? 0.18 : 0.09;
        const fill = isDemand ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;

        const zoneSeries = chart.addSeries(LWC.BaselineSeries, {
          baseValue: { type: "price", price: zone.bottom },
          topLineColor: lineColor,
          lineWidth: 1,
          topFillColor1: fill,
          topFillColor2: fill,
          bottomLineColor: "rgba(0,0,0,0)",
          bottomFillColor1: "rgba(0,0,0,0)",
          bottomFillColor2: "rgba(0,0,0,0)",
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "",
        });

        const t0 = (sorted.find(c => c.time >= zone.startTime) ?? sorted[0]).time;
        const t1 = sorted[sorted.length - 1].time;
        zoneSeries.setData([
          { time: t0 as any, value: zone.top },
          { time: t1 as any, value: zone.top },
        ]);

        // Bottom border of zone as a dashed price line
        candleSeries.createPriceLine({
          price: zone.bottom,
          color: lineColor + "80",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
          title: "",
        });
      }

      // ── Markers: Dow Theory swings + Manipulation events ──
      const isBull = (t: string) => ["bear_trap", "stop_hunt_low", "fakeout_down"].includes(t);

      const manipMarkers = manipEvents
        .filter(e => sorted.some(c => c.time === e.time))
        .map(e => ({
          time: e.time as any,
          position: (isBull(e.type) ? "belowBar" : "aboveBar") as any,
          color: isBull(e.type)
            ? (e.severity === "high" ? "#16a34a" : "#34d399")
            : (e.severity === "high" ? "#dc2626" : "#f87171"),
          shape: (isBull(e.type) ? "arrowUp" : "arrowDown") as any,
          text: e.severity === "high"
            ? (isBull(e.type) ? "🐻 TRAP" : "🐂 TRAP")
            : (isBull(e.type) ? "↑ Hunt" : "↓ Hunt"),
          size: e.severity === "high" ? 2 : 1,
        }));

      // Dow Theory pivot markers — lookback/limit tuned per timeframe
      const dtLookback = tf === "1W" ? 3 : 5;
      const dtLimit    = tf === "5M" ? 6 : tf === "1D" ? 10 : tf === "1W" ? 8 : 8;
      const dowRaw = findDowMarkers(sorted, dtLookback, dtLimit);
      const dowMarkers = dowRaw.map(m => ({
        time: m.time as any,
        position: (m.isHigh ? "aboveBar" : "belowBar") as any,
        color: m.isUp ? "#10b981" : "#ef4444",
        shape: "circle" as any,
        text: m.isUp ? (m.isHigh ? "HH" : "HL") : (m.isHigh ? "LH" : "LL"),
        size: 1,
      }));

      // Dow Theory markers rendered first so manipulation arrows paint on top
      const allMarkers = [...dowMarkers, ...manipMarkers]
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (allMarkers.length > 0 && (LWC as any).createSeriesMarkers) {
        (LWC as any).createSeriesMarkers(candleSeries, allMarkers);
      }

      chart.timeScale().fitContent();

      ro = new ResizeObserver(() => {
        if (!destroyed) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight || chartH });
      });
      ro.observe(el);
    };

    load();
    return () => { destroyed = true; ro?.disconnect(); chartInstance?.remove(); };
  }, [candles, tf, opts, srLevels, manipEvents, sdZones]);

  return <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />;
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export function ChartModal({ symbol, onClose, defaultTf = "1H", hideSignals = false }: { symbol: string; onClose: () => void; defaultTf?: TF; hideSignals?: boolean }) {
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [opts, setOpts] = useState<OptionsData | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [optsLoading, setOptsLoading] = useState(true);
  const [chartError, setChartError] = useState("");
  const [optsError, setOptsError] = useState("");
  const [tf, setTf] = useState<TF>(defaultTf);
  const [tab, setTab] = useState<Tab>("chart");
  const [selectedExpiry, setSelectedExpiry] = useState("");

  useEffect(() => {
    setChartLoading(true); setChartError("");
    fetch(`/api/quote?symbol=${symbol}&mode=chart`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (d.error) throw new Error(d.error); setChartData(d); })
      .catch(e => setChartError(e.message))
      .finally(() => setChartLoading(false));
  }, [symbol]);

  const loadOpts = useCallback((expiry = "") => {
    setOptsLoading(true); setOptsError("");
    fetch(`/api/options?symbol=${symbol}${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ""}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setOpts(d); setSelectedExpiry(d.selectedExpiry); })
      .catch(e => setOptsError(e.message))
      .finally(() => setOptsLoading(false));
  }, [symbol]);

  useEffect(() => { loadOpts(); }, [loadOpts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const price = chartData?.price || opts?.underlyingValue || 0;
  const prevClose = chartData?.prevClose || 0;
  const chg = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;

  const candles = useMemo<RawCandle[]>(() => {
    if (!chartData) return [];
    if (tf === "5M") return chartData.candles5m ?? [];
    if (tf === "1H") return chartData.candles1h ?? [];
    if (tf === "4H") return chartData.candles4h ?? [];
    if (tf === "1W") return chartData.candles1w ?? [];
    return chartData.candles1d ?? [];
  }, [chartData, tf]);

  const dowResult1d = useMemo(() => {
    if (!chartData?.candles1d?.length) return null;
    const s = [...chartData.candles1d].sort((a, b) => a.time - b.time);
    return analyzeDowTheory(s.map(c => ({
      date: new Date(c.time * 1000).toISOString().split("T")[0],
      o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
    })) as any);
  }, [chartData]);

  const sorted = useMemo(() => [...candles].sort((a, b) => a.time - b.time), [candles]);
  const srLevels = useMemo(() => calcSRLevels(sorted as any), [sorted]);
  const manipEvents = useMemo(() => detectManipulation(sorted as any), [sorted]);
  const sdZones = useMemo(() => calcSDZones(sorted as any), [sorted]);
  const highSeverityCount = manipEvents.filter(e => e.severity === "high").length;

  const allCandles1H = useMemo(() =>
    chartData?.candles1h ? [...chartData.candles1h].sort((a, b) => a.time - b.time) : [],
    [chartData]);
  const signals1H = useMemo(() => detectManipulation(allCandles1H as any), [allCandles1H]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(3px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-5xl h-[100dvh] md:h-auto md:max-h-[96vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-lg tracking-widest text-gray-900 dark:text-white">{symbol}</span>
            {price > 0 && <>
              <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">₹{price.toFixed(2)}</span>
              <span className={`font-mono text-sm font-semibold px-2 py-0.5 rounded ${chg >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
            </>}
            {opts && !optsLoading && <>
              <span className="hidden sm:inline text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-mono">R ₹{opts.maxCallOIStrike}</span>
              <span className="hidden sm:inline text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-mono">S ₹{opts.maxPutOIStrike}</span>
              <span className="hidden sm:inline text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-mono">Pain ₹{opts.maxPainStrike}</span>
            </>}
            {!hideSignals && highSeverityCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 font-semibold animate-pulse">
                ⚡ {highSeverityCount} Manipulation Signal{highSeverityCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-800 dark:hover:text-white text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">×</button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-5 pt-0 border-b border-gray-100 dark:border-gray-800 shrink-0">
          {([
            ["chart", "📈 Chart"],
            ...(!hideSignals ? [["signals", `⚡ Signals${signals1H.length > 0 ? ` (${signals1H.length})` : ""}`] as [Tab, string]] : []),
            ["oi", "🔢 OI"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${tab === t ? "border-gray-900 dark:border-white text-gray-900 dark:text-white" : "border-transparent text-gray-400 hover:text-gray-600"}`}
            >{label}</button>
          ))}
          {opts && opts.expiryDates.length > 0 && tab === "oi" && (
            <div className="ml-auto flex items-center gap-2 py-1">
              <span className="text-xs text-gray-400">Expiry:</span>
              <select className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 font-mono"
                value={selectedExpiry} onChange={e => { setSelectedExpiry(e.target.value); loadOpts(e.target.value); }}>
                {opts.expiryDates.map(d => <option key={d} value={d}>{fmtExpiry(d)}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Content */}
        <div className={`flex-1 flex flex-col min-h-0 ${tab !== "chart" ? "overflow-y-auto" : "overflow-hidden"}`}>

          {/* ── CHART TAB ── */}
          {tab === "chart" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Toolbar row */}
              <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2 flex-wrap">
                <div className="flex gap-1">
                  {(["5M", "1H", "4H", "1D", "1W"] as TF[]).map(t => (
                    <button key={t} onClick={() => setTf(t)}
                      className={`px-2.5 py-1.5 text-xs font-mono rounded-lg transition-all ${tf === t ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                    >{t}</button>
                  ))}
                </div>
                <div className="hidden sm:flex flex-wrap gap-3 ml-2 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-amber-400" />EMA 20</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-green-500" />Support</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-red-500" />Resistance</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 rounded-sm bg-green-500/20 border border-green-500" />Demand</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-3 rounded-sm bg-red-500/20 border border-red-500" />Supply</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />HH/HL</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />LH/LL</span>
                </div>
              </div>

              {/* Level badges — scrollable strip */}
              {(srLevels.length > 0 || dowResult1d) && (
                <div className="shrink-0 mx-4 mb-2 flex gap-1.5 overflow-x-auto pb-1">
                  {/* Dow Theory 1D summary badge */}
                  {dowResult1d && dowResult1d.strength !== "none" && (
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                      dowResult1d.strength === "strong"
                        ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700"
                        : dowResult1d.strength === "moderate"
                          ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700"
                          : "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-700"
                    }`}>
                      Dow 1D:{" "}
                      {dowResult1d.strength === "strong" ? "Strong ↑↑" : dowResult1d.strength === "moderate" ? "Uptrend ↑" : "Developing ↗"}
                      {" "}({dowResult1d.hhCount}HH · {dowResult1d.hlCount}HL)
                    </span>
                  )}
                  {srLevels.slice(0, 6).map(sr => (
                    <span key={sr.label} className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-mono border ${sr.type === "resistance" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                      {sr.label} ₹{sr.price} ({sr.strength}×)
                    </span>
                  ))}
                  {opts && <>
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-mono border bg-red-100 text-red-800 border-red-300">Call OI ₹{opts.maxCallOIStrike}</span>
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-mono border bg-green-100 text-green-800 border-green-300">Put OI ₹{opts.maxPutOIStrike}</span>
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-mono border bg-orange-100 text-orange-800 border-orange-300">Pain ₹{opts.maxPainStrike}</span>
                  </>}
                  {sdZones.map((z, i) => (
                    <span key={`sdz-${i}`} className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                      z.type === "demand"
                        ? "bg-green-50 text-green-800 border-green-400 dark:bg-green-950/30 dark:text-green-400"
                        : "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400"
                    }`}>
                      {z.type === "demand" ? "D" : "S"} ₹{z.bottom.toFixed(0)}–{z.top.toFixed(0)}{z.fresh ? " ✦" : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Chart — fills all remaining space */}
              <div className="flex-1 min-h-0 px-4 pb-2">
                {chartLoading && (
                  <div className="flex h-full items-center justify-center gap-3 text-sm text-gray-400">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" /> Loading chart...
                  </div>
                )}
                {chartError && <div className="flex h-full items-center justify-center text-sm text-red-500">{chartError}</div>}
                {!chartLoading && !chartError && (
                  <CandleChart key={tf} candles={candles} tf={tf} opts={opts} srLevels={srLevels} manipEvents={hideSignals ? [] : manipEvents} sdZones={sdZones} />
                )}
              </div>

              {/* Compact stats row — hidden on small screens */}
              {!chartLoading && !chartError && (
                <div className="shrink-0 hidden sm:grid grid-cols-4 gap-2 px-4 pb-4">
                  {[
                    { label: "EMA 20", v: (() => { const e = calcEMA(sorted as any, 20); return e.length ? `₹${e[e.length - 1].value.toFixed(2)}` : "—"; })() },
                    { label: "Avg Vol", v: fv(sorted.length ? sorted.reduce((s, c) => s + c.v, 0) / sorted.length : 0) },
                    { label: "Signals", v: `${manipEvents.length} (${manipEvents.filter(e => e.severity === "high").length} high)` },
                    { label: "S/R · Zones", v: `${srLevels.filter(s => s.type === "support").length}S ${srLevels.filter(s => s.type === "resistance").length}R · ${sdZones.filter(z => z.type === "demand").length}D ${sdZones.filter(z => z.type === "supply").length}Sz` },
                  ].map(({ label, v }) => (
                    <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5">
                      <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
                      <div className="text-xs font-mono font-semibold text-gray-800 dark:text-gray-100">{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SIGNALS TAB ── */}
          {tab === "signals" && (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              <div className="shrink-0 flex gap-1 px-5 pt-4 pb-2">
                {(["5M", "1H", "4H", "1D", "1W"] as TF[]).map(t => (
                  <button key={t} onClick={() => setTf(t)}
                    className={`px-2.5 py-1.5 text-xs font-mono rounded-lg transition-all ${tf === t ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                  >{t}</button>
                ))}
                <span className="hidden sm:inline ml-2 self-center text-xs text-gray-400">Manipulation signals · {tf}</span>
              </div>
              {chartLoading
                ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400"><div className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" /> Loading...</div>
                : <SignalsPanel candles={candles} symbol={symbol} />
              }
            </div>
          )}

          {/* ── OI TAB ── */}
          {tab === "oi" && (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {optsLoading && (
                <div className="flex items-center justify-center gap-3 text-sm text-gray-400 py-16">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" /> Fetching NSE option chain...
                </div>
              )}
              {optsError && (
                <div className="py-8 text-center">
                  <p className="text-red-500 text-sm mb-2">{optsError}</p>
                  <p className="text-xs text-gray-400">NSE requires a deployed server. Works on Vercel/Node.js.</p>
                </div>
              )}
              {!optsLoading && !optsError && opts && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    {[
                      { label: "Total Call OI", v: fv(opts.totalCallOI), color: "text-red-600" },
                      { label: "Total Put OI", v: fv(opts.totalPutOI), color: "text-green-600" },
                      { label: "PCR", v: opts.pcr.toFixed(2), color: opts.pcr > 1.2 ? "text-green-600" : opts.pcr < 0.8 ? "text-red-500" : "text-gray-600" },
                      { label: "Max Pain", v: `₹${opts.maxPainStrike}`, color: "text-orange-500" },
                    ].map(({ label, v, color }) => (
                      <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <div className="text-[10px] text-gray-400 mb-1">{label}</div>
                        <div className={`text-sm font-mono font-bold ${color}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">OI by Strike (±10 ATM)</h3>
                  <OIPanel opts={opts} price={price} />
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2 mt-5">Option Chain — {fmtExpiry(opts.selectedExpiry)}</h3>
                  <OITable opts={opts} price={price} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
