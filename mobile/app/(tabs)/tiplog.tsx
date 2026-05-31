import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { loadTipLog, updateTipLogPrices, TipLogEntry } from "../../lib/tipLog";
import { fetchPrices } from "../../lib/api";

type Filter = "all" | "active" | "success" | "failed";

const STATUS_COLOR: Record<TipLogEntry["status"], string> = {
  active:  "#60a5fa",
  success: "#4ade80",
  failed:  "#f87171",
  expired: "#6b7280",
};

const STATUS_LABEL: Record<TipLogEntry["status"], string> = {
  active:  "Active",
  success: "✓ Success",
  failed:  "✗ Failed",
  expired: "Expired",
};

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toFixed(0);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "Just now";
}

// ── Log Entry Card ────────────────────────────────────────────────────────────
function LogCard({ entry: e }: { entry: TipLogEntry }) {
  const isShort = e.direction === "short";
  const statusColor = STATUS_COLOR[e.status];
  const dirColor = isShort ? "#f87171" : "#4ade80";
  const pnl = e.currentPnlPct;
  const pnlColor = pnl == null ? "#6b7280" : pnl >= 0 ? "#4ade80" : "#f87171";

  return (
    <View style={[cardStyles.card, { borderLeftColor: statusColor }]}>
      {/* Row 1: symbol + status + price */}
      <View style={cardStyles.row}>
        <View style={cardStyles.left}>
          <Text style={cardStyles.symbol}>{e.symbol}</Text>
          <View style={[cardStyles.dirTag, { backgroundColor: isShort ? "#450a0a" : "#14532d" }]}>
            <Text style={[cardStyles.dirTagText, { color: dirColor }]}>{isShort ? "SHORT" : "LONG"}</Text>
          </View>
          <View style={[cardStyles.sigTag, { backgroundColor: statusColor + "22" }]}>
            <Text style={[cardStyles.sigTagText, { color: statusColor }]}>{STATUS_LABEL[e.status]}</Text>
          </View>
          <View style={[cardStyles.confTag, { opacity: e.confidence === "high" ? 1 : 0.6 }]}>
            <Text style={cardStyles.confText}>{e.confidence}</Text>
          </View>
        </View>
        <View style={cardStyles.right}>
          {e.lastPrice != null && (
            <Text style={cardStyles.price}>₹{e.lastPrice.toFixed(2)}</Text>
          )}
          {pnl != null && (
            <Text style={[cardStyles.pnl, { color: pnlColor }]}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
            </Text>
          )}
        </View>
      </View>

      {/* Row 2: levels */}
      <View style={cardStyles.levelsRow}>
        {([
          ["Entry",  e.entry,    "#60a5fa"],
          ["Target", e.target,   isShort ? "#f87171" : "#4ade80"],
          ["Stop",   e.stopLoss, "#f87171"],
          ["R:R",    null,       "#a3a3a3"],
        ] as [string, number | null, string][]).map(([label, val, color]) => (
          <View key={label} style={cardStyles.levelCol}>
            <Text style={cardStyles.levelLabel}>{label}</Text>
            <Text style={[cardStyles.levelValue, { color }]}>
              {val != null ? `₹${fmt(val)}` : `1:${e.riskReward.toFixed(1)}`}
            </Text>
          </View>
        ))}
      </View>

      {/* Row 3: exit info OR signal/zone info */}
      <View style={cardStyles.footer}>
        <Text style={cardStyles.footerGray}>{timeAgo(e.loggedAt)} · {e.signal}</Text>
        {e.status !== "active" && e.exitPrice != null ? (
          <Text style={[cardStyles.footerGray, { color: statusColor }]}>
            Exit ₹{e.exitPrice.toFixed(2)}
          </Text>
        ) : (
          <Text style={cardStyles.footerGray}>
            Zone ₹{fmt(e.zone.bottom)}–{fmt(e.zone.top)}
          </Text>
        )}
      </View>

      {/* Max favorable / adverse bar for active */}
      {e.status === "active" && e.lastPrice != null && (
        <View style={cardStyles.barWrap}>
          {e.maxFavorablePct > 0 && (
            <Text style={[cardStyles.barLabel, { color: "#4ade80" }]}>
              ↑ {e.maxFavorablePct.toFixed(1)}%
            </Text>
          )}
          {e.maxAdversePct > 0 && (
            <Text style={[cardStyles.barLabel, { color: "#f87171" }]}>
              ↓ {e.maxAdversePct.toFixed(1)}%
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── Stat Box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={statStyles.box}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function TipLogTab() {
  const [entries,    setEntries]    = useState<TipLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [lastSync,   setLastSync]   = useState<Date | null>(null);

  const loadAndSync = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const current = await loadTipLog();
      setEntries(current);

      const activeSyms = [...new Set(
        current.filter((e) => e.status === "active").map((e) => e.symbol)
      )];
      if (activeSyms.length > 0) {
        const prices = await fetchPrices(activeSyms);
        if (Object.keys(prices).length > 0) {
          const updated = await updateTipLogPrices(prices);
          setEntries(updated);
          setLastSync(new Date());
        }
      }
    } catch { /* silent */ } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAndSync(true);
      const id = setInterval(() => loadAndSync(true), 30_000);
      return () => clearInterval(id);
    }, [loadAndSync])
  );

  const filtered = entries.filter((e) => {
    if (filter === "all") return true;
    return e.status === filter;
  });

  // Stats
  const total   = entries.length;
  const active  = entries.filter((e) => e.status === "active").length;
  const success = entries.filter((e) => e.status === "success").length;
  const failed  = entries.filter((e) => e.status === "failed").length;
  const closed  = success + failed;
  const winRate = closed > 0 ? Math.round((success / closed) * 100) : null;

  const avgRR = entries.length > 0
    ? (entries.reduce((s, e) => s + e.riskReward, 0) / entries.length).toFixed(1)
    : null;

  const filterTabs: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all",     label: "All",       count: total,   color: "#94a3b8" },
    { key: "active",  label: "Active",    count: active,  color: "#60a5fa" },
    { key: "success", label: "✓ Success", count: success, color: "#4ade80" },
    { key: "failed",  label: "✗ Failed",  count: failed,  color: "#f87171" },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Tip Performance</Text>
          <Text style={styles.subtitle}>All auto-logged tips · latest first</Text>
        </View>
        {lastSync && (
          <Text style={styles.syncLabel}>
            {lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        )}
      </View>

      {/* Stats */}
      {total > 0 && (
        <View style={styles.statsRow}>
          <StatBox label="Total"   value={String(total)}   color="#94a3b8" />
          <StatBox label="Active"  value={String(active)}  color="#60a5fa" />
          <StatBox label="Success" value={String(success)} color="#4ade80" />
          <StatBox label="Failed"  value={String(failed)}  color="#f87171" />
          <StatBox label="Win %"   value={winRate != null ? `${winRate}%` : "–"}
            color={winRate != null && winRate >= 50 ? "#4ade80" : "#f87171"} />
        </View>
      )}

      {/* Overall performance row */}
      {closed > 0 && (
        <View style={styles.perfRow}>
          <View style={[styles.perfBadge, { backgroundColor: "#14532d" }]}>
            <Text style={[styles.perfText, { color: "#4ade80" }]}>
              ✓ {success} success
            </Text>
          </View>
          <View style={[styles.perfBadge, { backgroundColor: "#450a0a" }]}>
            <Text style={[styles.perfText, { color: "#f87171" }]}>
              ✗ {failed} failed
            </Text>
          </View>
          {avgRR && (
            <View style={[styles.perfBadge, { backgroundColor: "#1e293b" }]}>
              <Text style={[styles.perfText, { color: "#94a3b8" }]}>
                Avg R:R 1:{avgRR}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {filterTabs.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && { borderColor: f.color, backgroundColor: f.color + "22" }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, { color: filter === f.key ? f.color : "#6b7280" }]}>
              {f.label} ({f.count})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAndSync(false)}
            tintColor="#3b82f6"
          />
        }
        renderItem={({ item }) => <LogCard entry={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {total === 0 ? "No tips logged yet" : `No ${filter} tips`}
            </Text>
            <Text style={styles.emptyHint}>
              {total === 0
                ? "Run a scan from the Screener tab — all found tips will be automatically logged here."
                : "Try the All filter."}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#111827", borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#1f2937", borderLeftWidth: 4,
  },
  row:          { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  left:         { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  right:        { alignItems: "flex-end" },
  symbol:       { color: "#f1f5f9", fontFamily: "monospace", fontWeight: "700", fontSize: 15 },
  dirTag:       { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  dirTagText:   { fontSize: 9, fontWeight: "700" },
  sigTag:       { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  sigTagText:   { fontSize: 10, fontWeight: "700" },
  confTag:      { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: "#1f2937" },
  confText:     { color: "#94a3b8", fontSize: 9 },
  price:        { color: "#f1f5f9", fontFamily: "monospace", fontWeight: "600", fontSize: 13 },
  pnl:          { fontFamily: "monospace", fontSize: 11, marginTop: 1 },
  levelsRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  levelCol:     { alignItems: "center", flex: 1 },
  levelLabel:   { color: "#6b7280", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4 },
  levelValue:   { fontFamily: "monospace", fontSize: 12, fontWeight: "700", marginTop: 2 },
  footer:       { flexDirection: "row", justifyContent: "space-between" },
  footerGray:   { color: "#4b5563", fontSize: 10 },
  barWrap:      { flexDirection: "row", gap: 12, marginTop: 6 },
  barLabel:     { fontSize: 10, fontFamily: "monospace" },
});

const statStyles = StyleSheet.create({
  box:   { flex: 1, alignItems: "center" },
  value: { fontSize: 17, fontWeight: "700", fontFamily: "monospace" },
  label: { color: "#6b7280", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#0f172a" },
  header:    { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title:     { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
  subtitle:  { color: "#64748b", fontSize: 12, marginTop: 2 },
  syncLabel: { color: "#374151", fontSize: 10, marginTop: 6 },

  statsRow: {
    flexDirection: "row", marginHorizontal: 16, marginBottom: 10,
    backgroundColor: "#111827", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#1f2937",
  },

  perfRow:   { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 8, flexWrap: "wrap" },
  perfBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  perfText:  { fontSize: 11, fontWeight: "700" },

  filterRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 10, flexWrap: "wrap" },
  chip:      { borderWidth: 1, borderColor: "#334155", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipText:  { fontSize: 11, fontWeight: "600" },

  list:       { paddingHorizontal: 12, paddingBottom: 20 },
  empty:      { paddingTop: 80, alignItems: "center", paddingHorizontal: 32 },
  emptyTitle: { color: "#4b5563", fontSize: 18, fontWeight: "700", marginBottom: 10 },
  emptyHint:  { color: "#374151", fontSize: 13, textAlign: "center", lineHeight: 20 },
});
