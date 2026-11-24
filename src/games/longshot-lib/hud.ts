/**
 * LONGSHOT — HUD, scope overlay and touch layer (plain DOM).
 * Shares the NEXUS 2100 design tokens / menu components (HUD_CSS) and adds the marksman pieces.
 */
import { HUD_CSS } from "../nexus-lib/hud";

const LS_CSS = `
.ls-scope{position:absolute;inset:0;pointer-events:none;opacity:0;z-index:0;}
.ls-root.scoped .ls-scope{opacity:1;}
.ls-scope svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.ls-scope .glass{position:absolute;inset:0;
  background:radial-gradient(circle at 50% 50%,rgba(0,0,0,0) 0,rgba(0,0,0,0) var(--sr),rgba(0,0,0,.65) calc(var(--sr) + 2px),#000 calc(var(--sr) + 18px));}
.ls-scope .rim{position:absolute;left:50%;top:50%;width:calc(var(--sr)*2);height:calc(var(--sr)*2);transform:translate(-50%,-50%);
  border-radius:50%;box-shadow:inset 0 0 calc(var(--sr)*.28) rgba(0,0,0,.85),inset 0 0 0 1px rgba(255,255,255,.05);}
.ls-scope .tint{position:absolute;left:50%;top:50%;width:calc(var(--sr)*2);height:calc(var(--sr)*2);transform:translate(-50%,-50%);
  border-radius:50%;background:radial-gradient(circle at 38% 34%,rgba(140,220,255,.06),rgba(0,0,0,0) 45%);mix-blend-mode:screen;}
.ls-scope .rd{position:absolute;left:50%;top:calc(50% + var(--sr)*.52);transform:translateX(-50%);display:flex;gap:18px;
  font-size:10px;color:#cfe8ea;text-shadow:0 0 4px #000;}
.ls-scope .rd b{color:var(--c);font-weight:500;}
.ls-scope .rd .ws b{color:var(--a);}
.ls-scope .br{position:absolute;left:50%;top:calc(50% + var(--sr)*.62);width:120px;margin-left:-60px;height:3px;background:rgba(255,255,255,.12);}
.ls-scope .br i{display:block;height:100%;width:100%;background:#cfe8ea;transform-origin:left;}
.ls-scope .br.hold i{background:var(--c);box-shadow:0 0 8px var(--c);}
.ls-scope .br.out i{background:var(--r);}
.ls-scope .zm{position:absolute;left:calc(50% + var(--sr)*.62);top:50%;transform:translateY(-50%);font:700 13px var(--sans);
  letter-spacing:.1em;color:#d9eef0;text-shadow:0 0 4px #000;}
.ls-root.scoped .nx-cross{opacity:0;}
.ls-root.scoped .ls-view{opacity:0;}

.ls-wind{position:absolute;left:50%;top:16px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:7px 14px;}
.ls-wind .ar{width:34px;height:34px;position:relative;}
.ls-wind .ar svg{width:100%;height:100%;}
.ls-wind .v{font:700 18px/1 var(--sans);letter-spacing:0;color:#f2f8fa;}
.ls-wind .v small{font:500 9px var(--mono);color:var(--d);margin-left:4px;letter-spacing:.2em;}
.ls-wind .lb{font-size:8px;color:var(--d);letter-spacing:.3em;}
.ls-det{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:200px;text-align:center;}
.ls-det .k{font-size:8px;color:var(--d);letter-spacing:.3em;display:flex;justify-content:space-between;}
.ls-det .k b{font-weight:500;color:#cfe3ea;}
.ls-det .bar{margin-top:5px;height:3px;background:rgba(255,255,255,.1);}
.ls-det .bar i{display:block;height:100%;width:0;background:var(--a);transition:width .2s;}
.ls-det.hot .k b{color:var(--r);animation:nxPulse .8s infinite;}
.ls-det.hot .bar i{background:var(--r);box-shadow:0 0 8px var(--r);}

.ls-ammo{position:absolute;right:20px;bottom:20px;width:236px;padding:11px 14px 12px;text-align:right;}
.ls-ammo .nm{display:flex;justify-content:space-between;font-size:9px;color:var(--d);letter-spacing:.24em;}
.ls-ammo .nm b{color:var(--c);font-weight:500;}
.ls-ammo .rounds{margin-top:8px;display:flex;justify-content:flex-end;gap:5px;height:28px;align-items:flex-end;}
.ls-ammo .rounds i{width:7px;height:26px;background:linear-gradient(#e9c27a 0,#e9c27a 32%,#c79a45 33%,#a37a32 100%);
  clip-path:polygon(50% 0,100% 22%,100% 100%,0 100%,0 22%);}
.ls-ammo .rounds i.off{background:rgba(255,255,255,.1);}
.ls-ammo .rs{margin-top:6px;font-size:10px;color:#b9cad4;}
.ls-ammo .rs b{font:700 14px var(--sans);color:#f2f8fa;letter-spacing:0;margin-right:4px;}
.ls-ammo .st{margin-top:5px;height:2px;background:rgba(255,255,255,.08);}
.ls-ammo .st i{display:block;height:100%;width:0;background:var(--a);}
.ls-ammo .ky{margin-top:7px;font-size:9px;color:var(--d);}

.ls-vit{position:absolute;left:20px;bottom:20px;width:250px;padding:11px 14px 12px;}
.ls-vit .row{display:flex;justify-content:space-between;align-items:baseline;}
.ls-vit .lbl{font-size:9px;color:var(--d);letter-spacing:.24em;}
.ls-vit .hp{font:700 26px/1 var(--sans);letter-spacing:0;color:#f4f9fb;}
.ls-vit .hb{margin-top:7px;height:5px;background:rgba(255,255,255,.1);}
.ls-vit .hb i{display:block;height:100%;background:linear-gradient(90deg,#4fd3c4,#9ff7ea);transform-origin:left;}
.ls-vit.low .hb i{background:linear-gradient(90deg,#c43b46,#ff7a72);}
.ls-vit .cov{margin-top:7px;font-size:9px;color:var(--d);}
.ls-vit .cov b{font-weight:500;color:var(--c);}
.ls-vit.exposed .cov b{color:var(--a);}
.ls-vit .sq{margin-top:9px;padding-top:8px;border-top:1px solid rgba(160,200,210,.12);display:none;flex-direction:column;gap:5px;}
.ls-vit .sq.on{display:flex;}
.ls-vit .sq .m{display:grid;grid-template-columns:64px 1fr 40px;gap:8px;align-items:center;font-size:9px;color:#b8c9d4;}
.ls-vit .sq .m .b{height:3px;background:rgba(255,255,255,.1);}
.ls-vit .sq .m .b i{display:block;height:100%;background:#8fe3a8;}
.ls-vit .sq .m span:last-child{text-align:right;color:var(--d);}
.ls-vit .sq .m.down{color:var(--r);}
.ls-vit .sq .m.hit .b i{background:var(--a);}

.ls-view{position:absolute;inset:0;pointer-events:none;transition:opacity .12s;}
.ls-tag{position:absolute;transform:translate(-50%,-100%);display:none;text-align:center;font-size:9px;letter-spacing:.2em;white-space:nowrap;}
.ls-tag .d{width:10px;height:10px;margin:0 auto 3px;transform:rotate(45deg);border:2px solid var(--r);box-shadow:0 0 8px var(--r);}
.ls-tag.tgt .d{border-color:var(--a);background:rgba(255,181,71,.25);box-shadow:0 0 10px var(--a);}
.ls-tag.tgt{color:var(--a);}
.ls-tag.hos{color:var(--r);}
.ls-tag.ally{color:#8fe3a8;}
.ls-tag.ally .d{border-color:#8fe3a8;box-shadow:none;width:7px;height:7px;}
.ls-tag.ally.hurt{color:var(--a);}
.ls-tag.ally.hurt .d{border-color:var(--a);}
.ls-glint{position:absolute;transform:translate(-50%,-50%);display:none;width:34px;height:34px;border:2px solid #d2a6ff;border-radius:50%;
  box-shadow:0 0 14px #b36bff;animation:lsGl .5s ease-in-out infinite alternate;}
@keyframes lsGl{to{transform:translate(-50%,-50%) scale(1.25);opacity:.6}}

.ls-bc{position:absolute;inset:0;pointer-events:none;z-index:4;}
.ls-bc i{position:absolute;left:0;right:0;height:10%;background:#000;transform:scaleY(0);transition:transform .3s cubic-bezier(.2,.8,.2,1);}
.ls-bc i.t{top:0;transform-origin:top;}
.ls-bc i.b{bottom:0;transform-origin:bottom;}
.ls-bc .lb{position:absolute;left:5%;bottom:calc(10% + 16px);padding-left:12px;border-left:2px solid var(--a);opacity:0;transition:opacity .3s;}
.ls-bc .lb span{display:block;font-size:10px;letter-spacing:.42em;color:var(--a);}
.ls-bc .lb b{display:block;margin-top:4px;font:800 26px/1 var(--sans);letter-spacing:.08em;color:#f4f9fb;text-shadow:0 2px 12px rgba(0,0,0,.6);}
.ls-bc .lb em{display:block;margin-top:5px;font-style:normal;font-size:10px;letter-spacing:.24em;color:#cfe3ea;}
.ls-root.bulletcam .ls-bc i{transform:scaleY(1);}
.ls-root.bulletcam .ls-bc .lb{opacity:1;}
.ls-root.bulletcam .nx-hud > :not(.nx-feed):not(.nx-medal){opacity:0;}
.ls-root.bulletcam .ls-scope,.ls-root.bulletcam .nx-touch{opacity:0!important;pointer-events:none;}
.ls-root.ducked .ls-view{opacity:.35;}

.ls-cards{margin-top:18px;display:flex;flex-direction:column;gap:6px;}
.ls-card{pointer-events:auto;cursor:pointer;display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center;text-align:left;
  padding:11px 13px;font:inherit;color:inherit;background:rgba(255,255,255,.035);border:1px solid rgba(160,210,220,.14);
  border-left:2px solid rgba(111,242,227,.35);transition:border-color .15s,background .15s;}
.ls-card:hover:not(.lock){border-color:var(--c);}
.ls-card.on{border-color:var(--c);background:rgba(20,70,70,.4);}
.ls-card b.n{font:700 16px var(--sans);color:var(--c);letter-spacing:0;}
.ls-card .t{font:700 13px var(--sans);letter-spacing:.12em;color:#eef6f8;}
.ls-card .s{margin-top:3px;font:400 11px/1.45 var(--sans);letter-spacing:0;text-transform:none;color:#a9bbc8;}
.ls-card .st{font-size:13px;letter-spacing:2px;color:rgba(255,255,255,.18);white-space:nowrap;}
.ls-card .st i{font-style:normal;}
.ls-card .st i.on{color:var(--a);text-shadow:0 0 6px rgba(255,181,71,.6);}
.ls-card.lock{opacity:.5;cursor:not-allowed;}
.ls-card.lock .s{color:var(--a);}
.ls-brief{margin-top:14px;padding:12px 14px;border:1px solid rgba(160,210,220,.16);background:rgba(5,11,17,.5);text-align:left;}
.ls-brief .k{font-size:9px;color:var(--d);letter-spacing:.3em;}
.ls-brief p{margin:6px 0 0;font:400 13px/1.6 var(--sans);letter-spacing:0;text-transform:none;color:#c6d4dd;}
.ls-brief ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;}
.ls-brief li{font-size:10px;color:#d3e2e9;}
.ls-brief li::before{content:"◆ ";color:var(--a);}
.ls-brief .id{margin-top:10px;display:flex;gap:10px;align-items:center;padding:8px 10px;background:rgba(255,181,71,.08);border-left:2px solid var(--a);}
.ls-brief .id b{font-size:10px;color:var(--a);font-weight:500;}
.ls-brief .id span{font:400 12px/1.45 var(--sans);letter-spacing:0;text-transform:none;color:#e6dcc8;}

.ls-hold{position:absolute;left:50%;top:calc(50% + 70px);transform:translateX(-50%);font-size:9px;color:var(--d);display:none;}
.nx-root.mobile .ls-tb{display:grid;}
.ls-tb{display:none;position:absolute;pointer-events:auto;touch-action:none;place-items:center;border-radius:50%;
  font:600 9px var(--mono);letter-spacing:.14em;color:#e2eff2;border:1px solid rgba(180,225,230,.35);
  background:rgba(6,16,22,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.ls-tb.fire{right:calc(26px + env(safe-area-inset-right));top:calc(50% - 30px);width:84px;height:84px;background:rgba(120,30,36,.45);border-color:rgba(255,120,120,.6);font-size:10px;}
.ls-tb.fire.on{background:rgba(200,50,60,.6);}
.ls-tb.scp{right:calc(124px + env(safe-area-inset-right));top:calc(50% - 64px);width:58px;height:58px;}
.ls-tb.scp.on{background:rgba(40,130,125,.6);border-color:var(--c);}
.ls-tb.br{left:calc(26px + env(safe-area-inset-left));bottom:28px;width:64px;height:64px;}
.ls-tb.br.on{background:rgba(40,130,125,.6);border-color:var(--c);}
.ls-tb.zm{right:calc(124px + env(safe-area-inset-right));top:calc(50% + 12px);width:48px;height:48px;}
.ls-tb.rl{right:calc(46px + env(safe-area-inset-right));top:calc(50% + 70px);width:44px;height:44px;}
.ls-tb.dk{left:calc(104px + env(safe-area-inset-left));bottom:36px;width:48px;height:48px;font-size:14px;}
.ls-tb.dk.on{background:rgba(40,130,125,.6);border-color:var(--c);}
@media (max-height:560px){
  .ls-root .nx-sub,.ls-root .ls-brief p,.ls-root .nx-ctrl,.ls-root .ls-card .s{display:none;}
  .ls-root .nx-h1{font-size:30px;margin-top:4px;}
  .ls-cards{margin-top:10px;gap:4px;}
  .ls-card{padding:7px 11px;}
  .ls-brief{margin-top:8px;padding:8px 12px;}
  .ls-brief ul{margin-top:2px;}
  .ls-root .nx-actions{margin-top:12px;}
}
@media (max-width:760px),(pointer:coarse){
  .ls-wind{top:8px;padding:5px 10px;}
  .ls-wind .ar{width:26px;height:26px;}
  .ls-det{top:54px;width:160px;}
  .ls-ammo{bottom:auto;top:12px;right:calc(108px + env(safe-area-inset-right));width:auto;padding:6px 10px;}
  .ls-ammo .rounds{height:18px;margin-top:4px;}
  .ls-ammo .rounds i{height:16px;width:5px;}
  .ls-ammo .ky,.ls-ammo .nm{display:none;}
  .ls-vit{left:calc(10px + env(safe-area-inset-left));bottom:auto;top:96px;width:180px;padding:7px 10px;}
  .ls-vit .hp{font-size:18px;}
  .nx-root.mobile .nx-obj{top:8px;}
}
`;

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function buildLsHud(container: HTMLElement, mobile: boolean) {
  const style = document.createElement("style");
  style.textContent = HUD_CSS + LS_CSS;
  container.appendChild(style);
  const root = document.createElement("div");
  root.className = "nx-root ls-root" + (mobile ? " mobile" : "");
  root.dataset.mode = "menu";
  root.innerHTML = `
  <div class="nx-blood"></div>
  <div class="ls-scope"><div class="glass"></div><div class="tint"></div><div class="rim"></div>
    <svg class="ret" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="zm">×8</div>
    <div class="rd"><span class="rg">RNG <b>—</b></span><span class="ws">WIND <b>0.0</b></span><span class="el">HOLD <b>0.0</b></span></div>
    <div class="br"><i></i></div></div>
  <div class="ls-bc"><i class="t"></i><i class="b"></i><div class="lb"><span>◉ BULLET CAM</span><b>TARGET DOWN</b><em></em></div></div>
  <div class="nx-hud">
    <div class="ls-view"></div>
    <div class="nx-obj nx-panelbg"><div class="k"><span class="ph">CONTRACT 1</span><b class="st">ACTIVE</b></div>
      <div class="t">SENTRY LINE</div><div class="s">HOSTILES 5</div><div class="bar"><i></i></div></div>
    <div class="ls-wind nx-panelbg"><div class="ar"><svg viewBox="-20 -20 40 40"><circle r="17" fill="none" stroke="rgba(200,230,235,.25)"/>
      <path class="aw" d="M0,-13 L6,4 L0,0 L-6,4 Z" fill="#ffb547"/></svg></div>
      <div><div class="lb">WIND</div><div class="v"><span class="wv">0.0</span><small>M/S</small></div></div></div>
    <div class="ls-det"><div class="k"><span>DETECTION</span><b class="dt">HIDDEN</b></div><div class="bar"><i></i></div></div>
    <div class="nx-sys"><button type="button" class="nx-panelbg" data-act="mute" title="Sound on/off (M)">🔊</button>
      <button type="button" class="nx-panelbg" data-act="pause" title="Pause (P)">❚❚</button>
      <button type="button" class="nx-panelbg" data-act="fs" title="Fullscreen (F)">⛶</button></div>
    <div class="nx-feed"></div>
    <div class="ls-vit nx-panelbg"><div class="row"><span class="lbl">VITALS</span><span class="hp">100</span></div>
      <div class="hb"><i></i></div><div class="cov">POSITION · <b>CONCEALED</b></div><div class="sq"></div></div>
    <div class="ls-ammo nx-panelbg"><div class="nm"><span>VX-9 · MARKSMAN</span><b class="md">BOLT</b></div>
      <div class="rounds"></div><div class="rs"><b class="rv">15</b>RESERVE</div><div class="st"><i></i></div>
      <div class="ky">Q SCOPE · SCROLL ZOOM · SHIFT BREATH</div></div>
    <div class="nx-cross"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="nx-hit"><i></i><i></i><i></i><i></i></div>
    <div class="nx-pops"></div>
    <div class="nx-banner"><div class="k"></div><div class="t"></div><div class="s"></div></div>
    <div class="nx-hint nx-panelbg"></div>
    <div class="nx-medal"></div>
    <div class="ls-glint"></div>
  </div>
  <div class="nx-touch">
    <button type="button" class="ls-tb fire">FIRE</button>
    <button type="button" class="ls-tb scp">SCOPE</button>
    <button type="button" class="ls-tb zm">×8</button>
    <button type="button" class="ls-tb rl">R</button>
    <button type="button" class="ls-tb br">BREATH</button>
    <button type="button" class="ls-tb dk">▾</button>
  </div>
  <div class="nx-ov"></div>
  <div class="nx-rotate"><div class="ph"></div><b>ROTATE DEVICE</b><span>LONGSHOT PLAYS IN LANDSCAPE</span></div>`;
  container.appendChild(root);
  return {
    style,
    root,
    hud: q(root, ".nx-hud"),
    view: q(root, ".ls-view"),
    scope: q(root, ".ls-scope"),
    ret: root.querySelector(".ret") as SVGSVGElement,
    zoomLbl: q(root, ".ls-scope .zm"),
    rng: q(root, ".ls-scope .rg b"),
    wsRd: q(root, ".ls-scope .ws b"),
    holdRd: q(root, ".ls-scope .el b"),
    breathBar: q(root, ".ls-scope .br"),
    breathFill: q(root, ".ls-scope .br i"),
    obj: q(root, ".nx-obj"),
    objPh: q(root, ".nx-obj .ph"),
    objSt: q(root, ".nx-obj .st"),
    objT: q(root, ".nx-obj .t"),
    objS: q(root, ".nx-obj .s"),
    objBar: q(root, ".nx-obj .bar"),
    objFill: q(root, ".nx-obj .bar i"),
    windArrow: root.querySelector(".aw") as SVGPathElement,
    windV: q(root, ".wv"),
    det: q(root, ".ls-det"),
    detT: q(root, ".ls-det .dt"),
    detFill: q(root, ".ls-det .bar i"),
    sys: q(root, ".nx-sys"),
    feed: q(root, ".nx-feed"),
    vit: q(root, ".ls-vit"),
    hp: q(root, ".ls-vit .hp"),
    hpFill: q(root, ".ls-vit .hb i"),
    cov: q(root, ".ls-vit .cov b"),
    squad: q(root, ".ls-vit .sq"),
    ammo: q(root, ".ls-ammo"),
    rounds: q(root, ".ls-ammo .rounds"),
    reserve: q(root, ".ls-ammo .rv"),
    boltFill: q(root, ".ls-ammo .st i"),
    mode: q(root, ".ls-ammo .md"),
    cross: q(root, ".nx-cross"),
    hit: q(root, ".nx-hit"),
    pops: q(root, ".nx-pops"),
    banner: q(root, ".nx-banner"),
    hint: q(root, ".nx-hint"),
    medal: q(root, ".nx-medal"),
    glint: q(root, ".ls-glint"),
    bcSub: q(root, ".ls-bc .lb em"),
    bcTitle: q(root, ".ls-bc .lb b"),
    tFire: q(root, ".ls-tb.fire"),
    tScope: q(root, ".ls-tb.scp"),
    tZoom: q(root, ".ls-tb.zm"),
    tReload: q(root, ".ls-tb.rl"),
    tBreath: q(root, ".ls-tb.br"),
    tDuck: q(root, ".ls-tb.dk"),
    touch: q(root, ".nx-touch"),
    overlay: q(root, ".nx-ov"),
  };
}

export type LsHud = ReturnType<typeof buildLsHud>;
