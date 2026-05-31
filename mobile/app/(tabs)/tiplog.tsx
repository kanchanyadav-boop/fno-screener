import React, { useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { loadTipLog, updateTipLogPrices, TipLogEntry } from "../../lib/tipLog";
import { fetchPrices } from "../../lib/api";

type Filter = "all" | "active" | "success" | "failed";

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", text2: "#64748b", text3: "#94a3b8",
  long: "#16a34a", short: "#dc2626", near: "#d97706", blue: "#2563eb",
  longBg: "#dcfce7", shortBg: "#fee2e2", nearBg: "#fef3c7", blueBg: "#dbeafe",
};

const STATUS_COLOR: Record<TipLogEntry["status"], string> = {
  active:  C.blue,
  success: C.long,
  failed:  C.short,
  expired: C.text3,
};

const STATUS_LABEL: Record<TipLogEntry["status"], string> = {
  active:  "Active",
  success: "✓ Success",
  failed:  "✗ Failed",
  expired: "Expired",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })
    + "  " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function LogCard({ entry: e }: { entry: TipLogEntry }) {
  const isShort = e.direction === "short";
  const statusColor = STATUS_COLOR[e.status];
  const dirColor = isShort ? C.short : C.long;
  const dirBg = isShort ? C.shortBg : C.longBg;
  const pnl = e.currentPnlPct;
  const pnlColor = pnl == null ? C.text3 : pnl >= 0 ? C.long : C.short;

  return (
    <View style={[cs.card, { borderLeftColor: statusColor }]}>
      <View style={cs.row}>
        <View style={cs.left}>
          <Text style={cs.symbol}>{e.symbol}</Text>
          <View style={[cs.dirTag, { backgroundColor: dirBg }]}>
            <Text style={[cs.dirTagText, { color: dirColor }]}>{isShort ? "SHORT" : "LONG"}</Text>
          </View>
          <View style={[cs.sigTag, { backgroundColor: statusColor + "18" }]}>
            <Text style={[cs.sigTagText, { color: statusColor }]}>{STATUS_LABEL[e.status]}</Text>
          </View>
          <View style={[cs.confTag, { opacity: e.confidence === "high" ? 1 : 0.6 }]}>
            <Text style={cs.confText}>{e.confidence}</Text>
          </View>
        </View>
        <View style={cs.right}>
          <Text style={[cs.price, e.lastPrice == null && { color: C.text3 }]}>
            {e.lastPrice != null ? `₹${e.lastPrice.toFixed(2)}` : (e.status === "active" ? "fetching…" : "–")}
          </Text>
          {pnl != null && (
            <Text style={[cs.pnl, { color: pnlColor }]}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
            </Text>
          )}
        </View>
      </View>

      <View style={cs.levelsRow}>
        {([
          ["Entry",  e.entry,    C.blue],
          ["Target", e.target,   isShort ? C.short : C.long],
          ["Stop",   e.stopLoss, C.short],
          ["R:R",    null,       C.text3],
        ] as [string, number | null, string][]).map(([label, val, color]) => (
          <View key={label} style={cs.levelCol}>
            <Text style={cs.levelLabel}>{label}</Text>
            <Text style={[cs.levelValue, { color }]}>
              {val != null ? `₹${val.toFixed(2)}` : `1:${e.riskReward.toFixed(1)}`}
            </Text>
          </View>
        ))}
      </View>

      <View style={cs.footer}>
        <Text style={cs.footerGray}>{formatDate(e.loggedAt)} · {e.signal}</Text>
        {e.status !== "active" && e.exitPrice != null ? (
          <Text style={[cs.footerGray, { color: statusColor }]}>
            Exit ₹{e.exitPrice.toFixed(2)}
          </Text>
        ) : (
          <Text style={cs.footerGray}>
            Zone ₹{e.zone.bottom.toFixed(2)}–{e.zone.top.toFixed(2)}
          </Text>
        )}
      </View>

      {e.status === "active" && e.lastPrice != null && (
        <View style={cs.barWrap}>
          {e.maxFavorablePct > 0 && (
            <Text style={[cs.barLabel, { color: C.long }]}>↑ {e.maxFavorablePct.toFixed(1)}%</Text>
          )}
          {e.maxAdversePct > 0 && (
            <Text style={[cs.barLabel, { color: C.short }]}>↓ {e.maxAdversePct.toFixed(1)}%</Text>
          )}
        </View>
      )}
    </View>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={ss.box}>
      <Text style={[ss.value, { color }]}>{value}</Text>
      <Text style={ss.label}>{label}</Text>
    </View>
  );
}

export default function TipLogTab() {
  const [entries,    setEntries]    = useState<TipLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [lastSync,   setLastSync]   = useState<Date | null>(null);
  const entriesRef = useRef<TipLogEntry[]>([]);

  // Full load from storage — on focus and pull-to-refresh
  const loadFromStorage = useCallback(async () => {
    try {
      const data = await loadTipLog();
      entriesRef.current = data;
      setEntries(data);
    } catch { /* silent */ }
  }, []);

  // In-memory price tick — no AsyncStorage read, just fetch + update state directly
  const tickPrices = useCallback(async () => {
    const current = entriesRef.current;
    const activeSyms = [...new Set(
      current.filter((e) => e.status === "active").map((e) => e.symbol)
    )];
    if (!activeSyms.length) return;

    try {
      const prices = await fetchPrices(activeSyms);
      if (!Object.keys(prices).length) return;

      // updateTipLogPrices persists to storage and returns full updated list
      const updated = await updateTipLogPrices(prices);
      entriesRef.current = updated;
      setEntries(updated);
      setLastSync(new Date());
    } catch { /* silent */ }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFromStorage();
    await tickPrices();
    setRefreshing(false);
  }, [loadFromStorage, tickPrices]);

  useFocusEffect(
    useCallback(() => {
      loadFromStorage().then(tickPrices);
      const id = setInterval(tickPrices, 5_000);
      return () => clearInterval(id);
    }, [loadFromStorage, tickPrices])
  );

  const filtered = entries.filter((e) => filter === "all" || e.status === filter);

  const total   = entries.length;
  const active  = entries.filter((e) => e.status === "active").length;
  const success = entries.filter((e) => e.status === "success").length;
  const failed  = entries.filter((e) => e.status === "failed").length;
  const closed  = success + failed;
  const winRate = closed > 0 ? Math.round((success / closed) * 100) : null;
  const avgRR   = entries.length > 0
    ? (entries.reduce((s, e) => s + e.riskReward, 0) / entries.length).toFixed(1)
    : null;

  const filterTabs: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all",     label: "All",       count: total,   color: C.text3 },
    { key: "active",  label: "Active",    count: active,  color: C.blue },
    { key: "success", label: "✓ Success", count: success, color: C.long },
    { key: "failed",  label: "✗ Failed",  count: failed,  color: C.short },
  ];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Tip Performance</Text>
          <Text style={s.subtitle}>All auto-logged tips · latest first</Text>
        </View>
        {active > 0 && (
          <View style={s.liveRow}>
            <View style={s.liveDot} />
            <Text style={s.syncLabel}>
              {lastSync
                ? lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "syncing…"}
            </Text>
          </View>
        )}
      </View>

      {total > 0 && (
        <View style={s.statsRow}>
          <StatBox label="Total"   value={String(total)}   color={C.text2} />
          <StatBox label="Active"  value={String(active)}  color={C.blue} />
          <StatBox label="Success" value={String(success)} color={C.long} />
          <StatBox label="Failed"  value={String(failed)}  color={C.short} />
          <StatBox label="Win %"   value={winRate != null ? `${winRate}%` : "–"}
            color={winRate != null && winRate >= 50 ? C.long : C.short} />
        </View>
      )}

      {closed > 0 && (
        <View style={s.perfRow}>
          <View style={[s.perfBadge, { backgroundColor: "#dcfce7" }]}>
            <Text style={[s.perfText, { color: "#166534" }]}>✓ {success} success</Text>
          </View>
          <View style={[s.perfBadge, { backgroundColor: "#fee2e2" }]}>
            <Text style={[s.perfText, { color: "#991b1b" }]}>✗ {failed} failed</Text>
          </View>
          {avgRR && (
            <View style={[s.perfBadge, { backgroundColor: "#f1f5f9" }]}>
              <Text style={[s.perfText, { color: C.text2 }]}>Avg R:R 1:{avgRR}</Text>
            </View>
          )}
        </View>
      )}

      <View style={s.filterRow}>
        {filterTabs.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[s.chip, filter === f.key && { borderColor: f.color, backgroundColor: f.color + "18" }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[s.chipText, { color: filter === f.key ? f.color : C.text2 }]}>
              {f.label} ({f.count})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(e) => e.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.blue} />
        }
        renderItem={({ item }) => <LogCard entry={item} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>
              {total === 0 ? "No tips logged yet" : `No ${filter} tips`}
            </Text>
            <Text style={s.emptyHint}>
              {total === 0
                ? "Run a scan from the Zone Tips tab — all found tips will be automatically logged here."
                : "Try the All filter."}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const cs = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  row:        { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  left:       { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  right:      { alignItems: "flex-end" },
  symbol:     { color: C.text, fontFamily: "monospace", fontWeight: "700", fontSize: 15 },
  dirTag:     { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  dirTagText: { fontSize: 9, fontWeight: "700" },
  sigTag:     { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  sigTagText: { fontSize: 10, fontWeight: "700" },
  confTag:    { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: "#f1f5f9" },
  confText:   { color: C.text2, fontSize: 9 },
  price:      { color: C.text, fontFamily: "monospace", fontWeight: "600", fontSize: 13 },
  pnl:        { fontFamily: "monospace", fontSize: 11, marginTop: 1 },
  levelsRow:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  levelCol:   { alignItems: "center", flex: 1 },
  levelLabel: { color: C.text3, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4 },
  levelValue: { fontFamily: "monospace", fontSize: 12, fontWeight: "700", marginTop: 2 },
  footer:     { flexDirection: "row", justifyContent: "space-between" },
  footerGray: { color: C.text3, fontSize: 10 },
  barWrap:    { flexDirection: "row", gap: 12, marginTop: 6 },
  barLabel:   { fontSize: 10, fontFamily: "monospace" },
});

const ss = StyleSheet.create({
  box:   { flex: 1, alignItems: "center" },
  value: { fontSize: 17, fontWeight: "700", fontFamily: "monospace" },
  label: { color: C.text3, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },
});

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  header:    { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title:     { color: C.text, fontSize: 20, fontWeight: "700" },
  subtitle:  { color: C.text2, fontSize: 12, marginTop: 2 },
  syncLabel: { color: C.text3, fontSize: 10 },
  liveRow:   { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  liveDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.long },

  statsRow: {
    flexDirection: "row", marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },

  perfRow:   { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 8, flexWrap: "wrap" },
  perfBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  perfText:  { fontSize: 11, fontWeight: "700" },

  filterRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 10, flexWrap: "wrap" },
  chip:      { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipText:  { fontSize: 11, fontWeight: "600" },

  list:       { paddingHorizontal: 12, paddingBottom: 20 },
  empty:      { paddingTop: 80, alignItems: "center", paddingHorizontal: 32 },
  emptyTitle: { color: C.text2, fontSize: 18, fontWeight: "700", marginBottom: 10 },
  emptyHint:  { color: C.text3, fontSize: 13, textAlign: "center", lineHeight: 20 },
});
