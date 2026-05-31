import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FNO_STOCKS } from "../../lib/fnoStocks";
import { fetchCandles } from "../../lib/api";
import { analyzeDowTheory } from "../../lib/dowTheory";
import { detectPattern, PatternResult } from "../../lib/pattern";
import { Candle, DowTheoryResult, SwingPoint } from "../../lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DowRow { symbol: string; price: number; changePct: number; dow: DowTheoryResult }
interface BreakRow { symbol: string; price: number; changePct: number; pat: PatternResult }

type Mode = "dow" | "break";
type TrendDir = "up" | "down";
type BreakFilter = "all" | "breakdown" | "watch" | "uptrend";
type SortKey = "score" | "count1" | "count2" | "chg";

// ── Light Theme ───────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", text2: "#64748b", text3: "#94a3b8",
  up: "#16a34a", down: "#dc2626", warn: "#d97706", blue: "#2563eb",
  upBg: "#dcfce7", downBg: "#fee2e2", warnBg: "#fef3c7", blueBg: "#dbeafe",
  progressBg: "#e2e8f0",
};

const DOW_STRENGTH = {
  up: {
    strong:   { badge: C.upBg, badgeText: "#166534", border: "#16a34a", label: "Strong Uptrend ↑↑" },
    moderate: { badge: C.blueBg, badgeText: "#1e40af", border: C.blue, label: "Uptrend ↑" },
    weak:     { badge: "#f0fdf4", badgeText: "#4d7c0f", border: "#84cc16", label: "Developing ↗" },
    none:     { badge: "#f1f5f9", badgeText: C.text3, border: C.border, label: "No Trend" },
  },
  down: {
    strong:   { badge: C.downBg, badgeText: "#991b1b", border: C.down, label: "Strong Downtrend ↓↓" },
    moderate: { badge: "#fff7ed", badgeText: "#9a3412", border: "#f97316", label: "Downtrend ↓" },
    weak:     { badge: C.warnBg, badgeText: "#92400e", border: C.warn, label: "Weakening ↘" },
    none:     { badge: "#f1f5f9", badgeText: C.text3, border: C.border, label: "No Trend" },
  },
};

const BREAK_STYLE: Record<string, { badge: string; badgeText: string; border: string }> = {
  breakdown: { badge: C.downBg,  badgeText: "#991b1b", border: C.down },
  watch:     { badge: C.warnBg,  badgeText: "#92400e", border: C.warn },
  uptrend:   { badge: C.upBg,    badgeText: "#166534", border: C.up },
  neutral:   { badge: "#f1f5f9", badgeText: C.text3,   border: C.border },
};

// ── Swing Sequence ────────────────────────────────────────────────────────────
function SwingSeq({ points, label }: { points: SwingPoint[]; label: string }) {
  const last4 = points.slice(-4);
  if (!last4.length) return null;
  return (
    <View style={sq.row}>
      <Text style={sq.label}>{label}</Text>
      {last4.map((p, i) => {
        const isUp = i > 0 && p.price > last4[i - 1].price;
        const isFirst = i === 0;
        return (
          <View key={i} style={sq.item}>
            {!isFirst && (
              <Text style={[sq.arrow, { color: isUp ? C.up : C.down }]}>
                {isUp ? "↑" : "↓"}
              </Text>
            )}
            <Text style={[sq.price, {
              backgroundColor: isFirst ? "#f1f5f9" : isUp ? C.upBg : C.downBg,
              color: isFirst ? C.text3 : isUp ? "#166534" : "#991b1b",
            }]}>
              {p.price.toFixed(0)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
const sq = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 3 },
  label: { color: C.text3, fontSize: 9, fontWeight: "700", width: 10 },
  item:  { flexDirection: "row", alignItems: "center", gap: 2 },
  arrow: { fontSize: 8, fontWeight: "700" },
  price: { fontSize: 8, fontFamily: "monospace", paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3 },
});

// ── Dot Row ───────────────────────────────────────────────────────────────────
function DotRow({ label, count, color, max = 4 }: { label: string; count: number; color: string; max?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Text style={{ color: C.text3, fontSize: 9, fontWeight: "600", width: 16 }}>{label}</Text>
      {Array.from({ length: max }).map((_, i) => (
        <View key={i} style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: i < count ? color : "#e2e8f0",
        }} />
      ))}
    </View>
  );
}

// ── Mini Segment Bar Chart ────────────────────────────────────────────────────
function SegBar({ segments, hh }: { segments: { h: number; l: number; c: number }[]; hh: boolean[] }) {
  const allH = Math.max(...segments.map((s) => s.h));
  const allL = Math.min(...segments.map((s) => s.l));
  const range = allH - allL || 1;
  const barH = 28;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: barH + 4 }}>
      {segments.map((s, i) => {
        const top = ((allH - s.h) / range) * barH;
        const h = Math.max(3, ((s.h - s.l) / range) * barH);
        const isLast = i === 4;
        const isDown = isLast && (segments[3] ? s.c < segments[3].c : false);
        const color = isLast ? (isDown ? C.down : C.up) : (hh[i] ? C.up : "#cbd5e1");
        return (
          <View key={i} style={{ width: 10, height: barH, justifyContent: "flex-end" }}>
            <View style={{
              position: "absolute", top, height: h, width: 10,
              backgroundColor: color, borderRadius: 2, opacity: isLast ? 1 : 0.7,
            }} />
          </View>
        );
      })}
    </View>
  );
}

// ── Dow Card ──────────────────────────────────────────────────────────────────
function DowCard({ row: r, dir }: { row: DowRow; dir: TrendDir }) {
  const dow = r.dow;
  const styles = dir === "up"
    ? DOW_STRENGTH.up[dow.strength]
    : DOW_STRENGTH.down[dow.downStrength];
  const score = dir === "up" ? dow.score : dow.downScore;
  const chgPos = r.changePct >= 0;

  return (
    <View style={[dc.card, { borderLeftColor: styles.border }]}>
      <View style={dc.row1}>
        <View style={dc.row1L}>
          <Text style={dc.symbol}>{r.symbol}</Text>
          <View style={[dc.badge, { backgroundColor: styles.badge }]}>
            <Text style={[dc.badgeText, { color: styles.badgeText }]}>{styles.label}</Text>
          </View>
        </View>
        <View style={dc.row1R}>
          <Text style={dc.price}>₹{r.price.toFixed(2)}</Text>
          <Text style={[dc.chg, { color: chgPos ? C.up : C.down }]}>
            {chgPos ? "+" : ""}{r.changePct.toFixed(2)}%
          </Text>
        </View>
      </View>

      <SwingSeq points={dow.swingHighs} label="H" />
      <SwingSeq points={dow.swingLows} label="L" />

      <View style={dc.footer}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {dir === "up" ? (
            <>
              <DotRow label="HH" count={dow.hhCount} color={C.up} />
              <DotRow label="HL" count={dow.hlCount} color={C.up} />
            </>
          ) : (
            <>
              <DotRow label="LH" count={dow.lhCount} color={C.down} />
              <DotRow label="LL" count={dow.llCount} color={C.down} />
            </>
          )}
        </View>
        <View style={[dc.scoreBadge, {
          backgroundColor: score >= 7 ? (dir === "up" ? C.upBg : C.downBg) : C.blueBg,
        }]}>
          <Text style={[dc.scoreText, {
            color: score >= 7 ? (dir === "up" ? "#166534" : "#991b1b") : "#1e40af",
          }]}>
            {score}/10
          </Text>
        </View>
      </View>
    </View>
  );
}
const dc = StyleSheet.create({
  card:      { backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4 },
  row1:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  row1L:     { flex: 1, gap: 4 },
  row1R:     { alignItems: "flex-end" },
  symbol:    { color: C.text, fontFamily: "monospace", fontWeight: "700", fontSize: 15 },
  badge:     { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  price:     { color: C.text, fontFamily: "monospace", fontWeight: "600", fontSize: 13 },
  chg:       { fontFamily: "monospace", fontSize: 11, marginTop: 2 },
  footer:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  scoreBadge:{ borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { fontFamily: "monospace", fontSize: 10, fontWeight: "700" },
});

// ── Breakdown Card ────────────────────────────────────────────────────────────
function BreakCard({ row: r }: { row: BreakRow }) {
  const pat = r.pat;
  const bs = BREAK_STYLE[pat.pattern] ?? BREAK_STYLE.neutral;
  const chgPos = r.changePct >= 0;

  return (
    <View style={[bc.card, { borderLeftColor: bs.border }]}>
      <View style={bc.row1}>
        <View style={bc.row1L}>
          <Text style={bc.symbol}>{r.symbol}</Text>
          <View style={[bc.badge, { backgroundColor: bs.badge }]}>
            <Text style={[bc.badgeText, { color: bs.badgeText }]}>{pat.label}</Text>
          </View>
        </View>
        <View style={bc.row1R}>
          <Text style={bc.price}>₹{r.price.toFixed(2)}</Text>
          <Text style={[bc.chg, { color: chgPos ? C.up : C.down }]}>
            {chgPos ? "+" : ""}{r.changePct.toFixed(2)}%
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <SegBar segments={pat.segments} hh={pat.hh} />
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <DotRow label="HH" count={pat.hh.filter(Boolean).length} color={C.up} max={3} />
            <DotRow label="HL" count={pat.hl.filter(Boolean).length} color={C.up} max={3} />
          </View>
          <DotRow label="Vol" count={pat.hv.filter(Boolean).length} color={C.blue} max={3} />
        </View>
        <View style={[bc.scoreBadge, {
          backgroundColor: pat.score >= 7 ? C.upBg : pat.score >= 4 ? C.blueBg : "#f1f5f9",
          marginLeft: "auto" as any,
        }]}>
          <Text style={[bc.scoreText, {
            color: pat.score >= 7 ? "#166534" : pat.score >= 4 ? "#1e40af" : C.text3,
          }]}>
            {pat.score}/9
          </Text>
        </View>
      </View>

      {pat.breakdownVolSpike && (
        <View style={[bc.alertTag]}>
          <Text style={bc.alertText}>⚠ Volume spike on breakdown</Text>
        </View>
      )}
    </View>
  );
}
const bc = StyleSheet.create({
  card:      { backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4 },
  row1:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  row1L:     { flex: 1, gap: 4 },
  row1R:     { alignItems: "flex-end" },
  symbol:    { color: C.text, fontFamily: "monospace", fontWeight: "700", fontSize: 15 },
  badge:     { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  price:     { color: C.text, fontFamily: "monospace", fontWeight: "600", fontSize: 13 },
  chg:       { fontFamily: "monospace", fontSize: 11, marginTop: 2 },
  scoreBadge:{ borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { fontFamily: "monospace", fontSize: 10, fontWeight: "700" },
  alertTag:  { backgroundColor: C.warnBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  alertText: { color: "#92400e", fontSize: 10, fontWeight: "600" },
});

// ── Chip ──────────────────────────────────────────────────────────────────────
function Chip({ label, active, color, onPress }: { label: string; active: boolean; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[ch.chip, active && { borderColor: color, backgroundColor: color + "18" }]}
      onPress={onPress}
    >
      <Text style={[ch.text, { color: active ? color : C.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}
const ch = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  text: { fontSize: 11, fontWeight: "600" },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TrendsTab() {
  const [mode, setMode] = useState<Mode>("dow");
  const [trendDir, setTrendDir] = useState<TrendDir>("up");
  const [breakFilter, setBreakFilter] = useState<BreakFilter>("all");
  const [sort, setSort] = useState<SortKey>("score");

  const [dowRows, setDowRows]   = useState<DowRow[]>([]);
  const [breakRows, setBreakRows] = useState<BreakRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, found: 0 });
  const cancelRef = useRef(false);

  const runScan = useCallback(async () => {
    cancelRef.current = false;
    setScanning(true);
    if (mode === "dow") setDowRows([]); else setBreakRows([]);
    setProgress({ done: 0, total: FNO_STOCKS.length, found: 0 });

    for (const sym of FNO_STOCKS) {
      if (cancelRef.current) break;
      try {
        const data = await fetchCandles(sym);
        if (data.candles.length >= 13) {
          if (mode === "dow") {
            const dow = analyzeDowTheory(data.candles as Candle[]);
            if (dow.isUptrend || dow.isDowntrend) {
              const row: DowRow = { symbol: sym, price: data.price, changePct: data.changePct, dow };
              setDowRows((p) => [...p, row]);
              setProgress((p) => ({ ...p, done: p.done + 1, found: p.found + 1 }));
              await delay(150);
              continue;
            }
          } else {
            const pat = detectPattern(data.candles as Candle[]);
            if (pat.pattern !== "neutral") {
              const row: BreakRow = { symbol: sym, price: data.price, changePct: data.changePct, pat };
              setBreakRows((p) => [...p, row]);
              setProgress((p) => ({ ...p, done: p.done + 1, found: p.found + 1 }));
              await delay(150);
              continue;
            }
          }
        }
      } catch { /* silent */ }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      await delay(150);
    }
    setScanning(false);
  }, [mode]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  // Sorted Dow results
  const sortedDow = [...dowRows].sort((a, b) => {
    const isDown = trendDir === "down";
    if (sort === "score")  return isDown ? b.dow.downScore - a.dow.downScore : b.dow.score - a.dow.score;
    if (sort === "count1") return isDown ? b.dow.lhCount - a.dow.lhCount : b.dow.hhCount - a.dow.hhCount;
    if (sort === "count2") return isDown ? b.dow.llCount - a.dow.llCount : b.dow.hlCount - a.dow.hlCount;
    return (b.changePct ?? 0) - (a.changePct ?? 0);
  });
  const filteredDow = sortedDow.filter((r) =>
    trendDir === "up" ? r.dow.isUptrend : r.dow.isDowntrend
  );

  // Sorted Breakdown results
  const sortedBreak = [...breakRows].sort((a, b) => {
    if (sort === "score") return b.pat.score - a.pat.score;
    if (sort === "count1") return b.pat.hh.filter(Boolean).length - a.pat.hh.filter(Boolean).length;
    if (sort === "count2") return b.pat.hl.filter(Boolean).length - a.pat.hl.filter(Boolean).length;
    return (b.changePct ?? 0) - (a.changePct ?? 0);
  });
  const filteredBreak = breakFilter === "all"
    ? sortedBreak
    : sortedBreak.filter((r) => r.pat.pattern === breakFilter);

  const displayData = mode === "dow" ? filteredDow : filteredBreak;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Trends & Patterns</Text>
        <Text style={s.subtitle}>Dow Theory · Breakdown Scanner</Text>
      </View>

      {/* Mode toggle */}
      <View style={s.modeRow}>
        <TouchableOpacity
          style={[s.modeBtn, mode === "dow" && s.modeBtnActive]}
          onPress={() => { setMode("dow"); setProgress({ done: 0, total: 0, found: 0 }); }}
        >
          <Text style={[s.modeBtnText, mode === "dow" && s.modeBtnTextActive]}>Dow Theory</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.modeBtn, mode === "break" && s.modeBtnActive]}
          onPress={() => { setMode("break"); setProgress({ done: 0, total: 0, found: 0 }); }}
        >
          <Text style={[s.modeBtnText, mode === "break" && s.modeBtnTextActive]}>Breakdown</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Controls sticky bar */}
        <View style={s.controls}>
          {/* Dow trend direction toggle */}
          {mode === "dow" && (
            <View style={s.row}>
              <Chip label={`↑ Uptrend (${dowRows.filter(r => r.dow.isUptrend).length})`}
                active={trendDir === "up"} color={C.up} onPress={() => setTrendDir("up")} />
              <Chip label={`↓ Downtrend (${dowRows.filter(r => r.dow.isDowntrend).length})`}
                active={trendDir === "down"} color={C.down} onPress={() => setTrendDir("down")} />
            </View>
          )}

          {/* Breakdown pattern filter */}
          {mode === "break" && (
            <View style={s.row}>
              {(["all", "breakdown", "watch", "uptrend"] as BreakFilter[]).map((f) => {
                const label = f === "all" ? `All (${breakRows.length})`
                  : f === "breakdown" ? `Breakdown (${breakRows.filter(r => r.pat.pattern === "breakdown").length})`
                  : f === "watch" ? `Watch (${breakRows.filter(r => r.pat.pattern === "watch").length})`
                  : `Uptrend (${breakRows.filter(r => r.pat.pattern === "uptrend").length})`;
                const color = f === "breakdown" ? C.down : f === "watch" ? C.warn : f === "uptrend" ? C.up : C.blue;
                return (
                  <Chip key={f} label={label} active={breakFilter === f} color={color}
                    onPress={() => setBreakFilter(f)} />
                );
              })}
            </View>
          )}

          {/* Scan button */}
          <View style={s.px}>
            {scanning ? (
              <TouchableOpacity style={s.stopBtn} onPress={() => { cancelRef.current = true; }}>
                <Text style={s.stopBtnText}>Stop ✕</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.scanBtn} onPress={runScan}>
                <Text style={s.scanBtnText}>Scan All F&O ↗</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Progress */}
          {progress.total > 0 && (
            <View style={s.px}>
              <View style={s.progressBg}>
                <View style={[s.progressFill, { width: `${pct}%` as any }]} />
              </View>
              <View style={s.progressRow}>
                <Text style={s.progressText}>
                  {scanning ? `Scanning ${progress.done}/${progress.total}` : `Scanned ${progress.done}/${progress.total}`}
                </Text>
                <Text style={s.foundText}>{progress.found} found</Text>
              </View>
            </View>
          )}

          {/* Sort chips */}
          {displayData.length > 0 && (
            <View style={[s.row, { marginTop: 4 }]}>
              <Text style={s.sortLabel}>Sort:</Text>
              {([
                ["score", "Score"],
                ["count1", mode === "dow" ? (trendDir === "down" ? "LH" : "HH") : "HH cnt"],
                ["count2", mode === "dow" ? (trendDir === "down" ? "LL" : "HL") : "HL cnt"],
                ["chg", "% Chg"],
              ] as [SortKey, string][]).map(([key, label]) => (
                <Chip key={key} label={label} active={sort === key} color={C.blue}
                  onPress={() => setSort(key)} />
              ))}
            </View>
          )}
        </View>

        {/* Results */}
        <View style={s.list}>
          {displayData.length === 0 && !scanning && (
            <View style={s.empty}>
              <Text style={s.emptyText}>
                {progress.done > 0
                  ? "No results found for current filter."
                  : "Tap Scan to find trending stocks"}
              </Text>
            </View>
          )}

          {mode === "dow"
            ? filteredDow.map((r) => <DowCard key={r.symbol} row={r} dir={trendDir} />)
            : filteredBreak.map((r) => <BreakCard key={r.symbol} row={r} />)
          }
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  header:  { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  title:   { color: C.text, fontSize: 20, fontWeight: "700" },
  subtitle:{ color: C.text2, fontSize: 12, marginTop: 2 },

  modeRow: { flexDirection: "row", marginHorizontal: 16, marginBottom: 4, backgroundColor: "#f1f5f9", borderRadius: 12, padding: 3 },
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10 },
  modeBtnActive: { backgroundColor: C.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  modeBtnText: { color: C.text2, fontWeight: "600", fontSize: 13 },
  modeBtnTextActive: { color: C.blue, fontWeight: "700" },

  controls: { backgroundColor: C.bg, paddingBottom: 8 },
  row:      { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 8, flexWrap: "wrap" },
  px:       { paddingHorizontal: 16, marginBottom: 8 },
  sortLabel:{ color: C.text3, fontSize: 11, alignSelf: "center", marginRight: 2 },

  scanBtn:     { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  stopBtn:     { backgroundColor: "#fee2e2", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  stopBtnText: { color: C.down, fontWeight: "700", fontSize: 14 },

  progressBg:   { height: 3, backgroundColor: C.progressBg, borderRadius: 2, marginBottom: 4 },
  progressFill: { height: "100%", backgroundColor: C.blue, borderRadius: 2 },
  progressRow:  { flexDirection: "row", justifyContent: "space-between" },
  progressText: { color: C.text2, fontSize: 11 },
  foundText:    { color: C.up, fontSize: 11, fontWeight: "600" },

  list:      { paddingHorizontal: 12, paddingBottom: 20 },
  empty:     { paddingTop: 80, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { color: C.text3, fontSize: 13, textAlign: "center", lineHeight: 20 },
});
