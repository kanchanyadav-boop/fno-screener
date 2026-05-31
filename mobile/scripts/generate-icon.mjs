/**
 * Generates icon.png (1024x1024) and adaptive-icon.png for FNO Screener.
 * Design: blue background + 3 white candlestick bars (rising uptrend).
 *
 * Run from mobile/ directory:
 *   node scripts/generate-icon.mjs
 */

import Jimp from "jimp";

const SIZE = 1024;
const BLUE = 0x2563ebff;
const WHITE = 0xffffffff;
const CLEAR = 0x00000000;

function rect(img, x, y, w, h, color) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.round(w);
  h = Math.round(h);
  for (let px = x; px < Math.min(x + w, SIZE); px++) {
    for (let py = y; py < Math.min(y + h, SIZE); py++) {
      img.setPixelColor(color, px, py);
    }
  }
}

// Draw a candlestick: wick (thin vertical line) + body (wider rectangle)
function candle(img, centerX, bodyTop, bodyH, wickExtra, bodyW, color) {
  const wickW = Math.max(4, Math.round(bodyW * 0.12));
  const wickX = centerX - Math.round(wickW / 2);
  // wick above
  rect(img, wickX, bodyTop - wickExtra, wickW, wickExtra + bodyH, color);
  // body
  rect(img, centerX - Math.round(bodyW / 2), bodyTop, bodyW, bodyH, color);
}

async function drawCandles(img, scale = 1, dx = 0, dy = 0) {
  const s = (n) => Math.round(n * scale);

  // 3 candles: short bearish left, medium bullish mid, tall bullish right
  // All white — simplified (no red/green, just clean white)
  const bw = s(110); // body width

  // Candle 1 — left, shortest
  candle(img, dx + s(248), dy + s(610), s(180), s(80), bw, WHITE);

  // Candle 2 — middle, medium
  candle(img, dx + s(496), dy + s(440), s(280), s(90), bw, WHITE);

  // Candle 3 — right, tallest
  candle(img, dx + s(744), dy + s(260), s(420), s(80), bw, WHITE);
}

async function applyRoundedCorners(img, radius) {
  for (let px = 0; px < SIZE; px++) {
    for (let py = 0; py < SIZE; py++) {
      const inCorner =
        (px < radius     && py < radius     && Math.hypot(px - radius, py - radius) > radius) ||
        (px >= SIZE - radius && py < radius     && Math.hypot(px - (SIZE - radius - 1), py - radius) > radius) ||
        (px < radius     && py >= SIZE - radius && Math.hypot(px - radius, py - (SIZE - radius - 1)) > radius) ||
        (px >= SIZE - radius && py >= SIZE - radius && Math.hypot(px - (SIZE - radius - 1), py - (SIZE - radius - 1)) > radius);
      if (inCorner) img.setPixelColor(CLEAR, px, py);
    }
  }
}

async function main() {
  // ── icon.png ────────────────────────────────────────────────────────────────
  const icon = new Jimp(SIZE, SIZE, BLUE);
  await drawCandles(icon, 1, 0, 0);
  await applyRoundedCorners(icon, 200);
  await icon.writeAsync("assets/icon.png");
  console.log("✔  assets/icon.png  (1024×1024, blue bg, white candles)");

  // ── adaptive-icon.png (transparent bg, candles scaled in 72%) ─────────────
  const adp = new Jimp(SIZE, SIZE, CLEAR);
  const sc = 0.72;
  const off = Math.round((SIZE - SIZE * sc) / 2);
  await drawCandles(adp, sc, off, off);
  await adp.writeAsync("assets/adaptive-icon.png");
  console.log("✔  assets/adaptive-icon.png  (1024×1024, transparent bg)");

  // ── splash.png (1284×2778 — iPhone 14 Pro Max, blue bg) ───────────────────
  const splash = new Jimp(1284, 2778, BLUE);
  const sc2 = 0.35;
  const sx = Math.round((1284 - SIZE * sc2) / 2);
  const sy = Math.round((2778 - SIZE * sc2) / 2);
  await drawCandles(splash, sc2, sx, sy);
  await splash.writeAsync("assets/splash.png");
  console.log("✔  assets/splash.png  (1284×2778, blue bg, candles centred)");
}

main().catch((e) => { console.error(e); process.exit(1); });
