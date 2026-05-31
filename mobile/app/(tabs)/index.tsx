import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { FNO_STOCKS } from "../../lib/fnoStocks";
import { generateTradeTip } from "../../lib/tradeTip";
import { fetchCandles } from "../../lib/api";
import { TradeTip } from "../../lib/types";
import { logTips } from "../../lib/tipLog";

interface Row { symbol: string; price: number; changePct: number; tip: TradeTip }
type FilterKey = "ALL" | "BUY" | "NEAR" | "WATCH";

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", text2: "#64748b", text3: "#94a3b8",
  long: "#16a34a", short: "#dc2626", near: "#d97706", blue: "#2563eb",
  longBg: "#dcfce7", shortBg: "#fee2e2", nearBg: "#fef3c7", blueBg: "#dbeafe",
};

const SIGNAL_COLOR: Record<string, string> = {
  BUY: C.long, NEAR: C.near, WATCH: C.blue,
};
const DIR_COLOR = { long: C.long, short: C.short };

function TipCard({ row: r }: { row: Row }) {
  const tip = r.tip;
  const sigColor = SIGNAL_COLOR[tip.signal] ?? C.text3;
  const dirColor = DIR_COLOR[tip.direction];
  const chgColor = r.changePct >= 0 ? C.long : C.short;
  const isShort = tip.direction === "short";
  const distLabel = tip.bouncingFromZone
    ? (isShort ? "Rejecting zone" : "Bouncing zone")
    : tip.distToZonePct < 0
      ? `${Math.abs(tip.distToZonePct).toFixed(1)}% inside`
      : `${tip.distToZonePct.toFixed(1)}% ${isShort ? "below" : "above"}`;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => router.push({ pathname: "/(tabs)/search", params: { symbol: r.symbol } } as any)}
    >
      <View style={[styles.card, { borderLeftColor: sigColor }]}>
        <View style={styles.cardRow}>
          <View style={styles.cardLeft}>
            <Text style={styles.cardSymbol}>{r.symbol}</Text>
            <View style={[styles.dirTag, { backgroundColor: isShort ? C.shortBg : C.longBg }]}>
              <Text style={[styles.dirTagText, { color: dirColor }]}>{isShort ? "SHORT" : "LONG"}</Text>
            </View>
            <View style={[styles.sigTag, { backgroundColor: sigColor + "18" }]}>
              <Text style={[styles.sigTagText, { color: sigColor }]}>
                {tip.signal === "BUY" ? (isShort ? "SELL" : "BUY") : tip.signal}
              </Text>
            </View>
            <View style={[styles.confTag, { opacity: tip.confidence === "high" ? 1 : 0.6 }]}>
              <Text style={styles.confText}>{tip.confidence}</Text>
            </View>
          </View>
          <View>
            <Text style={styles.price}>₹{r.price.toFixed(2)}</Text>
            <Text style={[styles.chg, { color: chgColor }]}>
              {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
            </Text>
          </View>
        </View>

        <View style={styles.levelsRow}>
          {(["Entry", "Target", "Stop"] as const).map((label) => {
            const val = label === "Entry" ? tip.entry : label === "Target" ? tip.target : tip.stopLoss;
            const col = label === "Entry" ? C.blue : label === "Target" ? (isShort ? C.short : C.long) : C.short;
            return (
              <View key={label} style={styles.levelCol}>
                <Text style={styles.levelLabel}>{label}</Text>
                <Text style={[styles.levelValue, { color: col }]}>₹{val.toFixed(2)}</Text>
              </View>
            );
          })}
          <View style={styles.levelCol}>
            <Text style={styles.levelLabel}>R:R</Text>
            <Text style={[styles.levelValue, { color: C.text3 }]}>1:{tip.riskReward.toFixed(1)}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.footerGray}>{distLabel}</Text>
          <Text style={styles.footerGray}>
            Zone ₹{tip.zone.bottom.toFixed(2)}–{tip.zone.top.toFixed(2)}
          </Text>
        </View>
        <Text style={styles.tapHint}>Tap to open chart →</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ScreenerTab() {
  const [rows,     setRows]     = useState<Row[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, found: 0 });
  const [filter,   setFilter]   = useState<FilterKey>("ALL");
  const cancelRef = useRef(false);

  const runScan = useCallback(async () => {
    cancelRef.current = false;
    setScanning(true);
    setRows([]);
    setProgress({ done: 0, total: FNO_STOCKS.length, found: 0 });

    const collected: Row[] = [];

    for (const sym of FNO_STOCKS) {
      if (cancelRef.current) break;
      try {
        const data = await fetchCandles(sym);
        if (data.candles.length >= 15) {
          const tip = generateTradeTip(data.candles);
          if (tip) {
            const row: Row = { symbol: sym, price: data.price, changePct: data.changePct, tip };
            collected.push(row);
            setRows((prev) => [...prev, row]);
            setProgress((p) => ({ ...p, done: p.done + 1, found: p.found + 1 }));
            await delay(150);
            continue;
          }
        }
      } catch { /* silent */ }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      await delay(150);
    }

    setScanning(false);
    const atZone = collected.filter((r) => r.tip.signal === "BUY");
    if (atZone.length > 0) {
      logTips(atZone.map((r) => ({ symbol: r.symbol, tip: r.tip }))).catch(() => {});
    }
  }, []);

  const filtered = filter === "ALL" ? rows : rows.filter((r) => r.tip.signal === filter);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const countFor = (f: FilterKey) =>
    f === "ALL" ? rows.length : rows.filter((r) => r.tip.signal === f).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>F&O Trade Tips</Text>
        <Text style={styles.subtitle}>Demand & supply zone setups · Daily chart</Text>
      </View>

      <View style={styles.px}>
        {scanning ? (
          <TouchableOpacity style={styles.stopBtn} onPress={() => { cancelRef.current = true; }}>
            <Text style={styles.stopBtnText}>Stop ✕</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.scanBtn} onPress={runScan}>
            <Text style={styles.scanBtnText}>Scan All F&O ↗</Text>
          </TouchableOpacity>
        )}
      </View>

      {progress.total > 0 && (
        <View style={styles.px}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {scanning ? `Scanning ${progress.done}/${progress.total}` : `Scanned ${progress.done}/${progress.total}`}
            </Text>
            <Text style={styles.foundText}>{progress.found} setups</Text>
          </View>
        </View>
      )}

      {rows.length > 0 && (
        <View style={styles.filterRow}>
          {(["ALL", "BUY", "NEAR", "WATCH"] as FilterKey[]).map((f) => {
            const color = f === "ALL" ? C.blue : f === "BUY" ? C.long : f === "NEAR" ? C.near : C.blue;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, filter === f && { borderColor: color, backgroundColor: color + "18" }]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterText, { color: filter === f ? color : C.text2 }]}>
                  {f} ({countFor(f)})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.symbol}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} tintColor={C.blue} />}
        renderItem={({ item }) => <TipCard row={item} />}
        ListEmptyComponent={
          !scanning ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {progress.done > 0
                  ? "No zone setups found. Try again when market pulls back."
                  : "Tap Scan to find demand & supply zone setups"}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: C.bg },
  header:   { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  title:    { color: C.text, fontSize: 20, fontWeight: "700" },
  subtitle: { color: C.text2, fontSize: 12, marginTop: 2 },
  px:       { paddingHorizontal: 16, marginBottom: 10 },

  scanBtn:     { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  stopBtn:     { backgroundColor: C.shortBg, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  stopBtnText: { color: C.short, fontWeight: "700", fontSize: 14 },

  progressBg:   { height: 3, backgroundColor: "#e2e8f0", borderRadius: 2, marginBottom: 4 },
  progressFill: { height: "100%", backgroundColor: C.blue, borderRadius: 2 },
  progressRow:  { flexDirection: "row", justifyContent: "space-between" },
  progressText: { color: C.text2, fontSize: 11 },
  foundText:    { color: C.long, fontSize: 11, fontWeight: "600" },

  filterRow:  { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 10, flexWrap: "wrap" },
  filterChip: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  filterText: { fontSize: 11, fontWeight: "600" },

  list: { paddingHorizontal: 12, paddingBottom: 20 },

  card: {
    backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  cardLeft:   { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  cardSymbol: { color: C.text, fontFamily: "monospace", fontWeight: "700", fontSize: 15 },
  dirTag:     { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  dirTagText: { fontSize: 9, fontWeight: "700" },
  sigTag:     { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  sigTagText: { fontSize: 11, fontWeight: "700" },
  confTag:    { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: "#f1f5f9" },
  confText:   { color: C.text2, fontSize: 9 },
  price:      { color: C.text, fontFamily: "monospace", fontWeight: "600", fontSize: 13, textAlign: "right" },
  chg:        { fontFamily: "monospace", fontSize: 11, textAlign: "right", marginTop: 1 },
  levelsRow:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  levelCol:   { alignItems: "center", flex: 1 },
  levelLabel: { color: C.text3, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4 },
  levelValue: { fontFamily: "monospace", fontSize: 12, fontWeight: "700", marginTop: 2 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between" },
  footerGray: { color: C.text3, fontSize: 10 },
  tapHint:    { color: C.blue, fontSize: 9, textAlign: "right", marginTop: 6 },

  empty:     { paddingTop: 80, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { color: C.text3, fontSize: 13, textAlign: "center", lineHeight: 20 },
});
