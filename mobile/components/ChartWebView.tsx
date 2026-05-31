import React, { useRef, useCallback, forwardRef, useImperativeHandle, useMemo } from "react";
import { StyleSheet, View, ActivityIndicator } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

export interface ChartWebViewHandle {
  updateLevels: (entry: number, sl: number, target: number, direction: "long" | "short") => void;
}

export interface ChartLevels {
  entry: number;
  sl: number;
  target: number;
  direction: "long" | "short";
}

interface ChartData {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  ema: { time: number; value: number }[];
  zone?: { top: number; bottom: number; isSupply: boolean };
  levels?: ChartLevels;
}

interface Props {
  data: ChartData;
  height?: number;
  onPriceSelected?: (price: number) => void;
}

function buildHTML(data: ChartData): string {
  const json = JSON.stringify(data);
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0f172a;overflow:hidden}
    #container{position:relative;width:100vw;height:100vh}
    #chart{width:100%;height:100%}
    #overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
    #crosshair-label{position:absolute;top:6px;left:6px;background:rgba(15,23,42,0.85);
      color:#94a3b8;font:11px system-ui;padding:2px 7px;border-radius:4px;
      pointer-events:none;border:1px solid #334155}
    #toolbar{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);
      display:flex;gap:5px;background:rgba(15,23,42,0.92);
      border:1px solid #334155;border-radius:20px;padding:5px 10px;z-index:100}
    .tb{background:transparent;border:1px solid #334155;color:#94a3b8;
      border-radius:12px;padding:5px 14px;font:12px system-ui;cursor:pointer}
    .tb.on{background:#3b82f6;border-color:#3b82f6;color:#fff}
    .tb.del{border-color:#ef444450;color:#ef4444}
  </style>
</head>
<body>
<div id="container">
  <div id="chart"></div>
  <canvas id="overlay"></canvas>
  <div id="crosshair-label"></div>
  <div id="toolbar">
    <button class="tb" id="tb-rect"  onclick="toggleTool('rect')">▭ Mark</button>
    <button class="tb" id="tb-long"  onclick="applyPos('long')">↑ Long</button>
    <button class="tb" id="tb-short" onclick="applyPos('short')">↓ Short</button>
    <button class="tb del" onclick="clearAll()">✕</button>
  </div>
</div>
<script src="https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js"></script>
<script>
const D = ${json};
// ── Chart ──────────────────────────────────────────────────────────────────────
const chart = LightweightCharts.createChart(document.getElementById('chart'),{
  layout:{background:{color:'#0f172a'},textColor:'#94a3b8'},
  grid:{vertLines:{color:'#1e293b'},horzLines:{color:'#1e293b'}},
  crosshair:{mode:LightweightCharts.CrosshairMode.Normal},
  rightPriceScale:{borderColor:'#334155',scaleMargins:{top:0.06,bottom:0.08}},
  timeScale:{borderColor:'#334155',timeVisible:true,rightOffset:4},
  handleScroll:true,handleScale:true,
});
const cs = chart.addCandlestickSeries({
  upColor:'#10b981',downColor:'#ef4444',borderVisible:false,
  wickUpColor:'#10b981',wickDownColor:'#ef4444',
});
cs.setData(D.candles);

if(D.ema?.length){
  const es=chart.addLineSeries({color:'#f59e0b',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
  es.setData(D.ema);
}
if(D.zone){
  const zc=D.zone.isSupply?'#ef4444':'#10b981';
  cs.createPriceLine({price:D.zone.top,color:zc,lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:D.zone.isSupply?'Supply':'Demand'});
  cs.createPriceLine({price:D.zone.bottom,color:zc,lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:false,title:''});
}

// ── Price lines (entry/SL/target) ─────────────────────────────────────────────
let eL=null,sL=null,tL=null;
function updateLines(entry,sl,target,dir){
  [eL,sL,tL].forEach(l=>{if(l)try{cs.removePriceLine(l)}catch(e){}});
  eL=sL=tL=null;
  if(entry>0) eL=cs.createPriceLine({price:entry,color:'#3b82f6',lineWidth:2,lineStyle:LightweightCharts.LineStyle.Solid,axisLabelVisible:true,title:'Entry'});
  if(sl>0)    sL=cs.createPriceLine({price:sl,color:'#ef4444',lineWidth:1,lineStyle:LightweightCharts.LineStyle.LargeDashed,axisLabelVisible:true,title:'SL'});
  if(target>0)tL=cs.createPriceLine({price:target,color:'#10b981',lineWidth:1,lineStyle:LightweightCharts.LineStyle.LargeDashed,axisLabelVisible:true,title:'Target'});
  posBox = (entry>0&&sl>0&&target>0)?{entry,sl,target,dir:dir||'long'}:null;
  redraw();
}
if(D.levels){const l=D.levels;updateLines(l.entry||0,l.sl||0,l.target||0,l.direction||'long');}

// ── Canvas overlay ─────────────────────────────────────────────────────────────
const cvs=document.getElementById('overlay');
const ctx=cvs.getContext('2d');
const rects=[];
let posBox=null;
let inProgressRect=null;

function resize(){
  cvs.width=window.innerWidth;
  cvs.height=window.innerHeight;
  redraw();
}

function redraw(){
  ctx.clearRect(0,0,cvs.width,cvs.height);
  if(posBox) drawPosBox(posBox);
  rects.forEach(r=>{
    ctx.save();
    ctx.fillStyle='rgba(245,158,11,0.07)';
    ctx.strokeStyle='#f59e0b';
    ctx.lineWidth=1.5;
    const x=Math.min(r.x1,r.x2),y=Math.min(r.y1,r.y2),w=Math.abs(r.x2-r.x1),h=Math.abs(r.y2-r.y1);
    ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
    ctx.restore();
  });
  if(inProgressRect){
    ctx.save();
    ctx.fillStyle='rgba(245,158,11,0.04)';
    ctx.strokeStyle='rgba(245,158,11,0.6)';
    ctx.lineWidth=1;ctx.setLineDash([4,4]);
    const x=Math.min(inProgressRect.x1,inProgressRect.x2),y=Math.min(inProgressRect.y1,inProgressRect.y2);
    const w=Math.abs(inProgressRect.x2-inProgressRect.x1),h=Math.abs(inProgressRect.y2-inProgressRect.y1);
    ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
    ctx.setLineDash([]);ctx.restore();
  }
}

function drawPosBox(pb){
  const ey=cs.priceToCoordinate(pb.entry);
  const sy=cs.priceToCoordinate(pb.sl);
  const ty=cs.priceToCoordinate(pb.target);
  if(!ey||!sy||!ty)return;
  const W=cvs.width;
  ctx.save();
  if(pb.dir==='long'){
    ctx.fillStyle='rgba(16,185,129,0.12)';
    ctx.fillRect(0,ty,W,ey-ty); // profit
    ctx.fillStyle='rgba(239,68,68,0.12)';
    ctx.fillRect(0,ey,W,sy-ey); // risk
  }else{
    ctx.fillStyle='rgba(239,68,68,0.12)';
    ctx.fillRect(0,ey,W,ty-ey); // risk (short: target below entry)
    ctx.fillStyle='rgba(16,185,129,0.12)';
    ctx.fillRect(0,sy,W,ey-sy); // profit (short: sl above entry)
  }
  // Labels
  ctx.font='bold 10px system-ui';ctx.textAlign='right';
  const rr=pb.entry>0&&pb.sl>0&&pb.target>0?Math.abs((pb.target-pb.entry)/(pb.entry-pb.sl)).toFixed(1):'';
  label(ctx,'Target ₹'+pb.target.toFixed(0),W-8,ty-6,pb.dir==='long'?'#10b981':'#ef4444');
  label(ctx,'Entry ₹'+pb.entry.toFixed(0),W-8,ey-6,'#3b82f6');
  label(ctx,'SL ₹'+pb.sl.toFixed(0),W-8,sy+12,'#ef4444');
  if(rr){ctx.textAlign='left';label(ctx,'R:R 1:'+rr,8,(ey+ty)/2,'#94a3b8');}
  ctx.restore();
}
function label(ctx,text,x,y,color){
  const m=ctx.measureText(text);
  ctx.fillStyle='rgba(15,23,42,0.75)';
  const bx=ctx.textAlign==='right'?x-m.width-4:x-4;
  ctx.fillRect(bx,y-10,m.width+8,14);
  ctx.fillStyle=color;ctx.fillText(text,x,y);
}

// ── Tools ─────────────────────────────────────────────────────────────────────
let activeTool=null;
let touchStarted=false,touchId=null;

function toggleTool(name){
  activeTool=activeTool===name?null:name;
  document.querySelectorAll('.tb').forEach(b=>b.classList.remove('on'));
  if(activeTool)document.getElementById('tb-'+activeTool).classList.add('on');
}

function applyPos(dir){
  window.ReactNativeWebView?.postMessage(JSON.stringify({type:'applyPos',dir}));
}

function clearAll(){rects.length=0;posBox=null;eL=sL=tL=null;
  try{if(eL)cs.removePriceLine(eL)}catch(e){}
  try{if(sL)cs.removePriceLine(sL)}catch(e){}
  try{if(tL)cs.removePriceLine(tL)}catch(e){}
  eL=sL=tL=null;redraw();
  window.ReactNativeWebView?.postMessage(JSON.stringify({type:'cleared'}));
}

const el=chart.chartElement();
el.addEventListener('touchstart',e=>{
  if(activeTool!=='rect')return;
  e.preventDefault();
  const t=e.touches[0];touchId=t.identifier;
  const r=el.getBoundingClientRect();
  inProgressRect={x1:t.clientX-r.left,y1:t.clientY-r.top,x2:t.clientX-r.left,y2:t.clientY-r.top};
  touchStarted=true;
},{passive:false});

el.addEventListener('touchmove',e=>{
  if(!touchStarted||activeTool!=='rect')return;
  e.preventDefault();
  const t=Array.from(e.touches).find(x=>x.identifier===touchId);
  if(!t)return;
  const r=el.getBoundingClientRect();
  inProgressRect.x2=t.clientX-r.left;inProgressRect.y2=t.clientY-r.top;
  redraw();
},{passive:false});

el.addEventListener('touchend',e=>{
  if(!touchStarted||activeTool!=='rect')return;
  if(inProgressRect&&Math.abs(inProgressRect.x2-inProgressRect.x1)>8)
    rects.push({...inProgressRect});
  inProgressRect=null;touchStarted=false;redraw();
});

// ── Click → price pick ────────────────────────────────────────────────────────
chart.subscribeClick(function(p){
  if(activeTool==='rect')return;
  if(!p.point)return;
  const price=cs.coordinateToPrice(p.point.y);
  if(price)window.ReactNativeWebView?.postMessage(JSON.stringify({type:'priceSelected',price:+price.toFixed(2)}));
});

chart.subscribeCrosshairMove(function(p){
  if(!p.point)return;
  const price=cs.coordinateToPrice(p.point.y);
  if(price)document.getElementById('crosshair-label').textContent='₹'+price.toFixed(2);
});

chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
window.addEventListener('resize',()=>{chart.resize(window.innerWidth,window.innerHeight);resize();});

// RN → WebView bridge
window.updateLines=updateLines;

resize();
chart.timeScale().fitContent();
</script>
</body>
</html>`;
}

export const ChartWebView = forwardRef<ChartWebViewHandle, Props>(
function ChartWebView({ data, height = 320, onPriceSelected }, outerRef) {
  const webviewRef = useRef<WebView>(null);

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg.type === "priceSelected" && onPriceSelected) {
          onPriceSelected(msg.price);
        }
      } catch {}
    },
    [onPriceSelected]
  );

  const updateLevels = useCallback(
    (entry: number, sl: number, target: number, direction: "long" | "short") => {
      webviewRef.current?.injectJavaScript(
        `updateLines(${entry},${sl},${target},'${direction}');true;`
      );
    },
    []
  );

  useImperativeHandle(outerRef, () => ({ updateLevels }), [updateLevels]);

  const html = useMemo(() => buildHTML(data), [data]);

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        ref={webviewRef}
        source={{ html }}
        style={styles.webview}
        originWhitelist={["*"]}
        onMessage={handleMessage}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color="#3b82f6" />
          </View>
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { width: "100%", overflow: "hidden", borderRadius: 12 },
  webview: { flex: 1, backgroundColor: "#0f172a" },
  loading: {
    position: "absolute", inset: 0, alignItems: "center", justifyContent: "center",
    backgroundColor: "#0f172a",
  },
});
