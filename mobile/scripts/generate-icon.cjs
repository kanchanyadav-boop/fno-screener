/**
 * Generates icon.png, adaptive-icon.png, splash.png for FNO Screener.
 * Design: blue (#2563eb) background + 3 white candlestick bars (uptrend).
 * Run: node scripts/generate-icon.cjs
 */

const { Jimp } = require("jimp");

const SIZE  = 1024;
const BLUE  = 0x2563ebff;
const WHITE = 0xffffffff;
const CLEAR = 0x00000000;

function rect(img, x, y, w, h, color) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.round(w);
  h = Math.round(h);
  const maxX = img.bitmap.width;
  const maxY = img.bitmap.height;
  for (let px = x; px < Math.min(x + w, maxX); px++) {
    for (let py = y; py < Math.min(y + h, maxY); py++) {
      img.setPixelColor(color, px, py);
    }
  }
}

// Single candlestick: thin wick + wider body
function candle(img, centerX, bodyTop, bodyH, wickAbove, wickBelow, bodyW, color) {
  const ww = Math.max(5, Math.round(bodyW * 0.13));
  const wx = centerX - Math.round(ww / 2);
  rect(img, wx, bodyTop - wickAbove, ww, wickAbove + bodyH + wickBelow, color);
  rect(img, centerX - Math.round(bodyW / 2), bodyTop, bodyW, bodyH, color);
}

function drawChart(img, scale, offX, offY) {
  const s  = (n) => Math.round(n * scale);
  const bw = s(108); // body width

  // Canvas is 1024×1024, so at scale=1 the chart fills it nicely
  // 3 candles in uptrend: left short, mid medium, right tall
  candle(img, offX + s(232), offY + s(615), s(165), s(80), s(45), bw, WHITE); // left
  candle(img, offX + s(492), offY + s(420), s(290), s(85), s(55), bw, WHITE); // mid
  candle(img, offX + s(752), offY + s(220), s(440), s(75), s(60), bw, WHITE); // right
}

function roundCorners(img, radius) {
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  for (let px = 0; px < W; px++) {
    for (let py = 0; py < H; py++) {
      const corners = [
        [radius,     radius,     px,     py],
        [W - radius, radius,     px - W, py],
        [radius,     H - radius, px,     py - H],
        [W - radius, H - radius, px - W, py - H],
      ];
      for (const [cx, cy, dx, dy] of corners) {
        if (px < cx && py < cy && Math.hypot(px - cx, py - cy) > radius) {
          img.setPixelColor(CLEAR, px, py);
          break;
        }
      }
    }
  }
}

async function main() {
  // icon.png — 1024×1024, blue bg, rounded corners
  const icon = new Jimp({ width: SIZE, height: SIZE, color: BLUE });
  drawChart(icon, 1, 0, 0);
  roundCorners(icon, 200);
  await icon.write("assets/icon.png");
  console.log("✔  assets/icon.png");

  // adaptive-icon.png — transparent bg, candles scaled to 72%, centred
  const adp = new Jimp({ width: SIZE, height: SIZE, color: CLEAR });
  const sc = 0.72;
  const off = Math.round((SIZE * (1 - sc)) / 2);
  drawChart(adp, sc, off, off);
  await adp.write("assets/adaptive-icon.png");
  console.log("✔  assets/adaptive-icon.png");

  // splash.png — 1284×2778, blue bg, small centred logo
  const SW = 1284, SH = 2778;
  const splash = new Jimp({ width: SW, height: SH, color: BLUE });
  const sc2 = 0.32;
  const sx = Math.round((SW - SIZE * sc2) / 2);
  const sy = Math.round((SH - SIZE * sc2) / 2);
  drawChart(splash, sc2, sx, sy);
  await splash.write("assets/splash.png");
  console.log("✔  assets/splash.png");
}

main().catch((e) => { console.error(e); process.exit(1); });
