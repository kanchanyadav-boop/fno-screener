import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActionSheetIOS,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { FNO_STOCKS } from "../../lib/fnoStocks";
import { fetchCandles } from "../../lib/api";
import { generateTradeTip, calcEMA } from "../../lib/tradeTip";
import { addSetup } from "../../lib/storage";
import { TradeTip, Candle } from "../../lib/types";
import { ChartWebView, ChartLevels, ChartWebViewHandle } from "../../components/ChartWebView";

const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", text2: "#64748b", text3: "#94a3b8",
  long: "#16a34a", short: "#dc2626", near: "#d97706", blue: "#2563eb",
  longBg: "#dcfce7", shortBg: "#fee2e2", blueBg: "#dbeafe",
  inputBg: "#f1f5f9", suggBg: "#ffffff",
};

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

      const zone = tip ? { top: tip.zone.top, bottom: tip.zone.bottom, isSupply: tip.direction === "short" } : undefined;
      const levels: ChartLevels | undefined = tip
        ? { entry: tip.entry, sl: tip.stopLoss, target: tip.target, direction: tip.direction }
        : undefined;

      setStockInfo({ symbol: sym, price: data.price, changePct: data.changePct, candles: data.candles });
      setAutoTip(tip);
      setDirection(tip ? tip.direction : "long");
      setEntry(tip ? tip.entry.toFixed(2) : "");
      setSl(tip ? tip.stopLoss.toFixed(2) : "");
      setTarget(tip ? tip.target.toFixed(2) : "");
      setChartData({ candles: rawCandles, ema, zone, levels });
    } catch {
      Alert.alert("Error", "Could not load data for " + sym + ". Make sure the server is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  const { symbol: paramSymbol } = useLocalSearchParams<{ symbol?: string }>();
  useEffect(() => {
    if (paramSymbol && paramSymbol !== loadedParamRef.current) {
      loadedParamRef.current = paramSymbol;
      loadStock(paramSymbol);
    }
  }, [paramSymbol, loadStock]);

  useEffect(() => {
    if (!chartRef.current) return;
    const e = parseFloat(entry) || 0;
    const s = parseFloat(sl)    || 0;
    const t = parseFloat(target) || 0;
    chartRef.current.updateLevels(e, s, t, direction);
  }, [entry, sl, target, direction]);

  const handlePriceSelected = useCallback((price: number) => {
    const priceStr = price.toFixed(2);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: `Set ₹${priceStr} as:`, options: ["Cancel", "Entry Point", "Stop Loss", "Target"], cancelButtonIndex: 0 },
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
    await addSetup({
      symbol: stockInfo.symbol,
      direction,
      entryPrice: parseFloat(entry),
      stopLoss: parseFloat(sl),
      target: parseFloat(target),
      notes: notes.trim(),
      fromAutoTip: !!autoTip,
      tipSignal: autoTip?.signal,
      tipConfidence: autoTip?.confidence,
    });
    Alert.alert("Saved ✓", `${stockInfo.symbol} setup saved to Watchlist.`);
    setEntry(""); setSl(""); setTarget(""); setNotes("");
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={88}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}>
          <View style={s.header}>
            <Text style={s.title}>Add Trade Setup</Text>
            <Text style={s.subtitle}>Search stock · set levels · save to watchlist</Text>
          </View>

          {/* Search */}
          <View style={s.searchBox}>
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search stock (e.g. RELIANCE)"
              placeholderTextColor={C.text3}
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={() => {
                const match = FNO_STOCKS.find((x) => x === query.toUpperCase());
                if (match) loadStock(match);
              }}
            />
            {loading && <ActivityIndicator style={s.searchSpinner} color={C.blue} />}
          </View>

          {suggestions.length > 0 && !stockInfo && (
            <View style={s.suggestions}>
              {suggestions.map((x) => (
                <TouchableOpacity key={x} style={s.suggestion} onPress={() => loadStock(x)}>
                  <Text style={s.suggestionText}>{x}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {stockInfo && (
            <View style={s.stockBar}>
              <Text style={s.stockSym}>{stockInfo.symbol}</Text>
              <Text style={s.stockPrice}>₹{stockInfo.price.toFixed(2)}</Text>
              <Text style={[s.stockChg, { color: stockInfo.changePct >= 0 ? C.long : C.short }]}>
                {stockInfo.changePct >= 0 ? "+" : ""}{stockInfo.changePct.toFixed(2)}%
              </Text>
              {autoTip && (
                <View style={s.aiTag}>
                  <Text style={s.aiTagText}>AI: {autoTip.direction.toUpperCase()} {autoTip.signal}</Text>
                </View>
              )}
            </View>
          )}

          {chartData && (
            <View style={s.chartWrap}>
              <ChartWebView ref={chartRef} data={chartData} height={340} onPriceSelected={handlePriceSelected} />
              <Text style={s.chartHint}>Tap chart to set price levels</Text>
            </View>
          )}

          {stockInfo && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Direction</Text>
              <View style={s.dirToggle}>
                {(["long", "short"] as const).map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[s.dirBtn,
                      direction === d && { backgroundColor: d === "long" ? C.longBg : C.shortBg, borderColor: d === "long" ? C.long : C.short }
                    ]}
                    onPress={() => setDirection(d)}
                  >
                    <Text style={[s.dirBtnText, direction === d && { color: d === "long" ? C.long : C.short }]}>
                      {d === "long" ? "↑ Long" : "↓ Short"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {stockInfo && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Trade Levels</Text>
              {autoTip && (
                <TouchableOpacity
                  style={s.autofillBtn}
                  onPress={() => {
                    setDirection(autoTip.direction);
                    setEntry(autoTip.entry.toFixed(2));
                    setSl(autoTip.stopLoss.toFixed(2));
                    setTarget(autoTip.target.toFixed(2));
                  }}
                >
                  <Text style={s.autofillText}>↺ Auto-fill from AI tip</Text>
                </TouchableOpacity>
              )}
              <View style={s.inputGrid}>
                <PriceInput label="Entry Point" value={entry} onChange={setEntry} color={C.blue}
                  hint={`Current: ₹${stockInfo.price.toFixed(0)}`} />
                <PriceInput label="Stop Loss" value={sl} onChange={setSl} color={C.short}
                  hint={direction === "long" ? "Below entry" : "Above entry"} />
                <PriceInput label="Target" value={target} onChange={setTarget}
                  color={direction === "long" ? C.long : C.short}
                  hint={direction === "long" ? "Above entry" : "Below entry"} />
              </View>

              {rr !== null && (
                <View style={[s.rrBadge, {
                  backgroundColor: rr >= 3 ? C.longBg : rr >= 2 ? "#fef3c7" : C.shortBg,
                }]}>
                  <Text style={[s.rrText, { color: rr >= 3 ? "#166534" : rr >= 2 ? "#92400e" : "#991b1b" }]}>
                    R:R  1:{rr.toFixed(2)}
                    {rr >= 3 ? "  ✓ Good setup" : rr >= 2 ? "  ~ Acceptable" : "  ✗ Poor R:R (min 1:3)"}
                  </Text>
                </View>
              )}
            </View>
          )}

          {stockInfo && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Notes (optional)</Text>
              <TextInput
                style={s.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Why this setup? Pattern, trigger..."
                placeholderTextColor={C.text3}
                multiline
                numberOfLines={2}
              />
            </View>
          )}

          {stockInfo && (
            <TouchableOpacity
              style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={s.saveBtnText}>Save to Watchlist →</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PriceInput({ label, value, onChange, color, hint }: {
  label: string; value: string; onChange: (v: string) => void; color: string; hint?: string;
}) {
  return (
    <View style={pi.wrap}>
      <Text style={[pi.label, { color }]}>{label}</Text>
      {hint && <Text style={pi.hint}>{hint}</Text>}
      <TextInput
        style={[pi.input, { borderColor: value ? color + "66" : C.border }]}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="₹0.00"
        placeholderTextColor={C.text3}
      />
    </View>
  );
}

const pi = StyleSheet.create({
  wrap:  { flex: 1 },
  label: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  hint:  { color: C.text3, fontSize: 9, marginBottom: 4 },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderRadius: 8,
    padding: 10, color: C.text, fontFamily: "monospace", fontSize: 14,
  },
});

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  scroll:  { paddingBottom: 20 },
  header:  { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 },
  title:   { color: C.text, fontSize: 20, fontWeight: "700" },
  subtitle:{ color: C.text2, fontSize: 12, marginTop: 2 },

  searchBox:   { marginHorizontal: 16, marginBottom: 4, flexDirection: "row", alignItems: "center" },
  searchInput: {
    flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 12, color: C.text, fontSize: 15, fontFamily: "monospace", fontWeight: "700",
  },
  searchSpinner: { marginLeft: 10 },

  suggestions:   { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 10, overflow: "hidden", marginBottom: 8, borderWidth: 1, borderColor: C.border },
  suggestion:    { padding: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  suggestionText:{ color: C.blue, fontFamily: "monospace", fontWeight: "600", fontSize: 14 },

  stockBar:  { marginHorizontal: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  stockSym:  { color: C.text, fontFamily: "monospace", fontWeight: "700", fontSize: 16 },
  stockPrice:{ color: C.text, fontFamily: "monospace", fontSize: 14 },
  stockChg:  { fontFamily: "monospace", fontSize: 13, fontWeight: "600" },
  aiTag:     { backgroundColor: C.blueBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  aiTagText: { color: C.blue, fontSize: 10, fontWeight: "700" },

  chartWrap: { marginHorizontal: 16, marginBottom: 6, borderRadius: 12, overflow: "hidden" },
  chartHint: { color: C.text3, fontSize: 10, textAlign: "center", marginTop: 4 },

  section:      { marginHorizontal: 16, marginBottom: 14 },
  sectionLabel: { color: C.text2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },

  dirToggle: { flexDirection: "row", gap: 8 },
  dirBtn:    {
    flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center",
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
  },
  dirBtnText: { color: C.text2, fontWeight: "700", fontSize: 13 },

  autofillBtn:  { backgroundColor: C.blueBg, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, marginBottom: 10, alignSelf: "flex-start" },
  autofillText: { color: C.blue, fontSize: 12, fontWeight: "600" },

  inputGrid: { flexDirection: "row", gap: 8 },

  rrBadge: { borderRadius: 8, padding: 10, marginTop: 10 },
  rrText:  { fontFamily: "monospace", fontSize: 12, fontWeight: "700", textAlign: "center" },

  notesInput: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10, color: C.text, fontSize: 13, minHeight: 60,
  },

  saveBtn:         { marginHorizontal: 16, backgroundColor: C.blue, borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  saveBtnDisabled: { backgroundColor: "#e2e8f0", opacity: 0.7 },
  saveBtnText:     { color: "#fff", fontWeight: "700", fontSize: 15 },
});
