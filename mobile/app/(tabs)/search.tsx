import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActionSheetIOS,
  SafeAreaView, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { FNO_STOCKS } from "../../lib/fnoStocks";
import { fetchCandles } from "../../lib/api";
import { generateTradeTip, calcEMA } from "../../lib/tradeTip";
import { addSetup } from "../../lib/storage";
import { TradeTip, Candle } from "../../lib/types";
import { ChartWebView, ChartLevels, ChartWebViewHandle } from "../../components/ChartWebView";

interface ChartPayload {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  ema: { time: number; value: number }[];
  zone?: { top: number; bottom: number; isSupply: boolean };
  levels?: ChartLevels;
}

export default function SearchTab() {
  const [query,     setQuery]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [stockInfo, setStockInfo] = useState<{ symbol: string; price: number; changePct: number; candles: Candle[] } | null>(null);
  const [autoTip,   setAutoTip]   = useState<TradeTip | null>(null);
  const [chartData, setChartData] = useState<ChartPayload | null>(null);

  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entry,     setEntry]     = useState("");
  const [sl,        setSl]        = useState("");
  const [target,    setTarget]    = useState("");
  const [notes,     setNotes]     = useState("");

  const chartRef = useRef<ChartWebViewHandle>(null);
  const loadedParamRef = useRef<string | null>(null);

  const suggestions = query.length >= 1
    ? FNO_STOCKS.filter((s) => s.toLowerCase().startsWith(query.toLowerCase())).slice(0, 8)
    : [];

  const loadStock = useCallback(async (sym: string) => {
    setQuery(sym);
    setLoading(true);
    setStockInfo(null);
    setAutoTip(null);
    setChartData(null);
    setEntry(""); setSl(""); setTarget("");

    try {
      const data = await fetchCandles(sym);
      const tip = generateTradeTip(data.candles);
      const ema = calcEMA(data.candles);

      const rawCandles = data.candles.map((c) => ({
        time: Math.floor(new Date(c.date).getTime() / 1000),
        open: c.o, high: c.h, low: c.l, close: c.c,
      }));

      const zone = tip ? {
        top: tip.zone.top,
        bottom: tip.zone.bottom,
        isSupply: tip.direction === "short",
      } : undefined;

      const autoDir = tip ? tip.direction : "long";
      const autoEntry  = tip ? tip.entry.toFixed(2)    : "";
      const autoSl     = tip ? tip.stopLoss.toFixed(2) : "";
      const autoTarget = tip ? tip.target.toFixed(2)   : "";

      setStockInfo({ symbol: sym, price: data.price, changePct: data.changePct, candles: data.candles });
      setAutoTip(tip);
      setDirection(autoDir);
      setEntry(autoEntry);
      setSl(autoSl);
      setTarget(autoTarget);

      const levels: ChartLevels | undefined = tip
        ? { entry: tip.entry, sl: tip.stopLoss, target: tip.target, direction: tip.direction }
        : undefined;

      setChartData({ candles: rawCandles, ema, zone, levels });
    } catch (err) {
      Alert.alert("Error", "Could not load data for " + sym + ". Make sure the Next.js server is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load when navigated from Screener tab with a symbol param
  const { symbol: paramSymbol } = useLocalSearchParams<{ symbol?: string }>();
  useEffect(() => {
    if (paramSymbol && paramSymbol !== loadedParamRef.current) {
      loadedParamRef.current = paramSymbol;
      loadStock(paramSymbol);
    }
  }, [paramSymbol, loadStock]);

  // When user changes entry/SL/target, update chart lines via JS injection only (no remount)
  useEffect(() => {
    if (!chartRef.current) return;
    const e = parseFloat(entry) || 0;
    const s = parseFloat(sl)    || 0;
    const t = parseFloat(target) || 0;
    chartRef.current.updateLevels(e, s, t, direction);
  }, [entry, sl, target, direction]);

  // Receive price tap from chart
  const handlePriceSelected = useCallback((price: number) => {
    const priceStr = price.toFixed(2);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Set ₹${priceStr} as:`,
          options: ["Cancel", "Entry Point", "Stop Loss", "Target"],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) setEntry(priceStr);
          if (i === 2) setSl(priceStr);
          if (i === 3) setTarget(priceStr);
        }
      );
    } else {
      Alert.alert(`Set ₹${priceStr} as`, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Entry Point", onPress: () => setEntry(priceStr) },
        { text: "Stop Loss",   onPress: () => setSl(priceStr) },
        { text: "Target",      onPress: () => setTarget(priceStr) },
      ]);
    }
  }, []);

  const rr = (() => {
    const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(target);
    if (!e || !s || !t || Math.abs(e - s) < 0.01) return null;
    return Math.abs((t - e) / (e - s));
  })();

  const canSave = !!stockInfo && !!parseFloat(entry) && !!parseFloat(sl) && !!parseFloat(target);

  const handleSave = async () => {
    if (!stockInfo || !canSave) return;
    const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(target);

    await addSetup({
      symbol: stockInfo.symbol,
      direction,
      entryPrice: e,
      stopLoss: s,
      target: t,
      notes: notes.trim(),
      fromAutoTip: !!autoTip,
      tipSignal: autoTip?.signal,
      tipConfidence: autoTip?.confidence,
    });

    Alert.alert("Saved ✓", `${stockInfo.symbol} setup saved to Watchlist.`);
    setEntry(""); setSl(""); setTarget(""); setNotes("");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={88}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Add Trade Setup</Text>
            <Text style={styles.subtitle}>Search stock · set levels · save to watchlist</Text>
          </View>

          {/* Search */}
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search stock (e.g. RELIANCE)"
              placeholderTextColor="#4b5563"
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={() => {
                const match = FNO_STOCKS.find((s) => s === query.toUpperCase());
                if (match) loadStock(match);
              }}
            />
            {loading && <ActivityIndicator style={styles.searchSpinner} color="#3b82f6" />}
          </View>

          {/* Suggestions */}
          {suggestions.length > 0 && !stockInfo && (
            <View style={styles.suggestions}>
              {suggestions.map((s) => (
                <TouchableOpacity key={s} style={styles.suggestion} onPress={() => loadStock(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Stock info bar */}
          {stockInfo && (
            <View style={styles.stockBar}>
              <Text style={styles.stockSym}>{stockInfo.symbol}</Text>
              <Text style={styles.stockPrice}>₹{stockInfo.price.toFixed(2)}</Text>
              <Text style={[styles.stockChg, { color: stockInfo.changePct >= 0 ? "#4ade80" : "#f87171" }]}>
                {stockInfo.changePct >= 0 ? "+" : ""}{stockInfo.changePct.toFixed(2)}%
              </Text>
              {autoTip && (
                <View style={styles.aiTag}>
                  <Text style={styles.aiTagText}>
                    AI: {autoTip.direction.toUpperCase()} {autoTip.signal}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Chart */}
          {chartData && (
            <View style={styles.chartWrap}>
              <ChartWebView
                ref={chartRef}
                data={chartData}
                height={340}
                onPriceSelected={handlePriceSelected}
              />
              <Text style={styles.chartHint}>Tap chart to set price levels</Text>
            </View>
          )}

          {/* Direction toggle */}
          {stockInfo && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Direction</Text>
              <View style={styles.dirToggle}>
                {(["long", "short"] as const).map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dirBtn, direction === d && styles.dirBtnActive,
                      direction === d && { backgroundColor: d === "long" ? "#14532d" : "#450a0a" }]}
                    onPress={() => setDirection(d)}
                  >
                    <Text style={[styles.dirBtnText, direction === d && {
                      color: d === "long" ? "#4ade80" : "#f87171",
                    }]}>
                      {d === "long" ? "↑ Long" : "↓ Short"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Price inputs */}
          {stockInfo && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Trade Levels</Text>
              {autoTip && (
                <TouchableOpacity
                  style={styles.autofillBtn}
                  onPress={() => {
                    setDirection(autoTip.direction);
                    setEntry(autoTip.entry.toFixed(2));
                    setSl(autoTip.stopLoss.toFixed(2));
                    setTarget(autoTip.target.toFixed(2));
                  }}
                >
                  <Text style={styles.autofillText}>↺ Auto-fill from AI tip</Text>
                </TouchableOpacity>
              )}
              <View style={styles.inputGrid}>
                <PriceInput label="Entry Point" value={entry} onChange={setEntry} color="#60a5fa"
                  hint={`Current: ₹${stockInfo.price.toFixed(0)}`} />
                <PriceInput label="Stop Loss"   value={sl}    onChange={setSl}    color="#f87171"
                  hint={direction === "long" ? "Below entry" : "Above entry"} />
                <PriceInput label="Target"      value={target} onChange={setTarget} color={direction === "long" ? "#4ade80" : "#f87171"}
                  hint={direction === "long" ? "Above entry" : "Below entry"} />
              </View>

              {rr !== null && (
                <View style={[styles.rrBadge, { backgroundColor: rr >= 3 ? "#14532d" : rr >= 2 ? "#1c1917" : "#450a0a" }]}>
                  <Text style={[styles.rrText, { color: rr >= 3 ? "#4ade80" : rr >= 2 ? "#fbbf24" : "#f87171" }]}>
                    R:R  1:{rr.toFixed(2)}
                    {rr >= 3 ? "  ✓ Good setup" : rr >= 2 ? "  ~ Acceptable" : "  ✗ Poor R:R (min 1:3)"}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Notes */}
          {stockInfo && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Notes (optional)</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Why this setup? Pattern, trigger..."
                placeholderTextColor="#4b5563"
                multiline
                numberOfLines={2}
              />
            </View>
          )}

          {/* Save button */}
          {stockInfo && (
            <TouchableOpacity
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveBtnText}>Save to Watchlist →</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PriceInput({
  label, value, onChange, color, hint,
}: {
  label: string; value: string; onChange: (v: string) => void; color: string; hint?: string;
}) {
  return (
    <View style={piStyles.wrap}>
      <Text style={[piStyles.label, { color }]}>{label}</Text>
      {hint && <Text style={piStyles.hint}>{hint}</Text>}
      <TextInput
        style={[piStyles.input, { borderColor: value ? color + "66" : "#334155" }]}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="₹0.00"
        placeholderTextColor="#4b5563"
      />
    </View>
  );
}

const piStyles = StyleSheet.create({
  wrap:  { flex: 1 },
  label: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  hint:  { color: "#4b5563", fontSize: 9, marginBottom: 4 },
  input: {
    backgroundColor: "#1f2937", borderWidth: 1, borderRadius: 8,
    padding: 10, color: "#f1f5f9", fontFamily: "monospace", fontSize: 14,
  },
});

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#0f172a" },
  scroll: { paddingBottom: 20 },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  title:  { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
  subtitle:{ color: "#64748b", fontSize: 12, marginTop: 2 },

  searchBox:     { marginHorizontal: 16, marginBottom: 4, flexDirection: "row", alignItems: "center" },
  searchInput:   {
    flex: 1, backgroundColor: "#1e293b", borderRadius: 12, borderWidth: 1, borderColor: "#334155",
    padding: 12, color: "#f1f5f9", fontSize: 15, fontFamily: "monospace", fontWeight: "700",
  },
  searchSpinner: { marginLeft: 10 },

  suggestions: { marginHorizontal: 16, backgroundColor: "#1e293b", borderRadius: 10, overflow: "hidden", marginBottom: 8 },
  suggestion:  { padding: 13, borderBottomWidth: 1, borderBottomColor: "#334155" },
  suggestionText: { color: "#93c5fd", fontFamily: "monospace", fontWeight: "600", fontSize: 14 },

  stockBar:  { marginHorizontal: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  stockSym:  { color: "#f1f5f9", fontFamily: "monospace", fontWeight: "700", fontSize: 16 },
  stockPrice:{ color: "#f1f5f9", fontFamily: "monospace", fontSize: 14 },
  stockChg:  { fontFamily: "monospace", fontSize: 13, fontWeight: "600" },
  aiTag:     { backgroundColor: "#1e3a5f", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  aiTagText: { color: "#60a5fa", fontSize: 10, fontWeight: "700" },

  chartWrap: { marginHorizontal: 16, marginBottom: 6, borderRadius: 12, overflow: "hidden" },
  chartHint: { color: "#374151", fontSize: 10, textAlign: "center", marginTop: 4 },

  section:      { marginHorizontal: 16, marginBottom: 14 },
  sectionLabel: { color: "#94a3b8", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },

  dirToggle: { flexDirection: "row", gap: 8 },
  dirBtn:    {
    flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center",
    backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#334155",
  },
  dirBtnActive: { borderWidth: 1 },
  dirBtnText:   { color: "#6b7280", fontWeight: "700", fontSize: 13 },

  autofillBtn:  { backgroundColor: "#1e3a5f", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, marginBottom: 10, alignSelf: "flex-start" },
  autofillText: { color: "#60a5fa", fontSize: 12, fontWeight: "600" },

  inputGrid: { flexDirection: "row", gap: 8 },

  rrBadge: { borderRadius: 8, padding: 10, marginTop: 10 },
  rrText:  { fontFamily: "monospace", fontSize: 12, fontWeight: "700", textAlign: "center" },

  notesInput: {
    backgroundColor: "#1f2937", borderWidth: 1, borderColor: "#334155", borderRadius: 10,
    padding: 10, color: "#9ca3af", fontSize: 13, minHeight: 60,
  },

  saveBtn:         { marginHorizontal: 16, backgroundColor: "#1e40af", borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  saveBtnDisabled: { backgroundColor: "#1f2937", opacity: 0.5 },
  saveBtnText:     { color: "#fff", fontWeight: "700", fontSize: 15 },
});
