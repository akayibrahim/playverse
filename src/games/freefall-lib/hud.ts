/**
 * FREEFALL: HUD, menus and touch layer (plain DOM). Shares the NEXUS design tokens (HUD_CSS).
 */
import { HUD_CSS } from "../nexus-lib/hud";

const FF_CSS = `
.ff-root{--c:#38bdf8;--c2:#0e7ab8;}
.ff-root .nx-h1 span{color:var(--c);}
.ff-root .nx-feed{top:122px;left:20px;right:auto;align-items:flex-start;}
.ff-root .nx-hint{bottom:178px;}
.ff-speedlines{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(255,255,255,0) 0deg 3deg,rgba(190,235,255,.10) 3deg 3.35deg);
  -webkit-mask-image:radial-gradient(ellipse at 50% 50%,transparent 30%,#000 78%);mask-image:radial-gradient(ellipse at 50% 50%,transparent 30%,#000 78%);}
.ff-score{position:absolute;left:20px;top:18px;padding:10px 16px 11px;min-width:210px;border-left:2px solid var(--c);}
.ff-score .k{font-size:9px;color:var(--d);letter-spacing:.24em;display:flex;justify-content:space-between;gap:16px;white-space:nowrap;}
.ff-score .k b{color:var(--c);font-weight:500;}
.ff-score .v{margin-top:4px;font:800 34px/1 var(--sans);letter-spacing:-.01em;color:#f4fbfd;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:10px;}
.ff-score .v i{font:800 16px var(--sans);font-style:normal;color:var(--a);}
.ff-score .s{margin-top:7px;font-size:10px;color:#a9bbc8;display:flex;justify-content:space-between;gap:12px;}
.ff-score .s b{color:#e2eef3;font-weight:500;}
.ff-alt{position:absolute;right:20px;top:64px;width:170px;text-align:right;}
.ff-alt .k{font-size:9px;color:var(--d);letter-spacing:.3em;}
.ff-alt .v{margin-top:2px;font:800 54px/1 var(--sans);letter-spacing:-.03em;color:#f4fbfd;font-variant-numeric:tabular-nums;text-shadow:0 0 18px rgba(56,189,248,.35);}
.ff-alt .v small{font:600 14px var(--sans);color:var(--d);margin-left:4px;letter-spacing:.1em;}
.ff-alt .tape{position:absolute;right:0;top:92px;width:6px;height:230px;background:rgba(255,255,255,.1);}
.ff-alt .tape i{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(0deg,#ffb547,var(--c));height:0;}
.ff-alt .tape b{position:absolute;right:10px;width:10px;height:10px;margin-bottom:-5px;background:#fff;clip-path:polygon(0 50%,100% 0,100% 100%);}
.ff-alt .tape u{position:absolute;right:-5px;width:16px;height:2px;background:var(--r);box-shadow:0 0 8px var(--r);}
.ff-alt .need{margin-top:10px;margin-right:22px;font-size:9px;letter-spacing:.22em;color:var(--d);height:14px;}
.ff-alt .need.on{color:var(--a);}
.ff-alt .need.bad{color:var(--r);animation:nxPulse .5s infinite;}
.ff-spd{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);width:300px;text-align:center;}
.ff-spd .v{font:800 52px/1 var(--sans);letter-spacing:-.02em;color:#f4fbfd;text-shadow:0 0 18px rgba(56,189,248,.35);font-variant-numeric:tabular-nums;}
.ff-spd .u{font-size:9px;color:var(--d);letter-spacing:.34em;margin-top:4px;}
.ff-spd .rows{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;text-align:left;}
.ff-spd .bar{position:relative;height:5px;background:rgba(255,255,255,.1);}
.ff-spd .bar i{display:block;height:100%;width:0;}
.ff-spd .bar.f i{background:linear-gradient(90deg,#ffb547,#ff3fc8);box-shadow:0 0 10px #ff3fc8;}
.ff-spd .bar.b i{background:linear-gradient(90deg,#38bdf8,#9fe4ff);}
.ff-spd .bar b{position:absolute;left:0;top:-13px;font-size:8px;font-weight:500;color:var(--d);letter-spacing:.28em;}
.ff-spd .gl{margin-top:12px;display:flex;justify-content:center;gap:22px;font-size:10px;color:#a9bbc8;}
.ff-spd .gl b{color:#e2eef3;font-weight:500;}
.ff-root.boosting .ff-spd .v{color:#ffd7f5;text-shadow:0 0 22px rgba(255,63,200,.8);}
.ff-root.stall .ff-spd .v{color:#ff9aa2;}
.ff-prox{position:absolute;left:50%;top:18px;transform:translateX(-50%);width:230px;text-align:center;opacity:.0;transition:opacity .2s;}
.ff-prox.on{opacity:1;}
.ff-prox .t{font:800 13px var(--sans);letter-spacing:.34em;color:var(--a);text-shadow:0 0 12px rgba(255,181,71,.6);}
.ff-prox .t b{font:800 22px var(--sans);letter-spacing:0;margin-left:8px;color:#fff;}
.ff-prox .bar{margin-top:7px;height:4px;background:rgba(255,255,255,.12);}
.ff-prox .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--a),#ff3fc8);box-shadow:0 0 12px var(--a);}
.ff-prox .pts{margin-top:6px;font-size:10px;color:#ffe0b0;letter-spacing:.2em;}
.ff-delta{position:absolute;left:50%;top:104px;transform:translateX(-50%);font:700 22px var(--sans);letter-spacing:.04em;opacity:0;transition:opacity .3s;text-shadow:0 2px 10px rgba(0,0,0,.7);font-variant-numeric:tabular-nums;}
.ff-delta.on{opacity:1;}
.ff-delta.good{color:#7dffb0;}
.ff-delta.bad{color:#ff6b74;}
.ff-warn{position:absolute;left:50%;top:30%;transform:translateX(-50%);font:800 15px var(--sans);letter-spacing:.3em;color:var(--r);opacity:0;transition:opacity .2s;text-shadow:0 0 12px rgba(255,77,92,.7);white-space:nowrap;text-align:center;}
.ff-warn.on{opacity:1;animation:nxPulse .6s infinite;}
.ff-warn small{display:block;margin-top:6px;font:500 10px var(--mono);letter-spacing:.24em;color:#ffc2c8;}
.ff-count{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;}
.ff-count b{font:900 clamp(80px,16vw,180px)/1 var(--sans);color:#fff;letter-spacing:-.04em;opacity:0;text-shadow:0 0 40px rgba(56,189,248,.7);}
.ff-count b.on{animation:ffCount .9s ease-out both;}
.ff-count b.go{color:var(--c);}
@keyframes ffCount{0%{opacity:0;transform:scale(1.6)}15%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(.9)}}
.ff-ring{position:absolute;left:0;top:0;width:0;height:0;display:none;}
.ff-ring .d{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border:2px solid var(--c);transform:rotate(45deg);box-shadow:0 0 10px rgba(56,189,248,.6);}
.ff-ring .l{position:absolute;left:-40px;top:14px;width:80px;text-align:center;font-size:10px;color:#dff4ff;text-shadow:0 1px 3px #000;letter-spacing:.14em;}
.ff-ring .a{position:absolute;left:-12px;top:-14px;width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:22px solid var(--c);filter:drop-shadow(0 0 8px var(--c));display:none;}
.ff-ring.edge .d{display:none;}
.ff-ring.edge .a{display:block;}
.ff-ring.edge .l{top:20px;}
.ff-chute-hint{position:absolute;left:50%;bottom:236px;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .2s;pointer-events:none;}
.ff-chute-hint.on{opacity:1;}
.ff-chute-hint b{display:block;font:800 22px var(--sans);letter-spacing:.2em;color:#fff;text-shadow:0 0 16px rgba(255,181,71,.8);}
.ff-chute-hint span{display:block;margin-top:6px;font-size:10px;color:var(--a);letter-spacing:.24em;}
.ff-chute-hint.now b{color:var(--r);animation:nxPulse .35s infinite;}
.ff-tb{display:none;position:absolute;pointer-events:auto;touch-action:none;place-items:center;border-radius:50%;
  font:700 10px var(--mono);letter-spacing:.14em;color:#e2eff2;border:1px solid rgba(180,225,230,.35);
  background:rgba(6,16,22,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.nx-root.mobile .ff-tb{display:grid;}
.ff-tb.on{background:rgba(40,130,190,.6);border-color:var(--c);}
.ff-tb.boost{right:calc(18px + env(safe-area-inset-right));bottom:30px;width:84px;height:84px;background:rgba(120,30,90,.45);border-color:rgba(255,63,200,.6);}
.ff-tb.boost.on{background:rgba(200,50,160,.65);}
.ff-tb.pull{right:calc(18px + env(safe-area-inset-right));bottom:132px;width:96px;height:96px;font-size:12px;background:rgba(150,90,10,.45);border-color:rgba(255,181,71,.7);}
.ff-tb.pull.on{background:rgba(230,150,30,.7);}
.ff-tb.brake{right:calc(116px + env(safe-area-inset-right));bottom:30px;width:70px;height:70px;}
.ff-stick{position:absolute;display:none;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:1px solid rgba(180,225,230,.35);background:rgba(6,16,22,.25);pointer-events:none;}
.ff-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(56,189,248,.5);border:1px solid var(--c);}
.ff-stick.on{display:block;}
.ff-modes{margin-top:16px;display:flex;flex-direction:column;gap:6px;}
.ff-mode{pointer-events:auto;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;text-align:left;
  padding:12px 14px;font:inherit;color:inherit;background:rgba(255,255,255,.035);border:1px solid rgba(160,210,220,.14);border-left:2px solid rgba(56,189,248,.4);}
.ff-mode.on{border-color:var(--c);background:rgba(20,70,110,.4);}
.ff-mode .t{font:700 13px var(--sans);letter-spacing:.14em;color:#eef6f8;}
.ff-mode .s{margin-top:3px;font:400 11px/1.45 var(--sans);letter-spacing:0;text-transform:none;color:#a9bbc8;}
.ff-mode .md{text-align:right;font-size:9px;color:var(--d);line-height:1.7;}
.ff-mode .md b{font:700 13px var(--sans);color:var(--c);letter-spacing:0;}
.ff-bd{margin:14px auto 0;max-width:420px;display:flex;flex-direction:column;gap:2px;}
.ff-bd div{display:flex;justify-content:space-between;padding:6px 12px;background:rgba(255,255,255,.035);font-size:10px;color:#cfdde5;}
.ff-bd div b{font:700 12px var(--sans);color:#fff;font-variant-numeric:tabular-nums;letter-spacing:0;}
.ff-bd div.t{background:rgba(56,189,248,.12);box-shadow:inset 3px 0 0 var(--c);}
.ff-bd div.neg b{color:var(--r);}
.ff-credit{margin-top:12px;font-size:9px;color:var(--d);}
@media (max-width:760px),(pointer:coarse){
  .ff-score{left:calc(10px + env(safe-area-inset-left));top:8px;min-width:140px;padding:6px 10px;}
  .ff-score .v{font-size:22px;margin-top:2px;}
  .ff-score .s{margin-top:4px;font-size:9px;}
  .ff-alt{right:calc(10px + env(safe-area-inset-right));top:54px;width:130px;}
  .ff-alt .v{font-size:36px;}
  .ff-alt .tape{display:none;}
  .ff-alt .need{margin-right:0;}
  .ff-spd{bottom:auto;top:8px;left:50%;width:150px;}
  .ff-spd .v{font-size:30px;}
  .ff-spd .rows{display:none;}
  .ff-spd .gl{display:none;}
  .ff-prox{top:70px;width:180px;}
  .ff-prox .pts{display:none;}
  .ff-root .nx-feed{top:76px;left:calc(10px + env(safe-area-inset-left));}
  .ff-root .nx-hint{bottom:64px;}
  .ff-chute-hint{bottom:38%;}
  .ff-delta{top:122px;}
}
@media (pointer:coarse) and (orientation:portrait){
  .ff-tb.boost{bottom:24px;}
  .ff-tb.pull{bottom:116px;}
  .ff-tb.brake{right:calc(110px + env(safe-area-inset-right));bottom:24px;}
  .ff-score{min-width:120px;}
  .ff-alt{top:46px;}
  /* portrait: speed goes bottom-left (buttons are bottom-right), tips sit mid-screen and wrap */
  .ff-spd{top:auto;bottom:calc(22px + env(safe-area-inset-bottom));left:calc(14px + env(safe-area-inset-left));transform:none;width:auto;text-align:left;}
  .ff-spd .v{font-size:34px;}
  .ff-root .nx-hint{bottom:auto;top:22%;width:max-content;max-width:86%;flex-wrap:wrap;justify-content:center;text-align:center;}
  .ff-root .nx-hint span{flex-wrap:wrap;justify-content:center;white-space:normal;line-height:1.7;}
  .ff-score .k .sd{display:none;}
  .ff-alt .k{visibility:hidden;}
  .ff-spd .rows{display:grid;grid-template-columns:1fr;width:96px;margin-top:16px;}
  .ff-spd .rows .bar.b{display:none;}
}
@media (max-height:560px){
  .ff-root .nx-sub,.ff-root .nx-ctrl,.ff-mode .s{display:none;}
  .ff-root .nx-h1{font-size:30px;margin-top:4px;}
  .ff-modes{margin-top:8px;}
  .ff-mode{padding:7px 11px;}
  .ff-root .nx-actions{margin-top:12px;}
  .ff-alt .v{font-size:30px;}
  .ff-tb.pull{bottom:100px;width:80px;height:80px;}
  .ff-tb.boost{width:70px;height:70px;bottom:18px;}
  .ff-tb.brake{width:58px;height:58px;bottom:18px;right:calc(100px + env(safe-area-inset-right));}
}
`;

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function buildFfHud(container: HTMLElement, mobile: boolean) {
  const style = document.createElement("style");
  style.textContent = HUD_CSS + FF_CSS;
  container.appendChild(style);
  const root = document.createElement("div");
  root.className = "nx-root ff-root" + (mobile ? " mobile" : "");
  root.dataset.mode = "menu";
  root.innerHTML = `
  <div class="ff-speedlines"></div>
  <div class="nx-hud">
    <div class="ff-score nx-panelbg"><div class="k"><span class="sd">DAILY</span><b class="md">0/0</b></div>
      <div class="v"><span class="sc">0</span><i class="mul">×1</i></div>
      <div class="s"><span>STREAK <b class="st">0</b></span><span>BEST <b class="bs">—</b></span></div></div>
    <div class="ff-prox"><div class="t">PROXIMITY<b class="px">×1</b></div><div class="bar"><i></i></div><div class="pts"></div></div>
    <div class="ff-alt"><div class="k">ALTITUDE</div><div class="v"><span class="av">2000</span><small>M</small></div>
      <div class="need"></div><div class="tape"><i></i><u></u><b></b></div></div>
    <div class="ff-spd"><div class="v">0</div><div class="u">KM/H</div>
      <div class="rows"><div class="bar f"><b>FUEL</b><i></i></div><div class="bar b"><b>AIR-BRAKE</b><i></i></div></div>
      <div class="gl"><span>GLIDE <b class="ga">—</b></span><span><b class="gg">1.0</b> G</span></div></div>
    <div class="ff-ring"><div class="d"></div><div class="a"></div><div class="l"></div></div>
    <div class="ff-delta"></div>
    <div class="ff-warn"></div>
    <div class="ff-chute-hint"><b></b><span></span></div>
    <div class="nx-sys"><button type="button" class="nx-panelbg" data-act="mute" title="Sound on/off (M)">🔊</button>
      <button type="button" class="nx-panelbg" data-act="pause" title="Pause (P)">❚❚</button>
      <button type="button" class="nx-panelbg" data-act="fs" title="Fullscreen (F)">⛶</button></div>
    <div class="nx-feed"></div>
    <div class="nx-banner"><div class="k"></div><div class="t"></div><div class="s"></div></div>
    <div class="nx-hint nx-panelbg"></div>
    <div class="nx-medal"></div>
    <div class="ff-count"><b></b></div>
  </div>
  <div class="nx-touch">
    <div class="ff-stick"><i></i></div>
    <button type="button" class="ff-tb boost">BOOST</button>
    <button type="button" class="ff-tb brake">BRAKE</button>
    <button type="button" class="ff-tb pull">PULL<br>CHUTE</button>
  </div>
  <div class="nx-ov"></div>`;
  container.appendChild(root);
  return {
    style,
    root,
    seed: q(root, ".ff-score .sd"),
    ringK: q(root, ".ff-score .md"),
    score: q(root, ".ff-score .sc"),
    mul: q(root, ".ff-score .mul"),
    streak: q(root, ".ff-score .st"),
    best: q(root, ".ff-score .bs"),
    prox: q(root, ".ff-prox"),
    proxN: q(root, ".ff-prox .px"),
    proxBar: q(root, ".ff-prox .bar i"),
    proxPts: q(root, ".ff-prox .pts"),
    alt: q(root, ".ff-alt .av"),
    need: q(root, ".ff-alt .need"),
    tapeFill: q(root, ".ff-alt .tape i"),
    tapeMark: q(root, ".ff-alt .tape b"),
    tapeNeed: q(root, ".ff-alt .tape u"),
    spd: q(root, ".ff-spd .v"),
    fuel: q(root, ".ff-spd .bar.f i"),
    brake: q(root, ".ff-spd .bar.b i"),
    glide: q(root, ".ff-spd .ga"),
    gload: q(root, ".ff-spd .gg"),
    ringInd: q(root, ".ff-ring"),
    ringLbl: q(root, ".ff-ring .l"),
    delta: q(root, ".ff-delta"),
    warn: q(root, ".ff-warn"),
    chuteHint: q(root, ".ff-chute-hint"),
    chuteHintT: q(root, ".ff-chute-hint b"),
    chuteHintS: q(root, ".ff-chute-hint span"),
    sys: q(root, ".nx-sys"),
    feed: q(root, ".nx-feed"),
    banner: q(root, ".nx-banner"),
    hint: q(root, ".nx-hint"),
    medal: q(root, ".nx-medal"),
    count: q(root, ".ff-count b"),
    lines: q(root, ".ff-speedlines"),
    stick: q(root, ".ff-stick"),
    stickKnob: q(root, ".ff-stick i"),
    tBoost: q(root, ".ff-tb.boost"),
    tBrake: q(root, ".ff-tb.brake"),
    tPull: q(root, ".ff-tb.pull"),
    overlay: q(root, ".nx-ov"),
  };
}
