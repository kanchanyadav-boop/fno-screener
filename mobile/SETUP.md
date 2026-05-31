# FNO Screener Mobile

## Quick Start

### 1. Install dependencies
```bash
cd mobile
npm install
```

### 2. Configure API URL
Edit `lib/api.ts` and set the correct URL for your environment:

| Environment         | URL                          |
|---------------------|------------------------------|
| iOS Simulator       | `http://localhost:3000`      |
| Android Emulator    | `http://10.0.2.2:3000`      |
| Physical device     | `http://<YOUR_LAN_IP>:3000` |

Find your LAN IP on Windows: run `ipconfig` → look for IPv4 Address.

### 3. Start the Next.js API server
```bash
# In the root fno-screener directory
npm run dev
```

### 4. Start Expo
```bash
cd mobile
npx expo start
```
- Press `i` for iOS simulator, `a` for Android emulator
- Scan QR code with Expo Go app for physical device

---

## Features

### Screener Tab
- Same as the web Trade Tips page
- Scans all ~175 F&O stocks for demand/supply zone setups
- Long (green) and short (red) setups

### Add Setup Tab
- Search any F&O stock by symbol
- Opens a candlestick chart with EMA 20
- **Tap the chart** to pick a price → set as Entry / SL / Target
- **▭ Mark** tool: drag to draw a rectangle on the chart (mark patterns, zones)
- **↑ Long / ↓ Short** button: shows the position visualization (colored profit/risk bands)
- AI auto-fill: if the trade tips engine finds a setup, it pre-fills all levels
- Set direction, entry, SL, target → Save to Watchlist

### Watchlist Tab
- All saved setups with live price monitoring
- Auto-refreshes prices every 30 seconds when the tab is open
- Status tracking:
  - ● Active: monitoring  
  - ✓ Target Hit: setup passed (green)
  - ✗ SL Hit: setup failed (red)
  - ⏰ Expired: 30 days without resolution
- Win rate, total setups, pass/fail counts
- Pull-to-refresh for manual price update

---

## Chart Tools

| Tool     | How to use                                       |
|----------|--------------------------------------------------|
| ▭ Mark   | Tap & drag on chart to draw a rectangle          |
| ↑ Long   | Shows green profit zone + red risk zone for long |
| ↓ Short  | Shows red profit zone + green risk zone for short|
| ✕        | Clears all drawings                              |
| Tap      | Tap anywhere → pick price for Entry/SL/Target    |
