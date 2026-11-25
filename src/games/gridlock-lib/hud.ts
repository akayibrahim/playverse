/** GRIDLOCK — HUD, menus and overlays (plain DOM). Accent #4ade80 over the District 07 neon palette. */
import { TOWERS, TOWER_ORDER, TOTAL_WAVES } from "./data";

export const ICONS: Record<string, string> = {
  pulse: `<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5"/>`,
  arc: `<path d="M13.5 2 5 13.5h6.2L10 22l9-12.2h-6.4z"/>`,
  emp: `<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="10" stroke-dasharray="3 3"/>`,
  rail: `<path d="M3 21 20 4"/><path d="M13.5 3.5H20.5V10.5"/><path d="M6 14l4 4"/>`,
  flak: `<path d="M12 2.5l2.2 6.6 6.8 2.9-6.8 2.9L12 21.5l-2.2-6.6L3 12l6.8-2.9z"/>`,
};
export const icon = (id: string, color: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] ?? ""}</svg>`;

const CSS = `
.gl-root{--g:#4ade80;--c:#35f0ff;--m:#ff3fc8;--a:#ffb547;--r:#ff4d5c;--t:#dce7ee;--d:#7c91a1;--p:rgba(5,11,17,.7);
  --mono:var(--font-geist-mono),ui-monospace,SFMono-Regular,Menlo,monospace;--sans:var(--font-geist-sans),system-ui,sans-serif;
  position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;color:var(--t);font-family:var(--mono);font-size:11px;
  letter-spacing:.12em;text-transform:uppercase;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
.gl-root *{box-sizing:border-box;}
.gl-root button{font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;}
.gl-pb{background:var(--p);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);border:1px solid rgba(140,200,210,.15);}
.gl-hud{position:absolute;inset:0;transition:opacity .35s;}
.gl-root[data-mode=menu] .gl-hud,.gl-root[data-mode=results] .gl-hud{opacity:0;pointer-events:none;}
.gl-root[data-mode=menu] .gl-hud *,.gl-root[data-mode=results] .gl-hud *{pointer-events:none!important;}

/* status (top-left) */
.gl-stat{position:absolute;left:14px;top:12px;display:flex;gap:2px;pointer-events:auto;}
.gl-cell{padding:8px 13px 9px;min-width:84px;border-left:2px solid var(--g);}
.gl-cell .k{font-size:8.5px;color:var(--d);letter-spacing:.26em;}
.gl-cell .v{margin-top:3px;font:800 22px/1 var(--sans);letter-spacing:0;color:#f4fbf7;font-variant-numeric:tabular-nums;}
.gl-cell.core{min-width:150px;}
.gl-cell.core .v small{font:600 11px var(--sans);color:var(--d);margin-left:3px;}
.gl-cell.core .pips{margin-top:6px;display:flex;gap:2px;}
.gl-cell.core .pips i{flex:1;height:5px;background:rgba(255,255,255,.12);transition:background .2s,box-shadow .2s;}
.gl-cell.core .pips i.on{background:var(--g);box-shadow:0 0 6px var(--g);}
.gl-cell.core.low .pips i.on{background:var(--r);box-shadow:0 0 6px var(--r);}
.gl-cell.core.low .v{color:var(--r);}
.gl-cell.cr{border-left-color:var(--a);}
.gl-cell.cr .v{color:#ffe2a8;}
.gl-cell.cr.bump .v{animation:glBump .3s;}
@keyframes glBump{40%{transform:scale(1.18);color:#fff}}
.gl-cell.sc{border-left-color:var(--c);}

/* wave panel (top-centre) */
.gl-wave{position:absolute;left:50%;top:12px;transform:translateX(-50%);min-width:300px;max-width:min(560px,calc(100vw - 560px));padding:8px 14px 9px;text-align:center;pointer-events:auto;}
.gl-wave .k{font-size:8.5px;color:var(--d);letter-spacing:.3em;}
.gl-wave .t{margin-top:3px;font:800 19px/1 var(--sans);letter-spacing:.04em;color:#f4fbf7;}
.gl-wave .t b{color:var(--g);font-weight:800;}
.gl-wave .s{margin-top:4px;font-size:9.5px;color:#b3c4cf;letter-spacing:.14em;}
.gl-wave .prev{margin-top:7px;display:flex;gap:5px;justify-content:center;flex-wrap:wrap;}
.gl-wave .prev span{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;background:rgba(255,255,255,.06);font-size:9.5px;color:#e6eef2;}
.gl-wave .prev span i{width:8px;height:8px;border-radius:2px;display:inline-block;}
.gl-wave .prev span.air::after{content:"AIR";font-size:7.5px;color:var(--m);margin-left:2px;}
.gl-wave .prog{margin-top:7px;height:3px;background:rgba(255,255,255,.1);}
.gl-wave .prog i{display:block;height:100%;width:0;background:var(--g);box-shadow:0 0 8px var(--g);}
.gl-boss{display:none;margin-top:8px;text-align:center;}
.gl-boss.on{display:block;}
.gl-boss .n{font:800 11px var(--sans);letter-spacing:.34em;color:var(--r);text-shadow:0 0 10px rgba(255,77,92,.6);}
.gl-boss .b{margin-top:5px;height:7px;background:rgba(255,255,255,.12);border:1px solid rgba(255,77,92,.45);}
.gl-boss .b i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#ff2a3a,#ff7a4d);box-shadow:0 0 10px #ff2a3a;}

/* system (top-right) */
.gl-sys{position:absolute;right:14px;top:12px;display:flex;gap:6px;pointer-events:auto;}
.gl-sys button{pointer-events:auto;cursor:pointer;min-width:42px;height:42px;padding:0 10px;display:grid;place-items:center;font:700 12px var(--sans);letter-spacing:.06em;}
.gl-sys button:hover{border-color:var(--g);color:var(--g);}
.gl-sys button.on{border-color:var(--g);color:var(--g);}
.gl-sys .spd{min-width:54px;}

/* build bar (bottom) */
.gl-bar{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;padding:6px;pointer-events:auto;}
.gl-tb{pointer-events:auto;cursor:pointer;position:relative;width:96px;padding:9px 8px 8px;text-align:left;background:rgba(255,255,255,.035);border:1px solid rgba(160,210,220,.14);border-top:2px solid var(--tc);}
.gl-tb:hover{background:rgba(255,255,255,.09);}
.gl-tb.on{background:rgba(74,222,128,.14);border-color:var(--g);box-shadow:0 0 14px rgba(74,222,128,.25);}
.gl-tb.poor{opacity:.5;}
.gl-tb .ic{display:flex;justify-content:space-between;align-items:center;}
.gl-tb .ic b{font:700 9px var(--mono);color:var(--d);border:1px solid rgba(255,255,255,.2);padding:0 4px;}
.gl-tb .nm{margin-top:6px;font:800 11px var(--sans);letter-spacing:.14em;color:#f2f8fa;}
.gl-tb .cs{margin-top:2px;font:600 12px var(--sans);letter-spacing:.04em;color:var(--a);}
.gl-tb .tg{margin-top:2px;font-size:7.5px;color:var(--d);letter-spacing:.14em;}
.gl-next{position:absolute;right:14px;bottom:14px;pointer-events:auto;cursor:pointer;padding:12px 20px 11px;min-width:176px;text-align:center;
  background:var(--g);color:#04210f;border:0;font:800 12px var(--sans);letter-spacing:.22em;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);}
.gl-next small{display:block;margin-top:3px;font:600 9px var(--mono);letter-spacing:.12em;opacity:.8;}
.gl-next:hover{filter:brightness(1.1);}
.gl-next.wait{background:#2a3b34;color:#9fe9bb;}
.gl-next.hold{opacity:.55;}
.gl-hint{position:absolute;left:50%;bottom:162px;transform:translateX(-50%);padding:7px 14px;font-size:10px;letter-spacing:.14em;color:#cfe3ea;opacity:0;transition:opacity .25s;white-space:nowrap;}
.gl-hint.on{opacity:1;}
.gl-hint b{color:var(--g);font-weight:600;}
.gl-hint.bad b{color:var(--r);}

/* selection panel (right) */
.gl-sel{position:absolute;right:14px;top:70px;width:272px;padding:12px 14px 14px;pointer-events:auto;display:none;border-top:2px solid var(--tc,var(--g));}
.gl-sel.on{display:block;animation:glIn .22s ease-out both;}
@keyframes glIn{from{opacity:0;transform:translateX(12px)}}
.gl-sel .hd{display:flex;align-items:center;gap:10px;}
.gl-sel .hd .nm{font:800 16px var(--sans);letter-spacing:.14em;color:#fff;}
.gl-sel .hd .tr{margin-left:auto;font:700 10px var(--mono);color:var(--tc);letter-spacing:.2em;}
.gl-sel .x{margin-left:6px;cursor:pointer;background:none;border:0;color:var(--d);font-size:16px;padding:0 4px;pointer-events:auto;}
.gl-sel .ds{margin-top:6px;font:400 11px/1.5 var(--sans);letter-spacing:.01em;text-transform:none;color:#a9bbc8;}
.gl-sel .st{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:5px;}
.gl-sel .st div{padding:5px 8px;background:rgba(255,255,255,.04);font-size:8.5px;color:var(--d);letter-spacing:.16em;}
.gl-sel .st div b{display:block;margin-top:2px;font:700 13px var(--sans);letter-spacing:.02em;color:#eaf4f6;}
.gl-sel .st div b em{font-style:normal;font-size:10px;color:var(--g);margin-left:4px;}
.gl-sel .ht{margin-top:7px;font-size:9px;color:var(--g);letter-spacing:.14em;}
.gl-sel .row{margin-top:10px;display:flex;gap:6px;}
.gl-sel .act{pointer-events:auto;cursor:pointer;flex:1;padding:10px 6px;text-align:center;font:700 10.5px var(--sans);letter-spacing:.14em;color:#e8f3f5;background:rgba(255,255,255,.06);border:1px solid rgba(160,210,220,.2);}
.gl-sel .act small{display:block;margin-top:2px;font:600 11px var(--mono);letter-spacing:.04em;color:var(--a);}
.gl-sel .act.up{background:rgba(74,222,128,.16);border-color:var(--g);}
.gl-sel .act.up small{color:#c8ffd9;}
.gl-sel .act.dis{opacity:.4;cursor:not-allowed;}
.gl-sel .act:hover:not(.dis){filter:brightness(1.25);}
.gl-sel .act.sell{flex:.7;}
.gl-sel .act.br{text-align:left;padding:8px 9px;}
.gl-sel .act.br b{display:block;font-size:10.5px;color:var(--tc);}
.gl-sel .act.br span{display:block;margin-top:3px;font:400 9.5px/1.35 var(--sans);letter-spacing:0;text-transform:none;color:#b8c8d2;}
.gl-sel .tgt{margin-top:10px;display:flex;gap:3px;}
.gl-sel .tgt button{pointer-events:auto;cursor:pointer;flex:1;padding:7px 2px;font:700 9px var(--mono);letter-spacing:.12em;color:var(--d);background:rgba(255,255,255,.03);border:1px solid rgba(160,210,220,.14);}
.gl-sel .tgt button.on{color:var(--g);border-color:var(--g);background:rgba(74,222,128,.1);}
.gl-sel .lbl{margin-top:10px;font-size:8.5px;color:var(--d);letter-spacing:.24em;}
.gl-sel .bl{margin-top:6px;display:flex;flex-direction:column;gap:5px;}
.gl-sel .bi{pointer-events:auto;cursor:pointer;display:grid;grid-template-columns:30px 1fr auto;gap:9px;align-items:center;padding:8px 10px;text-align:left;
  background:rgba(255,255,255,.04);border:1px solid rgba(160,210,220,.14);border-left:2px solid var(--tc);}
.gl-sel .bi:hover:not(.dis){background:rgba(255,255,255,.1);}
.gl-sel .bi b{font:800 12px var(--sans);letter-spacing:.12em;color:#fff;display:block;}
.gl-sel .bi span{font:400 9.5px/1.3 var(--sans);letter-spacing:0;text-transform:none;color:#9fb2bf;display:block;margin-top:1px;}
.gl-sel .bi em{font:700 13px var(--sans);font-style:normal;color:var(--a);letter-spacing:.02em;}
.gl-sel .bi.dis{opacity:.45;cursor:not-allowed;}

/* toasts */
.gl-feed{position:absolute;left:50%;top:26%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;}
.gl-feed div{font:800 15px var(--sans);letter-spacing:.24em;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.8);animation:glFeed 2.2s ease-out both;white-space:nowrap;}
.gl-feed div.g{color:var(--g);}.gl-feed div.r{color:var(--r);}.gl-feed div.a{color:var(--a);}.gl-feed div.big{font-size:26px;letter-spacing:.34em;}
@keyframes glFeed{0%{opacity:0;transform:translateY(10px) scale(.94)}12%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0;transform:translateY(-12px)}}
.gl-flash{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 50% 50%,transparent 45%,rgba(255,40,60,.55));}
.gl-flash.on{animation:glFlash .55s ease-out;}
@keyframes glFlash{0%{opacity:1}100%{opacity:0}}
.gl-tip{position:absolute;pointer-events:none;padding:4px 8px;font-size:9px;letter-spacing:.14em;background:rgba(5,11,17,.85);border:1px solid rgba(140,200,210,.25);white-space:nowrap;transform:translate(-50%,-140%);display:none;}
.gl-tip b{color:var(--a);font-weight:600;}

/* overlays */
.gl-ov{position:absolute;inset:0;z-index:8;display:none;pointer-events:auto;}
.gl-ov.on{display:block;}
.gl-ov.menu{background:linear-gradient(90deg,rgba(3,7,11,.95) 0%,rgba(3,7,11,.8) 38%,rgba(3,7,11,.04) 72%);}
.gl-ov.dim{background:rgba(3,7,11,.76);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);}
.gl-ov.load{background:radial-gradient(ellipse at 50% 45%,#0b1620,#03070b 70%);}
.gl-col{position:absolute;left:clamp(20px,6vw,84px);top:50%;transform:translateY(-50%);width:min(500px,calc(100% - 40px));max-height:calc(100% - 24px);overflow:auto;scrollbar-width:none;}
.gl-col::-webkit-scrollbar{display:none;}
.gl-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(540px,calc(100% - 28px));max-height:calc(100% - 20px);overflow:auto;scrollbar-width:none;text-align:center;}
.gl-center::-webkit-scrollbar{display:none;}
.gl-col>*,.gl-center>*{animation:glUp .45s ease-out both;}
.gl-col>*:nth-child(2),.gl-center>*:nth-child(2){animation-delay:.05s}.gl-col>*:nth-child(3),.gl-center>*:nth-child(3){animation-delay:.1s}
.gl-col>*:nth-child(4),.gl-center>*:nth-child(4){animation-delay:.15s}.gl-col>*:nth-child(5),.gl-center>*:nth-child(5){animation-delay:.2s}
@keyframes glUp{from{opacity:0;transform:translateY(14px)}}
.gl-kick{font-size:10px;letter-spacing:.42em;color:var(--g);}
.gl-kick.r{color:var(--r);}
.gl-h1{margin-top:12px;font:900 clamp(44px,8vw,84px)/.9 var(--sans);letter-spacing:-.01em;color:#f5fbf7;text-transform:none;}
.gl-h1 span{color:var(--g);text-shadow:0 0 28px rgba(74,222,128,.45);}
.gl-h2{margin-top:10px;font:800 clamp(28px,5vw,44px)/1 var(--sans);letter-spacing:.04em;color:#fff;}
.gl-sub{margin-top:14px;font:400 13.5px/1.65 var(--sans);letter-spacing:.01em;text-transform:none;color:#a9bccb;max-width:430px;}
.gl-center .gl-sub{margin-left:auto;margin-right:auto;}
.gl-modes{margin-top:18px;display:flex;gap:6px;}
.gl-modes button{pointer-events:auto;cursor:pointer;flex:1;padding:10px 12px;text-align:left;font-size:9px;letter-spacing:.18em;color:var(--d);
  background:rgba(255,255,255,.035);border:1px solid rgba(160,210,220,.15);}
.gl-modes button b{display:block;font:800 12px var(--sans);letter-spacing:.14em;color:#dfe9ee;margin-bottom:3px;}
.gl-modes button.on{border-color:var(--g);background:rgba(74,222,128,.09);}
.gl-modes button.on b{color:var(--g);}
.gl-modes button.lock{opacity:.5;cursor:not-allowed;}
.gl-keys{margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:5px 18px;}
.gl-keys div{display:flex;justify-content:space-between;gap:8px;font-size:9px;color:var(--d);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.06);}
.gl-keys b{font-weight:500;color:#dce8ee;}
.gl-acts{margin-top:20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.gl-center .gl-acts{justify-content:center;}
.gl-btn{pointer-events:auto;cursor:pointer;padding:14px 30px;border:0;background:var(--g);color:#04210f;font:800 12px var(--mono);letter-spacing:.3em;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);transition:filter .15s;}
.gl-btn:hover{filter:brightness(1.12);}
.gl-btn.ghost{background:transparent;color:#d6e4ea;box-shadow:inset 0 0 0 1px rgba(200,230,235,.3);clip-path:none;}
.gl-btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--g);color:var(--g);}
.gl-best{font-size:9.5px;color:var(--d);letter-spacing:.2em;}
.gl-best b{color:var(--a);font-weight:500;}
.gl-stars{margin-top:14px;font-size:42px;letter-spacing:.12em;color:#37424a;text-shadow:none;}
.gl-stars i{font-style:normal;margin:0 3px;display:inline-block;}
.gl-stars i.on{color:var(--a);text-shadow:0 0 18px rgba(255,181,71,.7);animation:glStar .6s ease-out both;}
@keyframes glStar{from{transform:scale(2.2);opacity:0}}
.gl-res{margin:16px auto 0;display:grid;grid-template-columns:1fr 1fr;gap:5px;max-width:400px;}
.gl-res div{padding:8px 12px;background:rgba(255,255,255,.04);text-align:left;font-size:8.5px;color:var(--d);letter-spacing:.2em;}
.gl-res div b{display:block;margin-top:3px;font:800 18px var(--sans);letter-spacing:0;color:#f2f9f5;font-variant-numeric:tabular-nums;}
.gl-res div.big{grid-column:1/-1;}
.gl-res div.big b{font-size:30px;color:var(--g);}
.gl-load{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(340px,80vw);text-align:center;}
.gl-load b{font:900 28px var(--sans);letter-spacing:.3em;color:#fff;}
.gl-load .bar{margin-top:16px;height:3px;background:rgba(255,255,255,.1);}
.gl-load .bar i{display:block;height:100%;width:8%;background:var(--g);box-shadow:0 0 10px var(--g);transition:width .25s;}
.gl-load span{display:block;margin-top:12px;font-size:9px;color:var(--d);letter-spacing:.3em;}
.gl-rot{display:none;}
.gl-tutor{position:absolute;left:50%;bottom:112px;transform:translateX(-50%);max-width:min(440px,calc(100vw - 28px));padding:10px 14px;text-align:center;font:500 12px/1.5 var(--sans);letter-spacing:.02em;text-transform:none;color:#e6f2ec;border-color:rgba(74,222,128,.5);display:none;pointer-events:none;}
.gl-tutor.on{display:block;animation:glIn .3s both;}
.gl-tutor b{color:var(--g);}

/* mobile / compact */
.gl-root.mobile .gl-bar{display:none;}
.gl-root.mobile .gl-hint{display:none;}
.gl-root.mobile .gl-keys{display:none;}
.gl-root.mobile .gl-sel{left:8px;right:8px;top:auto;bottom:8px;width:auto;border-top-width:2px;max-height:56%;overflow:auto;padding:10px 12px 12px;}
.gl-root.mobile .gl-sel .bl{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
.gl-root.mobile .gl-sel .bi{grid-template-columns:24px 1fr;padding:7px 8px;}
.gl-root.mobile .gl-sel .bi em{grid-column:2;margin-top:-2px;}
.gl-root.mobile .gl-sel .bi span{display:none;}
.gl-root.mobile .gl-sel .act{padding:13px 6px;}
.gl-root.mobile .gl-sel .tgt button{padding:11px 2px;}
.gl-root.mobile .gl-next{right:8px;bottom:8px;min-width:150px;padding:14px 16px 12px;}
.gl-root.mobile.sel .gl-next{bottom:auto;top:176px;}
.gl-root.mobile.sel .gl-tutor{display:none;}
@media (max-width:900px){
  .gl-wave{top:62px;max-width:calc(100vw - 20px);min-width:0;width:calc(100vw - 20px);}
  .gl-stat{left:8px;top:8px;}
  .gl-cell{min-width:0;padding:6px 9px 7px;}
  .gl-cell .v{font-size:17px;}
  .gl-cell.core{min-width:104px;}
  .gl-sys{right:8px;top:8px;gap:4px;}
  .gl-sys button{min-width:36px;height:36px;padding:0 6px;}
  .gl-tutor{top:150px;bottom:auto;}
  .gl-bar{bottom:8px;}
  .gl-tb{width:78px;padding:7px 6px;}
  .gl-tb .tg{display:none;}
  .gl-next{right:8px;bottom:84px;}
  .gl-hint{display:none;}
}
@media (max-width:560px){
  .gl-sys .hide-sm{display:none;}
  .gl-stat .gl-cell.sc{display:none;}
  .gl-cell.core{min-width:92px;}
  .gl-cell .k{letter-spacing:.12em;font-size:7.5px;}
  .gl-wave .prev span{padding:2px 5px;font-size:9px;}
  .gl-col{left:50%;transform:translate(-50%,-50%);}
  .gl-h1{font-size:50px;}
}
@media (max-height:520px){
  .gl-wave{top:8px;width:auto;min-width:220px;max-width:calc(100vw - 420px);padding:5px 10px 6px;}
  .gl-wave .t{font-size:15px;}
  .gl-wave .prev{margin-top:4px;}
  .gl-wave .prog{display:none;}
  .gl-sel{top:56px;width:250px;}
  .gl-root.mobile .gl-sel{left:auto;right:8px;top:56px;bottom:8px;width:290px;max-height:none;}
  .gl-root.mobile .gl-next{bottom:8px;right:8px;}
  .gl-root.mobile.sel .gl-next{top:auto;right:310px;}
  .gl-bar{bottom:6px;}.gl-h1{font-size:40px;margin-top:4px;}
  .gl-sub{display:none;}.gl-keys{display:none;}.gl-acts{margin-top:12px;}.gl-modes{margin-top:10px;}
  .gl-stars{font-size:30px;margin-top:6px;}.gl-res{margin-top:8px;}.gl-res div{padding:5px 10px;}.gl-res div b{font-size:15px;}
  .gl-tutor{top:90px;bottom:auto;}
}
`;

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function buildGlHud(container: HTMLElement, mobile: boolean) {
  const style = document.createElement("style");
  style.textContent = CSS;
  container.appendChild(style);
  const root = document.createElement("div");
  root.className = "gl-root" + (mobile ? " mobile" : "");
  root.dataset.mode = "loading";
  const bar = TOWER_ORDER.map((id) => {
    const d = TOWERS[id];
    return `<button type="button" class="gl-tb" data-tower="${id}" style="--tc:${d.css}">
      <div class="ic">${icon(id, d.css, 22)}<b>${d.key}</b></div><div class="nm">${d.name}</div><div class="cs">${d.cost}</div>
      <div class="tg">${d.air && d.ground ? "GND + AIR" : d.air ? "AIR ONLY" : id === "emp" ? "SLOWS" : "GROUND"}</div></button>`;
  }).join("");
  root.innerHTML = `
  <div class="gl-hud">
    <div class="gl-stat">
      <div class="gl-pb gl-cell core"><div class="k">REACTOR INTEGRITY</div><div class="v"><span class="ig">20</span><small>/20</small></div><div class="pips"></div></div>
      <div class="gl-pb gl-cell cr"><div class="k">CREDITS</div><div class="v">0</div></div>
      <div class="gl-pb gl-cell sc"><div class="k">SCORE</div><div class="v">0</div></div>
    </div>
    <div class="gl-pb gl-wave"><div class="k">DISTRICT 07 DEFENCE</div><div class="t">WAVE <b>1</b> / ${TOTAL_WAVES}</div><div class="s"></div><div class="prev"></div><div class="prog"><i></i></div>
      <div class="gl-boss"><div class="n">JUGGERNAUT</div><div class="b"><i></i></div></div></div>
    <div class="gl-pb gl-tutor"></div>
    <div class="gl-sys">
      <button type="button" class="gl-pb hide-sm" data-act="rotl" title="Rotate view (Q)">⟲</button>
      <button type="button" class="gl-pb hide-sm" data-act="rotr" title="Rotate view (E)">⟳</button>
      <button type="button" class="gl-pb spd" data-act="speed" title="Game speed (F)">1×</button>
      <button type="button" class="gl-pb" data-act="mute" title="Sound (M)">🔊</button>
      <button type="button" class="gl-pb" data-act="pause" title="Pause (P)">❚❚</button>
    </div>
    <div class="gl-feed"></div>
    <div class="gl-hint gl-pb"></div>
    <div class="gl-pb gl-bar">${bar}</div>
    <button type="button" class="gl-next"><span class="nt">NEXT WAVE</span><small></small></button>
    <div class="gl-pb gl-sel"></div>
    <div class="gl-flash"></div>
    <div class="gl-tip"></div>
  </div>
  <div class="gl-ov load on"><div class="gl-load"><b>GRIDLOCK</b><div class="bar"><i></i></div><span>LOADING DISTRICT 07</span></div></div>`;
  container.appendChild(root);
  return {
    style,
    root,
    ov: q(root, ".gl-ov"),
    integ: q(root, ".gl-cell.core"),
    integV: q(root, ".gl-cell.core .ig"),
    pips: q(root, ".gl-cell.core .pips"),
    credits: q(root, ".gl-cell.cr"),
    creditsV: q(root, ".gl-cell.cr .v"),
    scoreV: q(root, ".gl-cell.sc .v"),
    waveT: q(root, ".gl-wave .t"),
    waveS: q(root, ".gl-wave .s"),
    wavePrev: q(root, ".gl-wave .prev"),
    waveProg: q(root, ".gl-wave .prog i"),
    wave: q(root, ".gl-wave"),
    boss: q(root, ".gl-boss"),
    bossBar: q(root, ".gl-boss .b i"),
    bossN: q(root, ".gl-boss .n"),
    tutor: q(root, ".gl-tutor"),
    sys: q(root, ".gl-sys"),
    speedB: q(root, '[data-act="speed"]'),
    muteB: q(root, '[data-act="mute"]'),
    feed: q(root, ".gl-feed"),
    hint: q(root, ".gl-hint"),
    bar: q(root, ".gl-bar"),
    next: q(root, ".gl-next"),
    nextT: q(root, ".gl-next .nt"),
    nextS: q(root, ".gl-next small"),
    sel: q(root, ".gl-sel"),
    flash: q(root, ".gl-flash"),
    tip: q(root, ".gl-tip"),
  };
}
export type GlHud = ReturnType<typeof buildGlHud>;
