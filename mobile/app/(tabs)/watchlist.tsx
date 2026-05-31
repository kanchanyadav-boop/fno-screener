import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { loadSetups, updateSetupPrices, getAlertedIds, markAlerted, clearAlert } from "../../lib/storage";
import { fetchPrices } from "../../lib/api";
import { sendEntryAlert, sendTargetAlert, sendSLAlert } from "../../lib/notifications";
import { SetupCard } from "../../components/SetupCard";
import { SavedSetup } from "../../lib/types";

type Filter = "all" | "active" | "target_hit" | "sl_hit";

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", text2: "#64748b", text3: "#94a3b8",
  long: "#16a34a", short: "#dc2626", blue: "#2563eb",
  longBg: "#dcfce7", shortBg: "#fee2e2",
};

export default function WatchlistTab() {
  const [setups,     setSetups]     = useState<SavedSetup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [lastSync,   setLastSync]   = useState<Date | null>(null);

  const loadAndSync = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const current = await loadSetups();
      setSetups(current);

      const activeSetups = current.filter((s) => s.status === "active");
      const activeSyms = [...new Set(activeSetups.map((s) => s.symbol))];
      if (activeSyms.length > 0) {
        const prices = await fetchPrices(activeSyms);
        if (Object.keys(prices).length > 0) {
          const alerted = await getAlertedIds();
          for (const setup of activeSetups) {
            const pd = prices[setup.symbol];
            if (!pd?.price) continue;
            const distPct = Math.abs((pd.price - setup.entryPrice) / setup.entryPrice * 100);
            if (distPct <= 2 && !alerted.has(setup.id)) {
              await sendEntryAlert(setup.symbol, setup.direction, setup.entryPrice, pd.price);
              await markAlerted(setup.id);
            } else if (distPct > 5) {
              await clearAlert(setup.id);
            }
          }

          const updated = await updateSetupPrices(prices);

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

  useFocusEffect(
    useCallback(() => {
      loadAndSync(true);
      const id = setInterval(() => loadAndSync(true), 30_000);
      return () => clearInterval(id);
    }, [loadAndSync])
  );

  const filtered = setups.filter((s) => {
    if (filter === "all")        return true;
    if (filter === "active")     return s.status === "active";
    if (filter === "target_hit") return s.status === "target_hit";
    if (filter === "sl_hit")     return s.status === "sl_hit";
    return true;
  });

  const total   = setups.length;
  const active  = setups.filter((s) => s.status === "active").length;
  const passed  = setups.filter((s) => s.status === "target_hit").length;
  const failed  = setups.filter((s) => s.status === "sl_hit").length;
  const closed  = passed + failed;
  const winRate = closed > 0 ? Math.round((passed / closed) * 100) : null;

  const filterTabs: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "all",        label: "All",      count: total,  color: C.text3 },
    { key: "active",     label: "Active",   count: active, color: C.blue },
    { key: "target_hit", label: "✓ Passed", count: passed, color: C.long },
    { key: "sl_hit",     label: "✗ Failed", count: failed, color: C.short },
  ];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Watchlist</Text>
          <Text style={s.subtitle}>Saved trade setups · performance tracking</Text>
        </View>
        {lastSync && (
          <Text style={s.syncLabel}>
            {lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        )}
      </View>

      {total > 0 && (
        <View style={s.statsRow}>
          <StatBox label="Total"   value={String(total)}       color={C.text2} />
          <StatBox label="Active"  value={String(active)}      color={C.blue} />
          <StatBox label="Passed"  value={String(passed)}      color={C.long} />
          <StatBox label="Failed"  value={String(failed)}      color={C.short} />
          <StatBox label="Win %"   value={winRate !== null ? `${winRate}%` : "–"}
            color={winRate !== null && winRate >= 50 ? C.long : C.short} />
        </View>
      )}

      {(passed > 0 || failed > 0) && (
        <View style={s.noticeRow}>
          {passed > 0 && (
            <View style={[s.noticeBadge, { backgroundColor: C.longBg }]}>
              <Text style={[s.noticeText, { color: "#166534" }]}>✓ {passed} target{passed > 1 ? "s" : ""} hit</Text>
            </View>
          )}
          {failed > 0 && (
            <View style={[s.noticeBadge, { backgroundColor: C.shortBg }]}>
              <Text style={[s.noticeText, { color: "#991b1b" }]}>✗ {failed} SL{failed > 1 ? "s" : ""} triggered</Text>
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
        keyExtractor={(s) => s.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadAndSync(false)} tintColor={C.blue} />
        }
        renderItem={({ item }) => <SetupCard setup={item} onDeleted={() => loadAndSync(true)} />}
        ListEmptyComponent={
          <View style={s.empty}>
            {total === 0 ? (
              <>
                <Text style={s.emptyTitle}>No setups yet</Text>
                <Text style={s.emptyHint}>
                  Go to{" "}
                  <Text style={{ color: C.blue }}>Add Setup</Text>
                  {" "}tab to search a stock, set your entry/SL/target and save it here.
                </Text>
              </>
            ) : (
              <Text style={s.emptyHint}>No {filter} setups.</Text>
            )}
          </View>
        }
      />
    </SafeAreaView>
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

const ss = StyleSheet.create({
  box:   { flex: 1, alignItems: "center" },
  value: { fontSize: 18, fontWeight: "700", fontFamily: "monospace" },
  label: { color: C.text3, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },
});

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  header:    { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title:     { color: C.text, fontSize: 20, fontWeight: "700" },
  subtitle:  { color: C.text2, fontSize: 12, marginTop: 2 },
  syncLabel: { color: C.text3, fontSize: 10, marginTop: 6 },

  statsRow: {
    flexDirection: "row", marginHorizontal: 16, marginBottom: 10,
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },

  noticeRow:  { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 8 },
  noticeBadge:{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  noticeText: { fontSize: 11, fontWeight: "700" },

  filterRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 10, flexWrap: "wrap" },
  chip:      { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipText:  { fontSize: 11, fontWeight: "600" },

  list: { paddingHorizontal: 12, paddingBottom: 20 },

  empty:     { paddingTop: 80, alignItems: "center", paddingHorizontal: 32 },
  emptyTitle:{ color: C.text2, fontSize: 18, fontWeight: "700", marginBottom: 10 },
  emptyHint: { color: C.text3, fontSize: 13, textAlign: "center", lineHeight: 20 },
});
