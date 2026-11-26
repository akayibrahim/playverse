/** OVERRIDE — DOM HUD, menus and touch layer (plain DOM, self-contained CSS). */

const CSS = `
.ov{--c:#fb7185;--c2:#35f0ff;--a:#ffb547;--g:#7dffb0;--t:#e6eef5;--d:#8a93a6;--p:rgba(8,6,14,.66);
  --mono:var(--font-geist-mono),ui-monospace,SFMono-Regular,Menlo,monospace;--sans:var(--font-geist-sans),system-ui,sans-serif;
  position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;color:var(--t);font-family:var(--mono);font-size:11px;
  letter-spacing:.12em;text-transform:uppercase;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
.ov *{box-sizing:border-box;}
.ov .pn{background:var(--p);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);border:1px solid rgba(255,160,190,.14);}
.ov-hud{position:absolute;inset:0;transition:opacity .3s;}
.ov[data-mode=menu] .ov-hud,.ov[data-mode=menu] .ov-touch,.ov[data-mode=results] .ov-hud,.ov[data-mode=results] .ov-touch{opacity:0;display:none;}
.ov-obj{position:absolute;left:18px;top:16px;min-width:230px;max-width:300px;padding:10px 14px 11px;border-left:2px solid var(--c);}
.ov-obj .k{font-size:9px;color:var(--d);letter-spacing:.28em;display:flex;justify-content:space-between;gap:14px;}
.ov-obj .k b{color:var(--c);font-weight:500;}
.ov-obj .t{margin-top:5px;font:700 14px/1.2 var(--sans);letter-spacing:.05em;color:#f6f2f8;}
.ov-obj .s{margin-top:6px;font-size:10px;color:#b3b8c8;display:flex;gap:12px;}
.ov-obj .s b{color:#fff;font-weight:600;}
.ov-det{position:absolute;left:50%;top:16px;transform:translateX(-50%);width:min(320px,42vw);text-align:center;}
.ov-det .l{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.3em;color:var(--d);margin-bottom:5px;}
.ov-det .l b{font-weight:600;color:var(--g);}
.ov-det .bar{position:relative;height:8px;background:rgba(255,255,255,.1);overflow:hidden;clip-path:polygon(0 0,100% 0,calc(100% - 6px) 100%,6px 100%);}
.ov-det .bar i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#7dffb0,#ffb547 55%,#ff4d5c);box-shadow:0 0 14px currentColor;}
.ov-det.warn .l b{color:var(--a);}
.ov-det.alert .l b{color:#ff4d5c;animation:ovPulse .5s infinite;}
.ov-det .vis{margin-top:6px;font-size:8px;letter-spacing:.3em;color:#7b8498;}
.ov-det .vis b{color:#cfd6e4;font-weight:500;}
.ov-bat{position:absolute;right:18px;top:62px;width:200px;padding:9px 12px;}
.ov-bat .k{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.26em;color:var(--d);}
.ov-bat .k b{font:700 13px var(--sans);color:#fff;letter-spacing:.04em;}
.ov-bat .bar{margin-top:6px;height:6px;display:flex;gap:2px;}
.ov-bat .bar i{flex:1;background:rgba(255,255,255,.12);}
.ov-bat .bar i.on{background:var(--c2);box-shadow:0 0 6px var(--c2);}
.ov-bat.low .bar i.on{background:#ff4d5c;box-shadow:0 0 6px #ff4d5c;}
.ov-bat.low .k b{color:#ff7a80;animation:ovPulse .6s infinite;}
.ov-bat.chg .bar i.on{background:var(--g);box-shadow:0 0 6px var(--g);}
.ov-sys{position:absolute;right:18px;top:16px;display:flex;gap:6px;pointer-events:auto;}
.ov-sys button{width:34px;height:34px;padding:0;display:grid;place-items:center;cursor:pointer;color:#d8dfec;font:600 14px var(--sans);}
.ov-sys button:hover{border-color:var(--c);color:var(--c);}
.ov-sys button.off{color:#ff4d5c;}
.ov-map{position:absolute;left:18px;bottom:18px;padding:6px;}
.ov-map canvas{display:block;width:176px;height:132px;}
.ov-prompt{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);display:none;padding:9px 16px;text-align:center;white-space:nowrap;}
.ov-prompt.on{display:block;}
.ov-prompt .tx{font-size:11px;letter-spacing:.18em;color:#f2f2f8;}
.ov-prompt kbd{font:700 11px var(--mono);padding:2px 7px;margin-right:8px;border:1px solid var(--c);color:var(--c);background:rgba(251,113,133,.1);}
.ov-prompt .bar{margin-top:7px;height:3px;background:rgba(255,255,255,.12);display:none;}
.ov-prompt.prog .bar{display:block;}
.ov-prompt .bar i{display:block;height:100%;width:0;background:var(--c);box-shadow:0 0 10px var(--c);}
.ov-ret{position:absolute;left:50%;top:50%;width:0;height:0;}
.ov-ret i{position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.75);box-shadow:0 0 6px rgba(0,0,0,.8);}
.ov-ret.tgt i{background:var(--c);box-shadow:0 0 10px var(--c);}
.ov-tgt{position:absolute;left:0;top:0;width:54px;height:54px;margin:-27px 0 0 -27px;display:none;pointer-events:none;will-change:transform;}
.ov-tgt.on{display:block;}
.ov-tgt svg{width:100%;height:100%;overflow:visible;}
.ov-tgt .br{fill:none;stroke:var(--c2);stroke-width:2;}
.ov-tgt .rg{fill:none;stroke:var(--c);stroke-width:3;stroke-linecap:round;transform:rotate(-90deg);transform-origin:27px 27px;filter:drop-shadow(0 0 4px var(--c));}
.ov-tgt.bad .br{stroke:#ff4d5c;}
.ov-tgt .nm{position:absolute;left:50%;top:60px;transform:translateX(-50%);font-size:9px;letter-spacing:.2em;white-space:nowrap;color:#e6f6ff;text-shadow:0 1px 4px #000;}
.ov-lock{position:absolute;left:50%;top:78px;transform:translateX(-50%);display:none;text-align:center;}
.ov-lock.on{display:block;}
.ov-lock .a{font:800 17px var(--sans);letter-spacing:.34em;color:#ff4d5c;text-shadow:0 0 16px rgba(255,77,92,.7);animation:ovPulse .6s infinite;}
.ov-lock .b{margin-top:2px;font:800 40px/1 var(--sans);letter-spacing:.02em;color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 0 18px rgba(255,77,92,.6);}
.ov-lock .c{margin-top:2px;font-size:9px;letter-spacing:.3em;color:#ffb3b8;}
.ov-alarmv{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s;
  background:radial-gradient(ellipse at 50% 50%,transparent 45%,rgba(255,40,70,.5) 100%);}
.ov-alarmv.on{opacity:1;animation:ovPulse .7s infinite;}
.ov-feed{position:absolute;right:18px;top:128px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;}
.ov-feed div{padding:5px 10px;font-size:10px;color:#e1e6f0;background:rgba(8,6,14,.62);border-right:2px solid var(--c2);animation:ovIn .2s ease-out both;transition:opacity .4s;}
.ov-feed div.bad{border-right-color:#ff4d5c;color:#ffc2c8;}
.ov-feed div.good{border-right-color:var(--g);}
.ov-banner{position:absolute;left:50%;top:28%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .4s,transform .4s;pointer-events:none;width:min(560px,90vw);}
.ov-banner.on{opacity:1;transform:translateX(-50%) translateY(-6px);}
.ov-banner .k{font-size:10px;letter-spacing:.42em;color:var(--c);text-shadow:0 1px 3px #000;}
.ov-banner .t{margin-top:6px;font:800 clamp(24px,5vw,44px)/1 var(--sans);letter-spacing:.08em;color:#fff;text-shadow:0 2px 16px rgba(0,0,0,.7);}
.ov-banner .s{margin-top:8px;font-size:11px;color:#dfe5ee;text-shadow:0 1px 3px #000,0 0 12px rgba(0,0,0,.8);letter-spacing:.14em;}
.ov-hint{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);padding:9px 16px;opacity:0;transition:opacity .4s;max-width:min(560px,90vw);text-align:center;
  font-size:11px;letter-spacing:.14em;color:#eef2f8;border-bottom:2px solid var(--c);}
.ov-hint.on{opacity:1;}
.ov-cctv{position:absolute;inset:0;display:none;pointer-events:none;}
.ov[data-mode=cam] .ov-cctv{display:block;}
.ov-cctv .tl{position:absolute;left:22px;top:20px;font:600 15px var(--mono);color:#d6ffe8;text-shadow:0 0 8px rgba(120,255,190,.7);letter-spacing:.1em;}
.ov-cctv .tl i{display:inline-block;width:11px;height:11px;border-radius:50%;background:#ff3b4a;margin-right:10px;box-shadow:0 0 10px #ff3b4a;animation:ovPulse 1s infinite;}
.ov-cctv .tr{position:absolute;right:22px;top:66px;font:500 12px var(--mono);color:#d6ffe8;text-align:right;line-height:1.7;text-shadow:0 0 8px rgba(120,255,190,.5);}
.ov-cctv .bl{position:absolute;left:22px;bottom:150px;font:500 11px var(--mono);color:#d6ffe8;letter-spacing:.18em;line-height:1.7;}
.ov-cctv .br{position:absolute;right:22px;bottom:24px;width:230px;}
.ov-cctv .br .l{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.24em;color:#d6ffe8;}
.ov-cctv .br .bar{margin-top:5px;height:5px;background:rgba(214,255,232,.2);}
.ov-cctv .br .bar i{display:block;height:100%;width:100%;background:#7dffb0;box-shadow:0 0 10px #7dffb0;}
.ov-cctv .fr{position:absolute;inset:14px;border:1px solid rgba(214,255,232,.35);}
.ov-cctv .fr::before,.ov-cctv .fr::after{content:"";position:absolute;width:22px;height:22px;border:2px solid #d6ffe8;}
.ov-cctv .fr::before{left:-2px;top:-2px;border-right:0;border-bottom:0;}
.ov-cctv .fr::after{right:-2px;bottom:-2px;border-left:0;border-top:0;}
.ov-ridebar{position:absolute;left:50%;top:84px;transform:translateX(-50%);width:min(300px,60vw);display:none;text-align:center;}
.ov[data-mode=ride] .ov-ridebar{display:block;}
.ov-ridebar .l{font-size:10px;letter-spacing:.3em;color:var(--c2);}
.ov-ridebar .bar{margin-top:6px;height:5px;background:rgba(255,255,255,.14);}
.ov-ridebar .bar i{display:block;height:100%;width:100%;background:var(--c2);box-shadow:0 0 10px var(--c2);}
.ov[data-mode=ride] .ov-hud::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 120px rgba(53,240,255,.22);}
.ov[data-mode=cam] .ov-obj,.ov[data-mode=cam] .ov-det,.ov[data-mode=cam] .ov-bat{opacity:.0;}
/* screens */
.ov-scr{position:absolute;inset:0;z-index:8;display:none;pointer-events:auto;}
.ov-scr.on{display:block;}
.ov-scr.menu{background:linear-gradient(90deg,rgba(5,3,10,.95) 0%,rgba(5,3,10,.82) 38%,rgba(5,3,10,.06) 74%);}
.ov-scr.dim{background:rgba(4,2,8,.78);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);}
.ov-scr.load{background:radial-gradient(ellipse at 50% 45%,#150a1c,#050308 70%);}
.ov-col{position:absolute;left:0;top:0;bottom:0;width:min(520px,100%);padding:44px 40px 24px 48px;overflow:auto;pointer-events:auto;}
.ov-col::-webkit-scrollbar{width:0;}
.ov-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);text-align:center;max-height:96%;overflow:auto;}
.ov-eye{font-size:10px;letter-spacing:.42em;color:var(--c);}
.ov-h1{margin-top:10px;font:800 clamp(40px,7.4vw,76px)/.9 var(--sans);letter-spacing:-.01em;color:#fbf6fa;text-transform:none;}
.ov-h1 span{color:var(--c);text-shadow:0 0 24px rgba(251,113,133,.5);}
.ov-h2{font:800 clamp(24px,4.6vw,38px)/1 var(--sans);letter-spacing:.04em;color:#fff;margin-top:8px;}
.ov-sub{margin-top:12px;font:400 13px/1.65 var(--sans);letter-spacing:.01em;text-transform:none;color:#b3b9ca;max-width:430px;}
.ov-center .ov-sub{margin-left:auto;margin-right:auto;}
.ov-floors{margin-top:20px;display:flex;flex-direction:column;gap:7px;}
.ov-fl{pointer-events:auto;cursor:pointer;display:grid;grid-template-columns:46px 1fr auto;gap:12px;align-items:center;text-align:left;padding:11px 13px;
  font:inherit;color:inherit;background:rgba(255,255,255,.035);border:1px solid rgba(255,170,200,.13);border-left:2px solid rgba(251,113,133,.4);}
.ov-fl:hover{background:rgba(255,255,255,.07);}
.ov-fl.on{border-color:var(--c);background:rgba(120,30,60,.34);}
.ov-fl.lock{opacity:.45;cursor:not-allowed;}
.ov-fl .n{font:800 17px var(--sans);color:var(--c);letter-spacing:.02em;}
.ov-fl .t{font:700 13px var(--sans);letter-spacing:.14em;color:#f2eef6;}
.ov-fl .s{margin-top:3px;font:400 11px/1.4 var(--sans);letter-spacing:0;text-transform:none;color:#a9afc0;}
.ov-fl .g{text-align:right;font-size:9px;color:var(--d);line-height:1.6;}
.ov-fl .g b{display:block;font:800 22px var(--sans);color:#fff;letter-spacing:.02em;}
.ov-fl .g b.S{color:#ffd86b;text-shadow:0 0 12px rgba(255,200,80,.6);}
.ov-fl .g b.A{color:var(--g);}
.ov-fl .g b.B{color:var(--c2);}
.ov-fl .g b.C{color:#b8bccb;}
.ov-ctrl{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;}
.ov-ctrl div{display:flex;justify-content:space-between;gap:8px;font-size:9px;color:var(--d);padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.07);}
.ov-ctrl b{font-weight:500;color:#e2e6f0;}
.ov-act{margin-top:20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.ov-center .ov-act{justify-content:center;}
.ov-btn{pointer-events:auto;cursor:pointer;position:relative;padding:14px 30px;border:0;font:800 13px var(--sans);letter-spacing:.24em;text-transform:uppercase;
  color:#1a0710;background:var(--c);clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);transition:filter .15s,transform .1s;}
.ov-btn:hover{filter:brightness(1.12);}
.ov-btn:active{transform:translateY(1px);}
.ov-btn.ghost{background:transparent;color:#dfe4ee;box-shadow:inset 0 0 0 1px rgba(220,220,240,.3);clip-path:none;}
.ov-btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--c);color:var(--c);}
.ov-btn.sm{padding:9px 16px;font-size:10px;letter-spacing:.2em;}
.ov-load{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(360px,80vw);text-align:center;}
.ov-load .bar{margin-top:18px;height:2px;background:rgba(255,255,255,.1);}
.ov-load .bar i{display:block;height:100%;width:0;background:var(--c);box-shadow:0 0 12px var(--c);transition:width .25s;}
.ov-load .st{margin-top:10px;display:flex;justify-content:space-between;font-size:9px;color:var(--d);}
.ov-grade{margin:14px auto 0;font:900 clamp(80px,16vw,130px)/1 var(--sans);letter-spacing:-.03em;color:#fff;}
.ov-grade.S{color:#ffd86b;text-shadow:0 0 40px rgba(255,200,80,.6);}
.ov-grade.A{color:var(--g);text-shadow:0 0 30px rgba(125,255,176,.4);}
.ov-grade.B{color:var(--c2);}
.ov-grade.C{color:#c1c5d3;}
.ov-grade.F{color:#ff4d5c;font-size:clamp(50px,10vw,80px);}
.ov-stats{margin:16px auto 0;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;max-width:480px;}
.ov-stats div{padding:10px 6px;background:rgba(255,255,255,.04);}
.ov-stats b{display:block;font:700 17px var(--sans);letter-spacing:0;color:#f2f4f8;}
.ov-stats span{display:block;margin-top:3px;font-size:8px;color:var(--d);letter-spacing:.2em;}
.ov-stats b.hi{color:var(--g);}
.ov-stats b.lo{color:#ff8a92;}
.ov-pause .ov-fl{pointer-events:auto;}
.ov-obj-list{margin:16px auto 0;max-width:420px;text-align:left;display:flex;flex-direction:column;gap:6px;}
.ov-obj-list div{padding:8px 12px;font:500 12px var(--sans);letter-spacing:.02em;text-transform:none;background:rgba(255,255,255,.04);border-left:2px solid var(--d);color:#c5cad8;}
.ov-obj-list div.done{border-left-color:var(--g);color:var(--g);text-decoration:line-through;opacity:.8;}
.ov-obj-list div.cur{border-left-color:var(--c);color:#fff;background:rgba(251,113,133,.1);}
.ov-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;}
.ov-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .45s;z-index:7;}
.ov-fade.on{opacity:1;}
/* touch */
.ov-touch{display:none;position:absolute;inset:0;}
.ov.mobile .ov-touch{display:block;}
.ov-zone{position:absolute;pointer-events:auto;touch-action:none;}
.ov-zone.mv{left:0;bottom:0;width:46%;height:42%;}
.ov-zone.lk{right:0;top:12%;width:100%;height:60%;}
.ov-stick{position:absolute;width:110px;height:110px;margin:-55px 0 0 -55px;border-radius:50%;border:1px solid rgba(255,190,210,.4);background:rgba(10,6,16,.35);display:none;pointer-events:none;}
.ov-stick.on{display:block;}
.ov-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(251,113,133,.55);border:1px solid rgba(255,200,215,.7);}
.ov-tb{position:absolute;pointer-events:auto;touch-action:none;display:grid;place-items:center;border-radius:16px;font:700 11px var(--mono);letter-spacing:.14em;
  color:#f0e8f2;border:1px solid rgba(255,190,210,.4);background:rgba(10,6,16,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.ov-tb.on{background:rgba(251,113,133,.5);border-color:var(--c);}
.ov-tb.hk{right:calc(14px + env(safe-area-inset-right));bottom:28px;width:104px;height:104px;border-radius:50%;font-size:14px;background:rgba(160,30,70,.5);border-color:rgba(255,120,150,.8);}
.ov-tb.up{right:calc(132px + env(safe-area-inset-right));bottom:76px;width:62px;height:62px;font-size:20px;}
.ov-tb.dn{right:calc(132px + env(safe-area-inset-right));bottom:8px;width:62px;height:62px;font-size:20px;}
.ov-tb.ex{right:calc(14px + env(safe-area-inset-right));bottom:144px;width:78px;height:50px;}
.ov-tb.vw{right:calc(98px + env(safe-area-inset-right));bottom:144px;width:50px;height:50px;font-size:16px;}
.ov.mobile .ov-map{left:auto;right:18px;bottom:auto;top:260px;opacity:.9;}
.ov.mobile .ov-map canvas{width:110px;height:84px;}
.ov.mobile .ov-prompt{bottom:190px;}
.ov.mobile .ov-hint{bottom:210px;font-size:10px;}
.ov.mobile .ov-obj{left:10px;top:10px;min-width:0;max-width:56vw;padding:7px 10px;}
.ov.mobile .ov-obj .t{font-size:11px;}
.ov.mobile .ov-det{top:auto;bottom:auto;top:10px;left:auto;right:96px;transform:none;width:30vw;}
.ov.mobile .ov-det .vis{display:none;}
.ov.mobile .ov-bat{right:10px;top:54px;width:150px;padding:6px 9px;}
.ov.mobile .ov-sys{right:10px;top:10px;}
.ov.mobile .ov-sys button{width:30px;height:30px;}
.ov.mobile .ov-feed{top:96px;right:10px;}
.ov.mobile .ov-lock{top:116px;}
.ov.mobile .ov-col{padding:26px 18px 20px;width:100%;}
.ov.mobile .ov-scr.menu{background:linear-gradient(180deg,rgba(5,3,10,.9),rgba(5,3,10,.82));}
.ov.mobile .ov-ctrl{display:none;}
.ov.mobile .ov-cctv .bl{bottom:230px;}
.ov.mobile .ov-cctv .br{bottom:170px;right:14px;width:160px;}
.ov.mobile .ov-cctv .tr{top:96px;}
@media (max-height:520px){.ov-sub,.ov-ctrl{display:none;}.ov-h1{font-size:34px;}.ov-fl .s{display:none;}}
@keyframes ovPulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes ovIn{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
`;

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function buildOvHud(container: HTMLElement, mobile: boolean) {
  const style = document.createElement("style");
  style.textContent = CSS;
  container.appendChild(style);
  const root = document.createElement("div");
  root.className = "ov" + (mobile ? " mobile" : "");
  root.dataset.mode = "menu";
  const bat = Array.from({ length: 20 }, () => "<i></i>").join("");
  root.innerHTML = `
  <div class="ov-hud">
    <div class="ov-alarmv"></div>
    <div class="ov-obj pn"><div class="k"><span class="fl">12F · LOBBY</span><b class="md">DRONE</b></div><div class="t">—</div>
      <div class="s"><span>TIME <b class="tm">0:00</b></span><span>SEEN <b class="sn">0</b></span><span>HACKS <b class="hk">0</b></span></div></div>
    <div class="ov-det pn" style="padding:8px 12px 7px"><div class="l"><span>VISIBILITY</span><b class="st">HIDDEN</b></div><div class="bar"><i></i></div>
      <div class="vis">LIGHT <b class="lt">SHADOW</b></div></div>
    <div class="ov-sys"><button type="button" class="pn" data-act="mute" title="Sound (M)">🔊</button>
      <button type="button" class="pn" data-act="pause" title="Pause (P)">❚❚</button>
      <button type="button" class="pn" data-act="fs" title="Fullscreen (F)">⛶</button></div>
    <div class="ov-bat pn"><div class="k"><span>BATTERY</span><b class="bp">100%</b></div><div class="bar">${bat}</div></div>
    <div class="ov-feed"></div>
    <div class="ov-lock"><div class="a">LOCKDOWN</div><div class="b">0.0</div><div class="c">BREAK LINE OF SIGHT</div></div>
    <div class="ov-ret"><i></i></div>
    <div class="ov-tgt"><svg viewBox="0 0 54 54"><path class="br" d="M4 16V4h12M38 4h12v12M50 38v12H38M16 50H4V38"/><circle class="rg" cx="27" cy="27" r="19" pathLength="100" stroke-dasharray="0 100"/></svg><div class="nm"></div></div>
    <div class="ov-prompt pn"><div class="tx"></div><div class="bar"><i></i></div></div>
    <div class="ov-hint pn"></div>
    <div class="ov-banner"><div class="k"></div><div class="t"></div><div class="s"></div></div>
    <div class="ov-map pn"><canvas width="352" height="264"></canvas></div>
    <div class="ov-ridebar"><div class="l">RIDING <span class="rn"></span> · <span class="rt"></span></div><div class="bar"><i></i></div></div>
    <div class="ov-cctv"><div class="fr"></div><div class="tl"><i></i><span class="cn">CAM 01</span></div>
      <div class="tr"><div class="ts">00:00:00</div><div>HALDEN SEC-NET</div></div>
      <div class="bl">FEED LOOPED<br>SECURITY BLIND<br><span class="bt"></span></div>
      <div class="br"><div class="l"><span>JACK-IN LINK</span><span class="jt">10s</span></div><div class="bar"><i></i></div></div></div>
  </div>
  <div class="ov-touch">
    <div class="ov-zone mv"></div><div class="ov-zone lk"></div>
    <div class="ov-stick"><i></i></div>
    <button type="button" class="ov-tb up">▲</button><button type="button" class="ov-tb dn">▼</button>
    <button type="button" class="ov-tb hk">HACK</button><button type="button" class="ov-tb ex">EXIT</button><button type="button" class="ov-tb vw">👁</button>
  </div>
  <div class="ov-fade"></div><div class="ov-flash"></div>
  <div class="ov-scr"></div>`;
  container.appendChild(root);
  return {
    style,
    root,
    fl: q(root, ".ov-obj .fl"),
    md: q(root, ".ov-obj .md"),
    objT: q(root, ".ov-obj .t"),
    tm: q(root, ".ov-obj .tm"),
    sn: q(root, ".ov-obj .sn"),
    hk: q(root, ".ov-obj .hk"),
    det: q(root, ".ov-det"),
    detBar: q(root, ".ov-det .bar i"),
    detSt: q(root, ".ov-det .st"),
    detLt: q(root, ".ov-det .lt"),
    bat: q(root, ".ov-bat"),
    batP: q(root, ".ov-bat .bp"),
    batBars: Array.from(root.querySelectorAll(".ov-bat .bar i")) as HTMLElement[],
    feed: q(root, ".ov-feed"),
    lock: q(root, ".ov-lock"),
    lockB: q(root, ".ov-lock .b"),
    alarmV: q(root, ".ov-alarmv"),
    ret: q(root, ".ov-ret"),
    tgt: q(root, ".ov-tgt"),
    tgtRing: q(root, ".ov-tgt .rg") as unknown as SVGElement,
    tgtNm: q(root, ".ov-tgt .nm"),
    prompt: q(root, ".ov-prompt"),
    promptTx: q(root, ".ov-prompt .tx"),
    promptBar: q(root, ".ov-prompt .bar i"),
    hint: q(root, ".ov-hint"),
    banner: q(root, ".ov-banner"),
    map: q<HTMLCanvasElement>(root, ".ov-map canvas"),
    mapWrap: q(root, ".ov-map"),
    rideN: q(root, ".ov-ridebar .rn"),
    rideT: q(root, ".ov-ridebar .rt"),
    rideBar: q(root, ".ov-ridebar .bar i"),
    camN: q(root, ".ov-cctv .cn"),
    camTs: q(root, ".ov-cctv .ts"),
    camBt: q(root, ".ov-cctv .bt"),
    camJt: q(root, ".ov-cctv .jt"),
    camBar: q(root, ".ov-cctv .br .bar i"),
    sys: q(root, ".ov-sys"),
    zoneMv: q(root, ".ov-zone.mv"),
    zoneLk: q(root, ".ov-zone.lk"),
    stick: q(root, ".ov-stick"),
    tUp: q(root, ".ov-tb.up"),
    tDn: q(root, ".ov-tb.dn"),
    tHack: q(root, ".ov-tb.hk"),
    tExit: q(root, ".ov-tb.ex"),
    tView: q(root, ".ov-tb.vw"),
    fade: q(root, ".ov-fade"),
    flash: q(root, ".ov-flash"),
    scr: q(root, ".ov-scr"),
  };
}
export type OvHud = ReturnType<typeof buildOvHud>;
