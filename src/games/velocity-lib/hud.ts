/**
 * VELOCITY — race HUD (plain DOM). Shares NEXUS design tokens + menu components (HUD_CSS).
 */
import { HUD_CSS } from "../nexus-lib/hud";

const VL_CSS = `
.vl-root{--c:#35f0ff;}
.vl-root .nx-feed{top:auto;bottom:200px;}
.vl-spd{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);width:260px;height:150px;text-align:center;}
.vl-spd svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.vl-spd .v{position:absolute;left:0;right:0;top:58px;font:800 54px/1 var(--sans);letter-spacing:-.02em;color:#f4fbfd;
  text-shadow:0 0 18px rgba(53,240,255,.35);}
.vl-spd .u{position:absolute;left:0;right:0;top:114px;font-size:9px;color:var(--d);letter-spacing:.34em;}
.vl-spd .bst{position:absolute;left:40px;right:40px;bottom:0;height:5px;background:rgba(255,255,255,.1);}
.vl-spd .bst i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffb547,#ff3fc8);box-shadow:0 0 12px #ff3fc8;}
.vl-spd .bst b{position:absolute;right:0;top:-14px;font-size:8px;font-weight:500;color:var(--a);letter-spacing:.3em;}
.vl-root.boosting .vl-spd .v{color:#ffd7f5;text-shadow:0 0 22px rgba(255,63,200,.8);}
.vl-lap{position:absolute;left:20px;top:18px;padding:10px 14px 11px;min-width:210px;border-left:2px solid var(--c);}
.vl-lap .k{font-size:9px;color:var(--d);letter-spacing:.28em;display:flex;justify-content:space-between;}
.vl-lap .k b{color:var(--c);font-weight:500;}
.vl-lap .t{margin-top:4px;font:700 26px/1 var(--sans);letter-spacing:0;color:#f2f8fa;font-variant-numeric:tabular-nums;}
.vl-lap .s{margin-top:6px;font-size:10px;color:#a9bbc8;display:flex;justify-content:space-between;gap:10px;}
.vl-lap .s span:last-child{color:#cfe3ea;}
.vl-pos{position:absolute;right:20px;top:66px;text-align:right;}
.vl-pos .p{font:800 56px/1 var(--sans);color:#fff;letter-spacing:-.03em;}
.vl-pos .p small{font:600 18px var(--sans);color:var(--d);margin-left:2px;}
.vl-pos .l{margin-top:6px;display:flex;flex-direction:column;gap:2px;align-items:flex-end;}
.vl-pos .l div{font-size:9px;color:#b9cad4;display:flex;gap:8px;}
.vl-pos .l div.me{color:var(--c);}
.vl-pos .l div i{font-style:normal;width:7px;height:7px;margin-top:2px;}
.vl-delta{position:absolute;left:50%;top:22%;transform:translateX(-50%);font:700 22px var(--sans);letter-spacing:.04em;opacity:0;
  transition:opacity .3s;text-shadow:0 2px 10px rgba(0,0,0,.7);font-variant-numeric:tabular-nums;}
.vl-delta.on{opacity:1;}
.vl-delta.good{color:#7dffb0;}
.vl-delta.bad{color:#ff6b74;}
.vl-map{position:absolute;right:20px;bottom:22px;width:170px;height:170px;padding:8px;}
.vl-map svg{width:100%;height:100%;overflow:visible;}
.vl-count{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;}
.vl-count b{font:900 clamp(80px,16vw,180px)/1 var(--sans);color:#fff;letter-spacing:-.04em;opacity:0;text-shadow:0 0 40px rgba(53,240,255,.6);}
.vl-count b.on{animation:vlCount .9s ease-out both;}
.vl-count b.go{color:var(--c);}
@keyframes vlCount{0%{opacity:0;transform:scale(1.6)}15%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(.9)}}
.vl-warn{position:absolute;left:50%;top:34%;transform:translateX(-50%);font:800 16px var(--sans);letter-spacing:.3em;color:var(--r);
  opacity:0;transition:opacity .2s;text-shadow:0 0 12px rgba(255,77,92,.7);}
.vl-warn.on{opacity:1;animation:nxPulse .6s infinite;}
.vl-speedlines{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:repeating-conic-gradient(from 0deg at 50% 52%,rgba(255,255,255,.0) 0deg 3deg,rgba(200,240,255,.09) 3deg 3.4deg);
  -webkit-mask-image:radial-gradient(ellipse at 50% 52%,transparent 32%,#000 75%);mask-image:radial-gradient(ellipse at 50% 52%,transparent 32%,#000 75%);}
.vl-tracks{margin-top:18px;display:flex;flex-direction:column;gap:6px;}
.vl-track{pointer-events:auto;cursor:pointer;display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;text-align:left;
  padding:11px 13px;font:inherit;color:inherit;background:rgba(255,255,255,.035);border:1px solid rgba(160,210,220,.14);
  border-left:2px solid rgba(53,240,255,.35);}
.vl-track.on{border-color:var(--c);background:rgba(20,70,80,.4);}
.vl-track.lock{opacity:.5;cursor:not-allowed;}
.vl-track b.n{font:700 16px var(--sans);color:var(--c);}
.vl-track .t{font:700 13px var(--sans);letter-spacing:.12em;color:#eef6f8;}
.vl-track .s{margin-top:3px;font:400 11px/1.45 var(--sans);letter-spacing:0;text-transform:none;color:#a9bbc8;}
.vl-track.lock .s{color:var(--a);}
.vl-track .md{text-align:right;font-size:9px;color:var(--d);line-height:1.6;}
.vl-track .md b{font-weight:600;}
.vl-modes{margin-top:12px;display:flex;gap:6px;}
.vl-modes button{pointer-events:auto;cursor:pointer;flex:1;padding:10px;font:inherit;font-size:10px;letter-spacing:.2em;color:var(--d);
  background:rgba(255,255,255,.03);border:1px solid rgba(160,210,220,.15);text-align:left;}
.vl-modes button b{display:block;font:700 12px var(--sans);letter-spacing:.14em;color:#dfe9ee;margin-bottom:3px;}
.vl-modes button.on{border-color:var(--c);background:rgba(53,240,255,.08);}
.vl-modes button.on b{color:var(--c);}
.vl-medal{display:inline-flex;align-items:center;gap:6px;}
.vl-medal i{width:9px;height:9px;border-radius:50%;display:inline-block;}
.vl-res{margin:14px auto 0;max-width:440px;display:flex;flex-direction:column;gap:2px;}
.vl-res div{display:grid;grid-template-columns:30px 1fr auto;gap:10px;padding:7px 12px;background:rgba(255,255,255,.035);font-size:11px;color:#d7e3ea;text-align:left;}
.vl-res div.me{background:rgba(53,240,255,.12);box-shadow:inset 3px 0 0 var(--c);}
.vl-res b{font:700 12px var(--sans);font-variant-numeric:tabular-nums;}
.vl-tb{display:none;position:absolute;pointer-events:auto;touch-action:none;place-items:center;border-radius:14px;
  font:600 10px var(--mono);letter-spacing:.14em;color:#e2eff2;border:1px solid rgba(180,225,230,.35);
  background:rgba(6,16,22,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.nx-root.mobile .vl-tb{display:grid;}
.vl-tb.on{background:rgba(40,130,140,.6);border-color:var(--c);}
.vl-tb.l{left:calc(16px + env(safe-area-inset-left));bottom:24px;width:96px;height:96px;font-size:26px;}
.vl-tb.r{left:calc(124px + env(safe-area-inset-left));bottom:24px;width:96px;height:96px;font-size:26px;}
.vl-tb.bst{right:calc(16px + env(safe-area-inset-right));bottom:24px;width:96px;height:96px;background:rgba(120,30,90,.45);border-color:rgba(255,63,200,.6);}
.vl-tb.bst.on{background:rgba(200,50,160,.65);}
.vl-tb.dr{right:calc(124px + env(safe-area-inset-right));bottom:24px;width:80px;height:80px;}
.vl-tb.brk{right:calc(16px + env(safe-area-inset-right));bottom:132px;width:80px;height:56px;}
@media (max-width:760px),(pointer:coarse){
  .vl-spd{bottom:auto;top:8px;width:190px;height:110px;}
  .vl-spd .v{top:40px;font-size:38px;}
  .vl-spd .u{top:80px;}
  .vl-map{display:none;}
  .vl-pos{top:8px;right:calc(150px + env(safe-area-inset-right));}
  .vl-pos .p{font-size:34px;}
  .vl-pos .l{display:none;}
  .vl-lap{left:calc(10px + env(safe-area-inset-left));top:8px;min-width:150px;padding:6px 10px;}
  .vl-lap .t{font-size:18px;}
}
@media (max-height:560px){
  .vl-root .nx-sub,.vl-root .nx-ctrl,.vl-root .vl-track .s{display:none;}
  .vl-root .nx-h1{font-size:30px;margin-top:4px;}
  .vl-tracks{margin-top:10px;}
  .vl-track{padding:7px 11px;}
  .vl-modes{margin-top:8px;}
  .vl-modes button{padding:7px;}
  .vl-root .nx-actions{margin-top:12px;}
}
`;

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function buildVlHud(container: HTMLElement, mobile: boolean) {
  const style = document.createElement("style");
  style.textContent = HUD_CSS + VL_CSS;
  container.appendChild(style);
  const root = document.createElement("div");
  root.className = "nx-root vl-root" + (mobile ? " mobile" : "");
  root.dataset.mode = "menu";
  root.innerHTML = `
  <div class="vl-speedlines"></div>
  <div class="nx-hud">
    <div class="vl-lap nx-panelbg"><div class="k"><span class="lp">LAP 1/3</span><b class="md">RACE</b></div>
      <div class="t">0:00.00</div><div class="s"><span class="bl">BEST —</span><span class="ll">LAST —</span></div></div>
    <div class="vl-pos"><div class="p">1<small>/6</small></div><div class="l"></div></div>
    <div class="vl-delta"></div>
    <div class="vl-warn">WALL</div>
    <div class="vl-spd"><svg viewBox="0 0 260 150"><path d="M30 130 A100 100 0 1 1 230 130" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="6" stroke-linecap="round"/>
      <path class="arc" d="M30 130 A100 100 0 1 1 230 130" fill="none" stroke="url(#vlg)" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>
      <defs><linearGradient id="vlg" x1="0" x2="1"><stop offset="0" stop-color="#35f0ff"/><stop offset=".75" stop-color="#9a5cff"/><stop offset="1" stop-color="#ff3fc8"/></linearGradient></defs></svg>
      <div class="v">0</div><div class="u">KM/H</div><div class="bst"><b>BOOST</b><i></i></div></div>
    <div class="vl-map nx-panelbg"><svg class="mp" viewBox="0 0 100 100"></svg></div>
    <div class="nx-sys"><button type="button" class="nx-panelbg" data-act="mute" title="Sound on/off (M)">🔊</button>
      <button type="button" class="nx-panelbg" data-act="pause" title="Pause (P)">❚❚</button>
      <button type="button" class="nx-panelbg" data-act="fs" title="Fullscreen (F)">⛶</button></div>
    <div class="nx-feed"></div>
    <div class="nx-banner"><div class="k"></div><div class="t"></div><div class="s"></div></div>
    <div class="nx-hint nx-panelbg"></div>
    <div class="nx-medal"></div>
    <div class="vl-count"><b></b></div>
  </div>
  <div class="nx-touch">
    <button type="button" class="vl-tb l">◀</button>
    <button type="button" class="vl-tb r">▶</button>
    <button type="button" class="vl-tb bst">BOOST</button>
    <button type="button" class="vl-tb dr">DRIFT</button>
    <button type="button" class="vl-tb brk">BRAKE</button>
  </div>
  <div class="nx-ov"></div>
  <div class="nx-rotate"><div class="ph"></div><b>ROTATE DEVICE</b><span>VELOCITY PLAYS IN LANDSCAPE</span></div>`;
  container.appendChild(root);
  return {
    style,
    root,
    lapK: q(root, ".vl-lap .lp"),
    modeK: q(root, ".vl-lap .md"),
    lapT: q(root, ".vl-lap .t"),
    best: q(root, ".vl-lap .bl"),
    last: q(root, ".vl-lap .ll"),
    pos: q(root, ".vl-pos .p"),
    posList: q(root, ".vl-pos .l"),
    posWrap: q(root, ".vl-pos"),
    delta: q(root, ".vl-delta"),
    warn: q(root, ".vl-warn"),
    spd: q(root, ".vl-spd .v"),
    arc: root.querySelector(".vl-spd .arc") as SVGPathElement,
    boost: q(root, ".vl-spd .bst i"),
    map: root.querySelector(".vl-map .mp") as SVGSVGElement,
    sys: q(root, ".nx-sys"),
    feed: q(root, ".nx-feed"),
    banner: q(root, ".nx-banner"),
    hint: q(root, ".nx-hint"),
    medal: q(root, ".nx-medal"),
    count: q(root, ".vl-count b"),
    lines: q(root, ".vl-speedlines"),
    tL: q(root, ".vl-tb.l"),
    tR: q(root, ".vl-tb.r"),
    tBoost: q(root, ".vl-tb.bst"),
    tDrift: q(root, ".vl-tb.dr"),
    tBrake: q(root, ".vl-tb.brk"),
    overlay: q(root, ".nx-ov"),
  };
}
