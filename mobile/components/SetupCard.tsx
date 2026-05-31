import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { SavedSetup } from "../lib/types";
import { deleteSetup } from "../lib/storage";

interface Props {
  setup: SavedSetup;
  onDeleted: () => void;
}

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", text2: "#64748b", text3: "#94a3b8",
  long: "#16a34a", short: "#dc2626", blue: "#2563eb",
  longBg: "#dcfce7", shortBg: "#fee2e2", blueBg: "#dbeafe",
};

const STATUS_STYLE: Record<SavedSetup["status"], { bg: string; text: string; label: string }> = {
  active:     { bg: C.blueBg,  text: C.blue,  label: "Active" },
  target_hit: { bg: C.longBg,  text: "#166534", label: "Target Hit ✓" },
  sl_hit:     { bg: C.shortBg, text: "#991b1b", label: "SL Hit ✗" },
  expired:    { bg: "#f1f5f9", text: C.text3,   label: "Expired" },
};

function pct(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }

export function SetupCard({ setup, onDeleted }: Props) {
  const s = STATUS_STYLE[setup.status];
  const isShort = setup.direction === "short";
  const pnl = setup.currentPnlPct ?? 0;
  const pnlColor = pnl >= 0 ? C.long : C.short;

  const confirmDelete = () => {
    Alert.alert("Remove Setup", `Remove ${setup.symbol} setup?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => { await deleteSetup(setup.id); onDeleted(); } },
    ]);
  };

  const progressPct = setup.lastPrice != null
    ? Math.max(0, Math.min(100, isShort
        ? ((setup.entryPrice - setup.lastPrice) / (setup.entryPrice - setup.target)) * 100
        : ((setup.lastPrice - setup.entryPrice) / (setup.target - setup.entryPrice)) * 100))
    : 0;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.symbol}>{setup.symbol}</Text>
          <View style={[styles.dirBadge, { backgroundColor: isShort ? C.shortBg : C.longBg }]}>
            <Text style={[styles.dirText, { color: isShort ? C.short : C.long }]}>
              {isShort ? "SHORT ↓" : "LONG ↑"}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
            <Text style={[styles.statusText, { color: s.text }]}>{s.label}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={confirmDelete} style={styles.delBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.delText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.levelsRow}>
        <LevelCol label="Entry"  value={setup.entryPrice.toFixed(2)} color={C.blue} />
        <LevelCol label="Target" value={setup.target.toFixed(2)}     color={isShort ? C.short : C.long} />
        <LevelCol label="SL"     value={setup.stopLoss.toFixed(2)}   color={C.short} />
        <LevelCol label="R:R"    value={`1:${setup.riskReward.toFixed(1)}`} color={C.text3} />
      </View>

      {setup.lastPrice != null && (
        <View style={styles.barOuter}>
          <View style={[styles.barFill, { width: `${progressPct}%` as any,
            backgroundColor: progressPct >= 70 ? C.long : progressPct >= 30 ? "#f59e0b" : C.blue }]} />
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerGray}>
          {setup.lastPrice != null ? `₹${setup.lastPrice.toFixed(2)}` : "–"}
        </Text>
        {setup.currentPnlPct != null && (
          <Text style={[styles.pnl, { color: pnlColor }]}>{pct(pnl)}</Text>
        )}
        <Text style={styles.footerGray}>
          {new Date(setup.savedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
        </Text>
        {setup.fromAutoTip && setup.tipSignal && (
          <View style={styles.tipBadge}>
            <Text style={styles.tipText}>AI {setup.tipSignal}</Text>
          </View>
        )}
        <Text style={styles.footerGray}>max fav {setup.maxFavorablePct.toFixed(1)}%</Text>
      </View>

      {setup.notes ? <Text style={styles.notes}>{setup.notes}</Text> : null}
    </View>
  );
}

function LevelCol({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.levelCol}>
      <Text style={styles.levelLabel}>{label}</Text>
      <Text style={[styles.levelValue, { color }]}>₹{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: C.border,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  row:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 },
  symbol:  { color: C.text, fontFamily: "monospace", fontWeight: "700", fontSize: 16 },
  dirBadge:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  dirText:    { fontSize: 10, fontWeight: "700" },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: "600" },
  delBtn:  { padding: 4 },
  delText: { color: C.text3, fontSize: 14 },

  levelsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  levelCol:  { alignItems: "center", flex: 1 },
  levelLabel:{ color: C.text3, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 },
  levelValue:{ fontFamily: "monospace", fontSize: 12, fontWeight: "700", marginTop: 2 },

  barOuter: { height: 4, backgroundColor: C.border, borderRadius: 2, marginBottom: 8, overflow: "hidden" },
  barFill:  { height: "100%", borderRadius: 2 },

  footer:    { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  footerGray:{ color: C.text3, fontSize: 10 },
  pnl:       { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  tipBadge:  { backgroundColor: C.blueBg, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  tipText:   { color: C.blue, fontSize: 9, fontWeight: "600" },
  notes:     { color: C.text2, fontSize: 11, marginTop: 6, fontStyle: "italic" },
});
