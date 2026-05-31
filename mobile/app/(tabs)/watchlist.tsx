import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { loadSetups, updateSetupPrices, getAlertedIds, markAlerted, clearAlert } from "../../lib/storage";
import { fetchPrices } from "../../lib/api";
import { sendEntryAlert, sendTargetAlert, sendSLAlert } from "../../lib/notifications";
import { SetupCard } from "../../components/SetupCard";
import { SavedSetup } from "../../lib/types";

type Filter = "all" | "active" | "target_hit" | "sl_hit";

export default function WatchlistTab() {
  const [setups,     setSetups]     = useState<SavedSetup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [lastSync,   setLastSync]   = useState<Date | null>(null);

  const loadAndSync = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      // Load from storage
      const current = await loadSetups();
      setSetups(current);

      // Fetch live prices for active setups only
      const activeSetups = current.filter((s) => s.status === "active");
      const activeSyms = [...new Set(activeSetups.map((s) => s.symbol))];
      if (activeSyms.length > 0) {
        const prices = await fetchPrices(activeSyms);
        if (Object.keys(prices).length > 0) {
          // ── Entry zone alerts ──────────────────────────────────────────────
          const alerted = await getAlertedIds();
          for (const setup of activeSetups) {
            const pd = prices[setup.symbol];
            if (!pd?.price) continue;
            const distPct = Math.abs((pd.price - setup.entryPrice) / setup.entryPrice * 100);
            if (distPct <= 2 && !alerted.has(setup.id)) {
              await sendEntryAlert(setup.symbol, setup.direction, setup.entryPrice, pd.price);
              await markAlerted(setup.id);
            } else if (distPct > 5) {
              await clearAlert(setup.id); // allow re-alert next time price returns
            }
          }

          // ── Update storage (detects target/SL hits) ───────────────────────
          const updated = await updateSetupPrices(prices);

          // ── Target / SL notifications ─────────────────────────────────────
          for (const prev of activeSetups) {
            const next = updated.find((s) => s.id === prev.id);
            if (!next || !next.exitPrice) continue;
            if (next.status === "target_hit") {
              await sendTargetAlert(next.symbol, next.direction, next.exitPrice);
            } else if (next.status === "sl_hit") {
              await sendSLAlert(next.symbol, next.direction, next.exitPrice);
            }
          }

          setSetups(updated);
          setLastSync(new Date());
        }
      }
    } catch { /* silent */ } finally {
      setRefreshing(false);
    }
  }, []);

  // Refresh when tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadAndSync(true);
      const id = setInterval(() => loadAndSync(true), 30_000);
      return () => clearInterval(id);
    }, [loadAndSync])
  );

  const filtered = setups.filter((s) => {
    if (filter === "all") return true;
    if (filter === "active") return s.status === "active";
    if (filter === "target_hit") return s.status === "target_hit";
    if (filter === "sl_hit") return s.status === "sl_hit";
    return true;
  });

  // Stats
  const total       = setups.length;
  const active      = setups.filter((s) => s.status === "active").length;
  const passed      = setups.filter((s) => s.status === "target_hit").length;
  const failed      = setups.filter((s) => s.status === "sl_hit").length;
  const closed      = passed + failed;
  const winRate     = closed > 0 ? Math.round((passed / closed) * 100) : null;

  const filterTabs: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all",        label: "All",     count: total,  color: "#94a3b8" },
    { key: "active",     label: "Active",  count: active, color: "#60a5fa" },
    { key: "target_hit", label: "✓ Passed", count: passed, color: "#4ade80" },
    { key: "sl_hit",     label: "✗ Failed", count: failed, color: "#f87171" },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Watchlist</Text>
          <Text style={styles.subtitle}>Saved trade setups · performance tracking</Text>
        </View>
        {lastSync && (
          <Text style={styles.syncLabel}>
            {lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        )}
      </View>

      {/* Stats row */}
      {total > 0 && (
        <View style={styles.statsRow}>
          <StatBox label="Total"   value={String(total)}       color="#94a3b8" />
          <StatBox label="Active"  value={String(active)}      color="#60a5fa" />
          <StatBox label="Passed"  value={String(passed)}      color="#4ade80" />
          <StatBox label="Failed"  value={String(failed)}      color="#f87171" />
          <StatBox label="Win %"   value={winRate !== null ? `${winRate}%` : "–"} color={winRate !== null && winRate >= 50 ? "#4ade80" : "#f87171"} />
        </View>
      )}

      {/* Performance notice for new passes/fails */}
      {setups.filter((s) => s.status === "target_hit" || s.status === "sl_hit").length > 0 && (
        <View style={styles.noticeRow}>
          {passed > 0 && (
            <View style={styles.noticeBadge}>
              <Text style={styles.noticeText}>✓ {passed} target{passed > 1 ? "s" : ""} hit</Text>
            </View>
          )}
          {failed > 0 && (
            <View style={[styles.noticeBadge, styles.noticeBadgeFail]}>
              <Text style={[styles.noticeText, styles.noticeTextFail]}>✗ {failed} SL{failed > 1 ? "s" : ""} triggered</Text>
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
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAndSync(false)}
            tintColor="#3b82f6"
          />
        }
        renderItem={({ item }) => (
          <SetupCard
            setup={item}
            onDeleted={() => loadAndSync(true)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {total === 0 ? (
              <>
                <Text style={styles.emptyTitle}>No setups yet</Text>
                <Text style={styles.emptyHint}>
                  Go to{" "}
                  <Text style={{ color: "#3b82f6" }}>Add Setup</Text>
                  {" "}tab to search a stock, set your entry/SL/target and save it here.
                </Text>
              </>
            ) : (
              <Text style={styles.emptyHint}>No {filter} setups.</Text>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={statStyles.box}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  box:   { flex: 1, alignItems: "center" },
  value: { fontSize: 18, fontWeight: "700", fontFamily: "monospace" },
  label: { color: "#6b7280", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },
});

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#0f172a" },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title:  { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
  subtitle:{ color: "#64748b", fontSize: 12, marginTop: 2 },
  syncLabel:{ color: "#374151", fontSize: 10, marginTop: 6 },

  statsRow: {
    flexDirection: "row", marginHorizontal: 16, marginBottom: 10,
    backgroundColor: "#111827", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#1f2937",
  },

  noticeRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 8 },
  noticeBadge:     { backgroundColor: "#14532d", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  noticeBadgeFail: { backgroundColor: "#450a0a" },
  noticeText:      { color: "#4ade80", fontSize: 11, fontWeight: "700" },
  noticeTextFail:  { color: "#f87171" },

  filterRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 10, flexWrap: "wrap" },
  chip:      { borderWidth: 1, borderColor: "#334155", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipText:  { fontSize: 11, fontWeight: "600" },

  list: { paddingHorizontal: 12, paddingBottom: 20 },

  empty:     { paddingTop: 80, alignItems: "center", paddingHorizontal: 32 },
  emptyTitle:{ color: "#4b5563", fontSize: 18, fontWeight: "700", marginBottom: 10 },
  emptyHint: { color: "#374151", fontSize: 13, textAlign: "center", lineHeight: 20 },
});
