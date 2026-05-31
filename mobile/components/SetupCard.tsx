import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { SavedSetup } from "../lib/types";
import { deleteSetup } from "../lib/storage";

interface Props {
  setup: SavedSetup;
  onDeleted: () => void;
}

const STATUS_STYLE: Record<SavedSetup["status"], { bg: string; text: string; label: string; icon: string }> = {
  active:     { bg: "#1e3a5f", text: "#60a5fa", label: "Active",      icon: "●" },
  target_hit: { bg: "#14532d", text: "#4ade80", label: "Target Hit ✓", icon: "✓" },
  sl_hit:     { bg: "#450a0a", text: "#f87171", label: "SL Hit ✗",     icon: "✗" },
  expired:    { bg: "#1f2937", text: "#6b7280", label: "Expired",      icon: "⏰" },
};

function pct(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; }
function fmt(n: number) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toFixed(0); }

export function SetupCard({ setup, onDeleted }: Props) {
  const s = STATUS_STYLE[setup.status];
  const isShort = setup.direction === "short";
  const pnl = setup.currentPnlPct ?? 0;
  const pnlColor = pnl >= 0 ? "#4ade80" : "#f87171";

  const confirmDelete = () => {
    Alert.alert("Remove Setup", `Remove ${setup.symbol} setup?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await deleteSetup(setup.id);
          onDeleted();
        },
      },
    ]);
  };

  // Progress bar: 0 = at entry, 100 = at target; red side = SL
  const progressPct = setup.lastPrice != null
    ? Math.max(0, Math.min(100, isShort
        ? ((setup.entryPrice - setup.lastPrice) / (setup.entryPrice - setup.target)) * 100
        : ((setup.lastPrice - setup.entryPrice) / (setup.target - setup.entryPrice)) * 100))
    : 0;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.symbol}>{setup.symbol}</Text>
          <View style={[styles.dirBadge, { backgroundColor: isShort ? "#450a0a" : "#14532d" }]}>
            <Text style={[styles.dirText, { color: isShort ? "#f87171" : "#4ade80" }]}>
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

      {/* Levels */}
      <View style={styles.levelsRow}>
        <LevelCol label="Entry"  value={fmt(setup.entryPrice)} color="#60a5fa" />
        <LevelCol label="Target" value={fmt(setup.target)}     color={isShort ? "#f87171" : "#4ade80"} />
        <LevelCol label="SL"     value={fmt(setup.stopLoss)}   color="#f87171" />
        <LevelCol label="R:R"    value={`1:${setup.riskReward.toFixed(1)}`} color="#a3a3a3" />
      </View>

      {/* Progress bar */}
      {setup.lastPrice != null && (
        <View style={styles.barOuter}>
          <View style={[styles.barFill, { width: `${progressPct}%` as any,
            backgroundColor: progressPct >= 70 ? "#10b981" : progressPct >= 30 ? "#f59e0b" : "#3b82f6" }]} />
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerGray}>
          {setup.lastPrice != null ? `₹${fmt(setup.lastPrice)}` : "–"}
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
        <Text style={styles.footerGray}>max favourable {setup.maxFavorablePct.toFixed(1)}%</Text>
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
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  row:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 },
  symbol:  { color: "#f1f5f9", fontFamily: "monospace", fontWeight: "700", fontSize: 16 },
  dirBadge:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  dirText:    { fontSize: 10, fontWeight: "700" },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: "600" },
  delBtn:  { padding: 4 },
  delText: { color: "#6b7280", fontSize: 14 },
  levelsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  levelCol:  { alignItems: "center", flex: 1 },
  levelLabel:{ color: "#6b7280", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 },
  levelValue:{ fontFamily: "monospace", fontSize: 12, fontWeight: "700", marginTop: 2 },
  barOuter: { height: 4, backgroundColor: "#1f2937", borderRadius: 2, marginBottom: 8, overflow: "hidden" },
  barFill:  { height: "100%", borderRadius: 2 },
  footer:   { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  footerGray: { color: "#6b7280", fontSize: 10 },
  pnl:        { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  tipBadge:   { backgroundColor: "#1e3a5f", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  tipText:    { color: "#60a5fa", fontSize: 9, fontWeight: "600" },
  notes:      { color: "#9ca3af", fontSize: 11, marginTop: 6, fontStyle: "italic" },
});
