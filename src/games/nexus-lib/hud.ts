/**
 * NEXUS 2100 — HUD, menus and touch layer (plain DOM, no React).
 */

export const HUD_CSS = `
.nx-root{--c:#6ff2e3;--c2:#2fb8ad;--r:#ff4d5c;--a:#ffb547;--t:#dce7ee;--d:#7c91a1;--p:rgba(5,11,17,.62);
  --mono:var(--font-geist-mono),ui-monospace,SFMono-Regular,Menlo,monospace;
  --sans:var(--font-geist-sans),system-ui,sans-serif;
  position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;color:var(--t);
  font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}
.nx-root *{box-sizing:border-box;}
.nx-hud{position:absolute;inset:0;transition:opacity .35s;}
.nx-root[data-mode=menu] .nx-hud{opacity:0;}
.nx-root[data-mode=menu] .nx-touch{display:none!important;}
.nx-panelbg{background:var(--p);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);
  border:1px solid rgba(140,200,210,.14);}

/* objective */
.nx-obj{position:absolute;left:20px;top:18px;min-width:230px;padding:10px 14px 11px;border-left:2px solid var(--c);}
.nx-obj .k{font-size:9px;color:var(--d);letter-spacing:.28em;display:flex;justify-content:space-between;gap:14px;}
.nx-obj .k b{color:var(--c);font-weight:500;}
.nx-obj .t{margin-top:5px;font:700 15px/1.15 var(--sans);letter-spacing:.06em;color:#f2f7fa;}
.nx-obj .s{margin-top:6px;font-size:10px;color:#a9bbc8;}
.nx-obj .bar{margin-top:8px;height:3px;background:rgba(255,255,255,.1);display:none;}
.nx-obj .bar i{display:block;height:100%;width:0;background:var(--c);box-shadow:0 0 10px var(--c);}
.nx-obj.alert{border-left-color:var(--r);}
.nx-obj.alert .k b{color:var(--r);}

/* compass */
.nx-compass{position:absolute;left:50%;top:16px;width:min(440px,46vw);height:30px;transform:translateX(-50%);
  overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);}
.nx-compass .tk{position:absolute;top:0;width:1px;height:6px;background:rgba(220,235,240,.45);}
.nx-compass .tk.big{height:9px;background:rgba(230,240,245,.8);}
.nx-compass .lb{position:absolute;top:11px;transform:translateX(-50%);font-size:10px;color:#c8d6df;}
.nx-compass .lb.n{color:var(--a);}
.nx-compass .pip{position:absolute;top:3px;width:7px;height:7px;margin-left:-3.5px;transform:rotate(45deg);
  background:var(--r);box-shadow:0 0 6px var(--r);}
.nx-compass .pip.obj{background:var(--c);box-shadow:0 0 8px var(--c);width:9px;height:9px;margin-left:-4.5px;top:2px;}
.nx-compass .pip.ally{background:#8fe3a8;box-shadow:none;width:5px;height:5px;margin-left:-2.5px;top:4px;}
.nx-compass .ctr{position:absolute;left:50%;bottom:0;width:0;height:0;margin-left:-4px;
  border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid var(--c);}
.nx-heading{position:absolute;left:50%;top:48px;transform:translateX(-50%);font-size:9px;color:var(--d);}

/* kill feed + system buttons */
.nx-sys{position:absolute;right:16px;top:16px;display:flex;gap:6px;pointer-events:auto;}
.nx-sys button{width:34px;height:34px;padding:0;display:grid;place-items:center;cursor:pointer;color:#cfe0e8;
  font:600 14px var(--sans);}
.nx-sys button:hover{border-color:var(--c);color:var(--c);}
.nx-sys button.off{color:var(--r);border-color:rgba(255,77,92,.5);}
.nx-feed{position:absolute;right:18px;top:62px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;}
.nx-feed div{padding:4px 9px;font-size:10px;color:#d5e2ea;background:rgba(5,11,17,.55);
  border-right:2px solid var(--c);animation:nxIn .2s ease-out both;transition:opacity .4s;}
.nx-feed div.hs{border-right-color:var(--a);}
.nx-feed div.bad{border-right-color:var(--r);color:#ffc2c8;}
.nx-feed em{font-style:normal;color:var(--r);}
.nx-feed u{text-decoration:none;color:var(--a);}

/* vitals */
.nx-vit{position:absolute;left:20px;bottom:20px;width:262px;padding:11px 14px 12px;}
.nx-vit .row{display:flex;align-items:baseline;justify-content:space-between;}
.nx-vit .hp{font:700 30px/1 var(--sans);letter-spacing:0;color:#f4f9fb;}
.nx-vit .hp small{font:500 10px var(--mono);color:var(--d);letter-spacing:.2em;margin-left:6px;}
.nx-vit .lbl{font-size:9px;color:var(--d);letter-spacing:.24em;}
.nx-hpbar{position:relative;margin-top:8px;height:7px;display:flex;gap:2px;}
.nx-hpbar i{flex:1;background:rgba(255,255,255,.1);position:relative;overflow:hidden;}
.nx-hpbar i b{position:absolute;inset:0;background:linear-gradient(90deg,#4fd3c4,#9ff7ea);transform-origin:left;}
.nx-vit.low .nx-hpbar i b{background:linear-gradient(90deg,#c43b46,#ff7a72);}
.nx-vit.low .hp{color:#ff8b8b;animation:nxPulse .8s ease-in-out infinite;}
.nx-squad{margin-top:11px;padding-top:9px;border-top:1px solid rgba(160,200,210,.12);display:flex;flex-direction:column;gap:5px;}
.nx-squad .m{display:grid;grid-template-columns:62px 1fr 42px;align-items:center;gap:8px;font-size:9px;color:#b8c9d4;}
.nx-squad .m .b{height:3px;background:rgba(255,255,255,.1);}
.nx-squad .m .b i{display:block;height:100%;background:#8fe3a8;}
.nx-squad .m span:last-child{text-align:right;color:var(--d);}
.nx-squad .m.down{color:var(--r);}
.nx-squad .m.down span:last-child{color:var(--r);animation:nxPulse 1s infinite;}

/* weapon */
.nx-wpn{position:absolute;right:20px;bottom:20px;width:236px;padding:11px 14px 12px;text-align:right;}
.nx-wpn .nm{display:flex;justify-content:space-between;font-size:9px;color:var(--d);letter-spacing:.24em;}
.nx-wpn .nm b{color:var(--c);font-weight:500;}
.nx-wpn .am{margin-top:4px;font:700 38px/1 var(--sans);letter-spacing:-.01em;color:#f4f9fb;}
.nx-wpn .am small{font:500 15px var(--sans);color:#7f95a5;margin-left:4px;}
.nx-wpn.empty .am{color:var(--r);}
.nx-mag{margin-top:8px;display:flex;gap:2px;justify-content:flex-end;height:8px;}
.nx-mag i{width:4px;background:rgba(220,240,245,.85);}
.nx-mag i.off{background:rgba(255,255,255,.12);}
.nx-rl{margin-top:7px;height:2px;background:rgba(255,255,255,.08);visibility:hidden;}
.nx-rl i{display:block;height:100%;width:0;background:var(--a);}
.nx-wpn.reloading .nx-rl{visibility:visible;}
.nx-wpn .ky{margin-top:6px;font-size:9px;color:var(--d);}
.nx-wpn .gr{margin-top:6px;font-size:10px;letter-spacing:.18em;color:#cfe3ea;}
.nx-wpn .gr b{color:var(--a);font-weight:500;}
.nx-wpn .gr.none{opacity:.35;}
.nx-prompt.act{pointer-events:auto;cursor:pointer;border:1px solid var(--c);background:rgba(10,30,34,.7);}
.nx-arc{position:absolute;inset:0;pointer-events:none;}

/* crosshair */
.nx-cross{position:absolute;left:50%;top:50%;width:0;height:0;--g:10px;transition:opacity .15s;}
.nx-cross i{position:absolute;background:rgba(240,250,252,.92);box-shadow:0 0 2px rgba(0,0,0,.9);}
.nx-cross i:nth-child(1){left:-1px;top:calc(-1*var(--g) - 8px);width:2px;height:8px;}
.nx-cross i:nth-child(2){left:-1px;top:var(--g);width:2px;height:8px;}
.nx-cross i:nth-child(3){top:-1px;left:calc(-1*var(--g) - 8px);width:8px;height:2px;}
.nx-cross i:nth-child(4){top:-1px;left:var(--g);width:8px;height:2px;}
.nx-cross i:nth-child(5){left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%;background:var(--c);}
.nx-cross.enemy i{background:#ff7a80;}
.nx-cross.hide{opacity:0;}
.nx-hit{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;}
.nx-hit i{position:absolute;width:2px;height:9px;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.8);}
.nx-hit i:nth-child(1){left:6px;top:-15px;transform:rotate(45deg);}
.nx-hit i:nth-child(2){left:6px;top:6px;transform:rotate(-45deg);}
.nx-hit i:nth-child(3){left:-8px;top:-15px;transform:rotate(-45deg);}
.nx-hit i:nth-child(4){left:-8px;top:6px;transform:rotate(45deg);}
.nx-hit.hs i{background:var(--a);}
.nx-hit.kill i{background:var(--r);height:12px;}
.nx-dmgs{position:absolute;left:50%;top:50%;width:0;height:0;}
.nx-dmg{position:absolute;left:-46px;top:-132px;width:92px;height:26px;transform-origin:46px 132px;opacity:0;
  background:radial-gradient(ellipse at 50% 100%,rgba(255,50,60,.85),rgba(255,40,50,0) 70%);
  -webkit-mask-image:radial-gradient(ellipse at 50% 340%,transparent 66%,#000 68%,#000 80%,transparent 82%);
  mask-image:radial-gradient(ellipse at 50% 340%,transparent 66%,#000 68%,#000 80%,transparent 82%);}
.nx-pops{position:absolute;left:calc(50% + 34px);top:calc(50% - 6px);display:flex;flex-direction:column;gap:2px;}
.nx-pops div{font:700 12px var(--sans);letter-spacing:.08em;color:#f1f7f9;text-shadow:0 1px 3px #000;
  animation:nxPop 1.1s ease-out both;white-space:nowrap;}
.nx-pops div.hs{color:var(--a);}
.nx-prompt{position:absolute;left:50%;top:calc(50% + 46px);transform:translateX(-50%);display:none;
  padding:6px 12px;font-size:10px;color:#e8f3f6;text-align:center;}
.nx-prompt .bar{margin-top:5px;height:2px;background:rgba(255,255,255,.12);}
.nx-prompt .bar i{display:block;height:100%;width:0;background:var(--c);}
.nx-banner{position:absolute;left:50%;top:24%;transform:translateX(-50%);text-align:center;opacity:0;
  transition:opacity .4s, transform .4s;white-space:nowrap;}
.nx-banner.on{opacity:1;transform:translateX(-50%) translateY(-6px);}
.nx-banner .k{font-size:10px;letter-spacing:.4em;color:var(--c);}
.nx-banner.alert .k{color:var(--r);}
.nx-banner .t{margin-top:6px;font:800 clamp(22px,4vw,40px)/1 var(--sans);letter-spacing:.08em;color:#fff;
  text-shadow:0 2px 24px rgba(0,0,0,.7);}
.nx-banner .s{margin-top:8px;font-size:10px;color:#d3dee6;text-shadow:0 1px 3px #000,0 0 12px rgba(0,0,0,.8);}
.nx-banner .k{text-shadow:0 1px 3px #000;}
.nx-hint{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);display:flex;gap:16px;align-items:center;
  padding:9px 16px;opacity:0;transition:opacity .35s;white-space:nowrap;}
.nx-hint.on{opacity:1;}
.nx-hint span{display:flex;align-items:center;gap:7px;font-size:10px;color:#c6d6df;}
.nx-hint kbd{font:600 10px var(--mono);padding:3px 6px;min-width:22px;text-align:center;color:#fff;
  border:1px solid rgba(200,230,235,.35);border-bottom-width:2px;background:rgba(255,255,255,.06);}
.nx-edge{position:absolute;display:none;transform:translate(-50%,-50%);text-align:center;}
.nx-edge .a{display:block;width:0;height:0;margin:0 auto;border-top:8px solid transparent;border-bottom:8px solid transparent;
  border-left:13px solid var(--c);filter:drop-shadow(0 0 6px var(--c));}
.nx-edge .l{display:block;margin-top:4px;font-size:9px;color:var(--c);}
.nx-world{position:absolute;display:none;transform:translate(-50%,-100%);text-align:center;font-size:9px;color:var(--c);}
.nx-world .d{width:12px;height:12px;margin:0 auto 3px;border:2px solid var(--c);transform:rotate(45deg);box-shadow:0 0 10px var(--c);}
.nx-blood{position:absolute;inset:0;pointer-events:none;opacity:0;z-index:1;
  background:radial-gradient(ellipse at center,transparent 45%,rgba(150,0,10,.55) 100%);}
.nx-scope{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;
  background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.35) 100%);}

/* overlays */
.nx-ov{position:absolute;inset:0;z-index:8;display:none;pointer-events:auto;}
.nx-ov.on{display:block;}
.nx-ov.menu{background:linear-gradient(90deg,rgba(3,7,11,.94) 0%,rgba(3,7,11,.78) 36%,rgba(3,7,11,.05) 70%);}
.nx-ov.dim{background:rgba(3,7,11,.74);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);}
.nx-ov.load{background:radial-gradient(ellipse at 50% 45%,#0b1620,#03070b 70%);}
.nx-col{position:absolute;left:clamp(20px,6vw,80px);top:50%;transform:translateY(-50%);width:min(470px,calc(100% - 40px));
  max-height:calc(100% - 32px);overflow:auto;scrollbar-width:none;}
.nx-col>*{animation:nxIn .45s ease-out both;}
.nx-col>*:nth-child(2){animation-delay:.05s}.nx-col>*:nth-child(3){animation-delay:.1s}
.nx-col>*:nth-child(4){animation-delay:.15s}.nx-col>*:nth-child(5){animation-delay:.2s}.nx-col>*:nth-child(6){animation-delay:.25s}
.nx-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,calc(100% - 32px));
  max-height:calc(100% - 32px);overflow:auto;scrollbar-width:none;text-align:center;}
.nx-center>*{animation:nxIn .4s ease-out both;}
.nx-kick{font-size:10px;letter-spacing:.42em;color:var(--c);}
.nx-kick.r{color:var(--r);}
.nx-h1{margin-top:12px;font:800 clamp(38px,6.5vw,68px)/.92 var(--sans);letter-spacing:-.01em;color:#f5fafc;text-transform:none;}
.nx-h1 span{color:var(--c);}
.nx-h2{margin-top:10px;font:700 clamp(22px,4vw,34px)/1 var(--sans);letter-spacing:.04em;color:#fff;}
.nx-sub{margin-top:12px;font:400 13px/1.65 var(--sans);letter-spacing:.01em;text-transform:none;color:#a7b9c6;max-width:420px;}
.nx-phases{margin-top:20px;display:flex;flex-direction:column;gap:1px;}
.nx-phases div{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;padding:9px 12px;
  background:rgba(255,255,255,.035);border-left:2px solid rgba(111,242,227,.35);}
.nx-phases b{font:700 15px var(--sans);color:var(--c);letter-spacing:0;}
.nx-phases span{font-size:10px;color:#c9d7df;line-height:1.5;}
.nx-phases span small{display:block;font-size:9px;color:var(--d);letter-spacing:.1em;text-transform:none;font-family:var(--sans);}
.nx-ctrl{margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;}
.nx-ctrl div{display:flex;justify-content:space-between;gap:8px;font-size:9px;color:var(--d);padding-bottom:5px;
  border-bottom:1px solid rgba(255,255,255,.06);}
.nx-ctrl b{font-weight:500;color:#dce8ee;}
.nx-actions{margin-top:22px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.nx-center .nx-actions{justify-content:center;}
.nx-btn{pointer-events:auto;cursor:pointer;position:relative;padding:14px 30px;border:0;
  background:var(--c);color:#031413;font:700 12px var(--mono);letter-spacing:.3em;text-transform:uppercase;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);
  transition:filter .15s,transform .1s;}
.nx-btn:hover{filter:brightness(1.12);}
.nx-btn:active{transform:translateY(1px);}
.nx-btn.ghost{background:transparent;color:#d6e4ea;box-shadow:inset 0 0 0 1px rgba(200,230,235,.3);clip-path:none;}
.nx-btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--c);color:var(--c);}
.nx-best{font-size:9px;color:var(--d);}
.nx-best b{color:var(--a);font-weight:500;}
.nx-set{margin-top:16px;display:flex;flex-direction:column;gap:10px;}
.nx-set label{display:grid;grid-template-columns:100px 1fr 36px;gap:10px;align-items:center;font-size:9px;color:var(--d);}
.nx-set label span:last-child{text-align:right;color:#dce8ee;}
.nx-set input{pointer-events:auto;width:100%;accent-color:var(--c);}
.nx-load{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(360px,80vw);text-align:center;}
.nx-load .bar{margin-top:18px;height:2px;background:rgba(255,255,255,.1);}
.nx-load .bar i{display:block;height:100%;width:0;background:var(--c);box-shadow:0 0 12px var(--c);transition:width .25s;}
.nx-load .st{margin-top:10px;display:flex;justify-content:space-between;font-size:9px;color:var(--d);}
.nx-load .err{margin-top:10px;color:var(--r);font-size:9px;}
.nx-grade{margin:18px auto 0;width:92px;height:92px;display:grid;place-items:center;
  font:800 52px/1 var(--sans);color:#04110f;background:var(--c);
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);}
.nx-grade.f{background:var(--r);color:#1a0306;}
.nx-score{margin-top:14px;font:800 46px/1 var(--sans);letter-spacing:-.01em;color:#fff;}
.nx-newbest{margin-top:6px;font-size:10px;color:var(--a);letter-spacing:.3em;}
.nx-stats{margin:18px auto 0;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;max-width:420px;}
.nx-stats div{padding:10px 6px;background:rgba(255,255,255,.04);}
.nx-stats b{display:block;font:700 18px var(--sans);letter-spacing:0;color:#eef5f8;}
.nx-stats span{display:block;margin-top:3px;font-size:8px;color:var(--d);letter-spacing:.22em;}
.nx-break{margin:12px auto 0;max-width:420px;display:flex;flex-direction:column;gap:3px;}
.nx-break div{display:flex;justify-content:space-between;font-size:9px;color:#9fb3c1;}
.nx-break div b{color:#e6f0f4;font-weight:500;}
.nx-tiny{margin-top:12px;font-size:9px;color:var(--d);}

/* touch */
.nx-touch{display:none;position:absolute;inset:0;}
.nx-root.mobile .nx-touch{display:block;}
.nx-stick{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;display:none;
  border:1px solid rgba(160,220,225,.35);background:radial-gradient(circle,rgba(40,90,95,.18),rgba(5,12,18,.35));}
.nx-stick.on{display:block;}
.nx-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px;border-radius:50%;
  background:rgba(111,242,227,.25);border:1px solid rgba(111,242,227,.7);}
.nx-stickhint{position:absolute;left:22px;bottom:150px;font-size:9px;color:rgba(200,225,230,.45);}
.nx-tb{position:absolute;pointer-events:auto;touch-action:none;display:grid;place-items:center;border-radius:50%;
  font:600 9px var(--mono);letter-spacing:.14em;color:#e2eff2;border:1px solid rgba(180,225,230,.35);
  background:rgba(6,16,22,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.nx-tb.fire{right:26px;top:calc(50% - 30px);width:84px;height:84px;background:rgba(120,30,36,.45);border-color:rgba(255,120,120,.6);font-size:10px;}
.nx-tb.fire.on{background:rgba(200,50,60,.6);}
.nx-tb.ads{right:124px;top:calc(50% - 62px);width:56px;height:56px;}
.nx-tb.ads.on{background:rgba(40,130,125,.6);border-color:var(--c);}
.nx-tb.rl{right:122px;top:calc(50% + 14px);width:48px;height:48px;}
.nx-tb.sw{right:46px;top:calc(50% - 92px);width:44px;height:44px;}
.nx-tb.cr{right:46px;top:calc(50% + 66px);width:46px;height:46px;font-size:15px;}
.nx-tb.cr.on{background:rgba(40,130,125,.6);border-color:var(--c);}
.nx-tb.gn{right:124px;top:calc(50% + 76px);width:46px;height:46px;font-size:15px;}
.nx-tb.gn.on{background:rgba(160,110,30,.6);border-color:var(--a);}
.nx-tb.gn i{position:absolute;right:-3px;top:-3px;font:700 9px var(--mono, monospace);font-style:normal;background:var(--a);color:#111;border-radius:8px;padding:1px 4px;}
.nx-tb.sp{left:26px;bottom:22px;width:52px;height:52px;display:none;}
.nx-tb.sp.on{background:rgba(40,130,125,.6);border-color:var(--c);}


/* medals / progression */
.nx-medal{position:absolute;right:24px;top:36%;display:flex;align-items:center;gap:12px;padding:10px 16px 10px 10px;
  background:linear-gradient(90deg,rgba(255,181,71,.18),rgba(5,11,17,.7));border:1px solid rgba(255,181,71,.45);
  opacity:0;transform:translateX(30px);pointer-events:none;}
.nx-medal.on{animation:nxMedal 1.7s ease-out both;}
.nx-medal i{width:40px;height:40px;display:grid;place-items:center;font:700 20px var(--sans);font-style:normal;color:#1a1003;
  background:var(--a);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);}
.nx-medal b{display:block;font:800 14px var(--sans);letter-spacing:.1em;color:#fff;}
.nx-medal span{font-size:9px;color:var(--a);}
@keyframes nxMedal{0%{opacity:0;transform:translateX(30px) scale(.9)}12%{opacity:1;transform:none}80%{opacity:1;transform:none}100%{opacity:0;transform:translateX(10px)}}
.nx-rank{margin-top:18px;display:flex;gap:12px;align-items:center;padding:10px 12px;background:rgba(255,255,255,.035);
  border:1px solid rgba(140,200,210,.12);}
.nx-rank .badge{flex:none;width:44px;height:44px;display:grid;place-items:center;font:800 18px var(--sans);color:#031413;
  background:var(--c);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);}
.nx-rank .info{flex:1;min-width:0;}
.nx-rank .top,.nx-rank .bot,.nx-xpgain .top{display:flex;justify-content:space-between;gap:8px;font-size:9px;color:var(--d);}
.nx-rank .top b,.nx-xpgain .top b{font:700 12px var(--sans);letter-spacing:.12em;color:#eef6f8;}
.nx-rank .xp,.nx-xpgain .xp{position:relative;margin:6px 0 5px;height:4px;background:rgba(255,255,255,.08);overflow:hidden;}
.nx-rank .xp i,.nx-xpgain .xp i{position:absolute;left:0;top:0;bottom:0;background:var(--c);box-shadow:0 0 8px var(--c);}
.nx-xpgain .xp i.new{background:var(--a);box-shadow:0 0 8px var(--a);animation:nxGrow 1.2s .4s ease-out both;}
.nx-xpgain .xp i.old{z-index:1;}
@keyframes nxGrow{from{transform:scaleX(0);transform-origin:left}to{transform:scaleX(1);transform-origin:left}}
.nx-rank .st i{font-style:normal;color:rgba(255,255,255,.18);margin-right:2px;font-size:11px;}
.nx-rank .st i.on{color:var(--a);text-shadow:0 0 6px rgba(255,181,71,.6);}
.nx-col.wide{width:min(620px,calc(100% - 40px));}
.nx-slots{margin-top:14px;display:flex;flex-direction:column;gap:10px;}
.nx-slot .k{font-size:9px;letter-spacing:.3em;color:var(--d);margin-bottom:5px;}
.nx-slot .opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;}
.nx-opt{pointer-events:auto;cursor:pointer;text-align:left;padding:9px 10px;border:1px solid rgba(160,210,220,.18);
  background:rgba(255,255,255,.035);color:#dfe9ee;font:inherit;display:flex;flex-direction:column;gap:3px;position:relative;}
.nx-opt b{font:700 11px var(--sans);letter-spacing:.1em;}
.nx-opt span{font-size:8px;letter-spacing:.08em;color:var(--d);text-transform:none;font-family:var(--sans);}
.nx-opt em{position:absolute;right:9px;top:10px;width:10px;height:10px;transform:rotate(45deg);}
.nx-opt:hover:not(.lock){border-color:var(--c);}
.nx-opt.on{border-color:var(--c);background:rgba(111,242,227,.1);box-shadow:inset 3px 0 0 var(--c);}
.nx-opt.lock{opacity:.45;cursor:default;}
.nx-opt.lock span{color:var(--a);}
.nx-starrow{margin:14px auto 0;max-width:420px;display:flex;flex-direction:column;gap:4px;text-align:left;}
.nx-starrow div{display:flex;gap:10px;align-items:center;font-size:10px;color:#6f8291;}
.nx-starrow i{font-style:normal;font-size:15px;color:rgba(255,255,255,.15);}
.nx-starrow .on{color:#e6f0f4;}
.nx-starrow .on i{color:var(--a);text-shadow:0 0 8px rgba(255,181,71,.7);}
.nx-starrow .had i{color:rgba(255,181,71,.4);}
.nx-medals{margin:12px auto 0;max-width:440px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;}
.nx-medals span{display:flex;align-items:center;gap:6px;padding:4px 9px 4px 4px;font-size:9px;color:#f1e2c6;
  border:1px solid rgba(255,181,71,.35);background:rgba(255,181,71,.08);}
.nx-medals span i{font-style:normal;width:18px;height:18px;display:grid;place-items:center;background:var(--a);color:#1a1003;font-size:10px;}
.nx-xpgain{margin:14px auto 0;max-width:420px;text-align:left;}
.nx-xpgain .top span{color:var(--a);font-size:10px;}
.nx-center.deb{width:min(900px,calc(100% - 32px));}
.nx-deb{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;margin-top:8px;}
.nx-deb .r{text-align:left;}
.nx-deb .r .nx-starrow,.nx-deb .r .nx-xpgain{max-width:none;margin-left:0;margin-right:0;}
.nx-deb .r .nx-medals{justify-content:flex-start;margin-left:0;}
.nx-deb .r .nx-starrow{margin-top:0;}
@media (max-width:760px){.nx-deb{grid-template-columns:1fr;gap:10px;}}
.nx-daily{pointer-events:auto;cursor:pointer;display:block;width:100%;margin-top:10px;padding:11px 14px;text-align:left;font:inherit;
  color:inherit;border:1px solid rgba(255,181,71,.4);background:linear-gradient(90deg,rgba(255,181,71,.14),rgba(255,181,71,.03));}
.nx-daily:hover{border-color:var(--a);}
.nx-daily .k{display:flex;justify-content:space-between;font-size:9px;color:var(--d);letter-spacing:.24em;}
.nx-daily .k b{color:var(--a);font-weight:600;}
.nx-daily .t{margin-top:4px;font:800 16px var(--sans);letter-spacing:.08em;color:#fff;}
.nx-daily .s{margin-top:3px;font:400 11px/1.45 var(--sans);letter-spacing:0;text-transform:none;color:#b9c6d0;}
.nx-daily .go{margin-top:6px;font-size:10px;color:var(--a);letter-spacing:.24em;}
.nx-tabs{margin-top:14px;display:flex;gap:6px;}
.nx-tabs button{pointer-events:auto;cursor:pointer;flex:1;padding:9px;font:inherit;font-size:10px;letter-spacing:.2em;color:var(--d);
  background:rgba(255,255,255,.03);border:1px solid rgba(160,210,220,.15);}
.nx-tabs button.on{color:var(--c);border-color:var(--c);background:rgba(111,242,227,.08);}
.nx-lbwrap{margin-top:12px;min-height:120px;}
.nx-lb{display:flex;flex-direction:column;gap:2px;}
.nx-lb div{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center;padding:8px 12px;background:rgba(255,255,255,.035);
  font-size:11px;color:#d7e3ea;}
.nx-lb div:nth-child(1) .n{color:#ffd86b;}.nx-lb div:nth-child(2) .n{color:#d6dee4;}.nx-lb div:nth-child(3) .n{color:#e0a77a;}
.nx-lb .n{font-weight:700;color:var(--d);}
.nx-lb .nm{text-transform:none;letter-spacing:.06em;font-family:var(--sans);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nx-lb b{font:700 13px var(--sans);letter-spacing:.02em;}
.nx-lb .you{background:rgba(111,242,227,.12);box-shadow:inset 3px 0 0 var(--c);}
.nx-lb .sep{margin-top:6px;}
.nx-submit{margin-top:14px;}
.nx-namebox span{display:block;font-size:9px;color:var(--d);letter-spacing:.22em;margin-bottom:6px;}
.nx-namebox div{display:flex;gap:6px;}
.nx-namebox input{pointer-events:auto;flex:1;min-width:0;padding:9px 10px;font:600 13px var(--sans);letter-spacing:.06em;color:#fff;
  background:rgba(255,255,255,.06);border:1px solid rgba(160,210,220,.3);outline:none;text-transform:uppercase;}
.nx-namebox input:focus{border-color:var(--c);}
.nx-btn.sm{padding:9px 14px;font-size:10px;letter-spacing:.2em;}
.nx-rankres{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.nx-rankres b{font:800 28px var(--sans);color:var(--c);letter-spacing:0;}
.nx-rankres span{font-size:9px;color:#cfdbe2;letter-spacing:.2em;}
.nx-rankres em{font-style:normal;font-size:9px;color:var(--d);}
.nx-unlock{margin:10px auto 0;display:inline-block;padding:6px 12px;font-size:10px;color:#031413;background:var(--a);}
.nx-rotate{display:none;position:absolute;inset:0;z-index:30;pointer-events:auto;place-content:center;justify-items:center;gap:10px;
  background:radial-gradient(ellipse at 50% 45%,#0b1620,#03070b 70%);text-align:center;}
.nx-rotate .ph{width:46px;height:78px;border:2px solid var(--c);border-radius:8px;margin-bottom:12px;animation:nxRot 2.2s ease-in-out infinite;}
.nx-rotate b{font:800 16px var(--sans);letter-spacing:.14em;color:#fff;}
.nx-rotate span{font-size:9px;color:var(--d);}
@keyframes nxRot{0%,20%{transform:rotate(0)}55%,100%{transform:rotate(-90deg)}}
@media (orientation:portrait){.nx-root.mobile .nx-rotate{display:grid;}}
/* keep HUD + touch controls above the browser toolbar (iOS Safari overlays the page bottom) */
.nx-root.mobile .nx-hud,.nx-root.mobile .nx-touch,.nx-root.mobile .nx-ov{bottom:max(var(--vb,0px),env(safe-area-inset-bottom));}
.nx-col,.nx-center{touch-action:pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.nx-root.mobile .nx-obj{left:calc(10px + env(safe-area-inset-left));}
.nx-root.mobile .nx-sys{right:calc(10px + env(safe-area-inset-right));}
.nx-root.mobile .nx-feed{right:calc(10px + env(safe-area-inset-right));}
.nx-root.mobile .nx-tb.fire{right:calc(26px + env(safe-area-inset-right));}
.nx-root.mobile .nx-tb.ads{right:calc(124px + env(safe-area-inset-right));}
.nx-root.mobile .nx-tb.rl{right:calc(122px + env(safe-area-inset-right));}
.nx-root.mobile .nx-tb.sw{right:calc(46px + env(safe-area-inset-right));}
.nx-root.mobile .nx-tb.cr{right:calc(46px + env(safe-area-inset-right));}
.nx-root.mobile .nx-tb.gn{right:calc(124px + env(safe-area-inset-right));}
.nx-root.mobile .nx-col{left:calc(16px + env(safe-area-inset-left));}
@keyframes nxIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes nxPop{0%{opacity:0;transform:translateY(6px)}12%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}
@keyframes nxPulse{50%{opacity:.45}}

@media (max-width:760px),(pointer:coarse){
  .nx-root{font-size:10px;}
  .nx-obj{left:10px;top:10px;min-width:0;max-width:40vw;padding:6px 10px 7px;}
  .nx-obj .k{font-size:8px;}
  .nx-obj .t{font-size:12px;margin-top:3px;}
  .nx-obj .s{font-size:8px;margin-top:3px;}
  .nx-compass{top:10px;width:min(200px,30vw);height:26px;}
  .nx-compass .lb{font-size:8px;top:10px;}
  .nx-heading{display:none;}
  .nx-sys{right:10px;top:10px;}
  .nx-sys button{width:30px;height:30px;font-size:12px;}
  .nx-feed{right:10px;top:48px;}
  .nx-feed div{font-size:8px;padding:3px 6px;}
  .nx-vit{left:50%;transform:translateX(-50%);bottom:10px;width:180px;padding:6px 10px 7px;}
  .nx-vit .row:first-child,.nx-squad{display:none;}
  .nx-vit .row{margin-top:0!important;}
  .nx-vit .hp{font-size:16px;}
  .nx-hpbar{height:5px;margin-top:5px;}
  .nx-wpn{left:calc(50% + 98px);right:auto;bottom:10px;width:auto;padding:6px 10px;text-align:left;}
  .nx-wpn .nm,.nx-wpn .ky,.nx-mag,.nx-wpn .gr{display:none;}
  .nx-wpn .am{font-size:20px;margin:0;}
  .nx-wpn .am small{font-size:11px;}
  .nx-hint{bottom:64px;gap:8px 12px;padding:7px 12px;}
  .nx-hint span{font-size:9px;}
  .nx-banner{top:20%;}
  .nx-banner .t{font-size:clamp(18px,4.4vw,30px);}
  .nx-col{left:16px;width:calc(100% - 32px);}
  .nx-ov.menu{background:rgba(3,7,11,.82);}
  .nx-ctrl{display:none;}
  .nx-pops{left:calc(50% + 22px);}
  .nx-dmg{transform-origin:46px 100px;top:-100px;}
}
@media (max-height:560px){
  .nx-col{top:16px;transform:none;max-height:calc(100% - 32px);}
  .nx-h1{font-size:34px;margin-top:6px;}
  .nx-sub{display:none;}
  .nx-phases{margin-top:12px;}
  .nx-phases div{padding:6px 10px;}
  .nx-phases span small{display:none;}
  .nx-col .nx-phases,.nx-daily .s{display:none;}
  .nx-daily{padding:7px 12px;margin-top:8px;}
  .nx-daily .t{font-size:13px;margin-top:2px;}
  .nx-actions{margin-top:14px;}
  .nx-center .nx-grade{width:64px;height:64px;font-size:34px;margin-top:10px;}
  .nx-score{font-size:32px;margin-top:8px;}
  .nx-stats{margin-top:10px;}
  .nx-stats div{padding:6px 4px;}
  .nx-break{display:none;}
  .nx-center{top:12px;transform:translateX(-50%);max-height:calc(100% - 24px);}
  .nx-center .nx-h2{font-size:20px;margin-top:4px;}
  .nx-center>.nx-tiny{display:none;}
  .nx-deb{grid-template-columns:1fr 1fr!important;gap:16px;margin-top:4px;}
  .nx-deb .l .nx-tiny{display:none;}
  .nx-starrow div{font-size:9px;}
  .nx-starrow i{font-size:12px;}
  .nx-xpgain,.nx-submit{margin-top:8px;}
  .nx-namebox input{padding:7px 8px;font-size:12px;}
  .nx-center .nx-actions{position:sticky;bottom:0;z-index:2;margin-top:8px!important;padding:10px 0 2px;
    background:linear-gradient(rgba(3,7,11,0),rgba(3,7,11,.96) 40%);}
  .nx-center .nx-grade{width:52px;height:52px;font-size:28px;margin-top:4px;}
  .nx-score{font-size:28px;margin-top:4px;}
  .nx-stats b{font-size:14px;}
  .nx-stats span{font-size:7px;}
  .nx-medals{gap:4px;margin-top:6px;}
  .nx-medals span{padding:2px 6px 2px 2px;font-size:8px;}
  .nx-medals span i{width:14px;height:14px;font-size:8px;}
  .nx-starrow{gap:2px;}
  .nx-btn{padding:11px 20px;}
  .nx-starrow,.nx-medals{margin-top:8px;}
  .nx-rank{margin-top:10px;padding:6px 10px;}
  .nx-medal{top:30%;right:12px;}
}
`;

export type HudRefs = ReturnType<typeof buildHud>;

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) =>
  root.querySelector(sel) as T;

export function buildHud(container: HTMLElement, mobile: boolean) {
  const style = document.createElement("style");
  style.textContent = HUD_CSS;
  container.appendChild(style);

  const root = document.createElement("div");
  root.className = "nx-root" + (mobile ? " mobile" : "");
  root.dataset.mode = "menu";
  root.innerHTML = `
  <div class="nx-blood"></div>
  <div class="nx-scope"></div>
  <div class="nx-hud">
    <div class="nx-obj nx-panelbg"><div class="k"><span class="ph">PHASE 1/3</span><b class="st">ACTIVE</b></div>
      <div class="t">CLEAR THE STREET</div><div class="s">HOSTILES 6</div><div class="bar"><i></i></div></div>
    <div class="nx-compass"><div class="strip"></div><div class="ctr"></div></div>
    <div class="nx-heading">000°</div>
    <div class="nx-sys"><button type="button" class="nx-panelbg" data-act="mute" title="Sound on/off (M)">🔊</button>
      <button type="button" class="nx-panelbg" data-act="pause" title="Pause (P)">❚❚</button>
      <button type="button" class="nx-panelbg" data-act="fs" title="Fullscreen (F)">⛶</button></div>
    <div class="nx-feed"></div>
    <div class="nx-vit nx-panelbg"><div class="row"><span class="lbl">VITALS</span><span class="lbl ar">ARMOR · LV2</span></div>
      <div class="row" style="margin-top:6px"><span class="hp">100<small>HP</small></span></div>
      <div class="nx-hpbar">${"<i><b></b></i>".repeat(10)}</div>
      <div class="nx-squad"></div></div>
    <div class="nx-wpn nx-panelbg"><div class="nm"><span>MK-18 · CARBINE</span><b class="mode">AUTO</b></div>
      <div class="am"><span class="mg">30</span><small>/ <span class="rs">120</span></small></div>
      <div class="nx-mag"></div><div class="nx-rl"><i></i></div><div class="gr"><b>◉</b> <span class="gn">2</span> <span class="gt">FRAG</span></div><div class="ky">R RELOAD · Q SHOULDER</div></div>
    <div class="nx-cross"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="nx-hit"><i></i><i></i><i></i><i></i></div>
    <div class="nx-dmgs"></div>
    <div class="nx-pops"></div>
    <div class="nx-prompt nx-panelbg"><div class="tx"></div><div class="bar"><i></i></div></div>
    <div class="nx-banner"><div class="k"></div><div class="t"></div><div class="s"></div></div>
    <div class="nx-hint nx-panelbg"></div>
    <div class="nx-medal"></div>
    <div class="nx-edge"><span class="a"></span><span class="l"></span></div>
    <div class="nx-world"><div class="d"></div><span></span></div>
  </div>
  <div class="nx-touch">
    <div class="nx-stick"><i></i></div>
    <div class="nx-stickhint">◀ DRAG TO MOVE</div>
    <button type="button" class="nx-tb fire">FIRE</button>
    <button type="button" class="nx-tb ads">AIM</button>
    <button type="button" class="nx-tb rl">R</button>
    <button type="button" class="nx-tb sw">⇄</button>
    <button type="button" class="nx-tb cr" aria-label="Crouch">▾</button>
    <button type="button" class="nx-tb gn" aria-label="Grenade">◉<i>2</i></button>
  </div>
  <div class="nx-ov"></div>
  <div class="nx-rotate"><div class="ph"></div><b>ROTATE YOUR DEVICE</b><span>NEXUS 2100 plays in landscape</span></div>`;
  container.appendChild(root);

  const mag = q(root, ".nx-mag");
  const magTicks: HTMLElement[] = [];
  for (let i = 0; i < 30; i++) {
    const t = document.createElement("i");
    mag.appendChild(t);
    magTicks.push(t);
  }

  const strip = q(root, ".nx-compass .strip");
  const compassTicks: Array<{ el: HTMLElement; deg: number }> = [];
  const names: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  for (let deg = 0; deg < 360; deg += 15) {
    const tk = document.createElement("div");
    tk.className = "tk" + (deg % 45 === 0 ? " big" : "");
    strip.appendChild(tk);
    compassTicks.push({ el: tk, deg });
    if (names[deg] !== undefined) {
      const lb = document.createElement("div");
      lb.className = "lb" + (deg === 0 ? " n" : "");
      lb.textContent = names[deg];
      strip.appendChild(lb);
      compassTicks.push({ el: lb, deg });
    }
  }
  const pips: HTMLElement[] = [];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("div");
    p.className = "pip";
    p.style.display = "none";
    strip.appendChild(p);
    pips.push(p);
  }

  const dmgWrap = q(root, ".nx-dmgs");
  const dmgs: Array<{ el: HTMLElement; life: number; angle: number }> = [];
  for (let i = 0; i < 6; i++) {
    const d = document.createElement("div");
    d.className = "nx-dmg";
    dmgWrap.appendChild(d);
    dmgs.push({ el: d, life: 0, angle: 0 });
  }

  return {
    style,
    root,
    overlay: q(root, ".nx-ov"),
    blood: q(root, ".nx-blood"),
    scope: q(root, ".nx-scope"),
    obj: q(root, ".nx-obj"),
    objPhase: q(root, ".nx-obj .ph"),
    objState: q(root, ".nx-obj .st"),
    objTitle: q(root, ".nx-obj .t"),
    objSub: q(root, ".nx-obj .s"),
    objBar: q(root, ".nx-obj .bar"),
    objBarFill: q(root, ".nx-obj .bar i"),
    compassWidth: () => strip.parentElement?.clientWidth ?? 400,
    compassTicks,
    pips,
    heading: q(root, ".nx-heading"),
    sys: q(root, ".nx-sys"),
    feed: q(root, ".nx-feed"),
    vit: q(root, ".nx-vit"),
    hp: q(root, ".nx-vit .hp"),
    hpCells: Array.from(root.querySelectorAll<HTMLElement>(".nx-hpbar i b")),
    squad: q(root, ".nx-squad"),
    wpn: q(root, ".nx-wpn"),
    mag: q(root, ".nx-wpn .mg"),
    reserve: q(root, ".nx-wpn .rs"),
    magTicks,
    magWrap: mag,
    medal: q(root, ".nx-medal"),
    reloadFill: q(root, ".nx-rl i"),
    keyHint: q(root, ".nx-wpn .ky"),
    cross: q(root, ".nx-cross"),
    hit: q(root, ".nx-hit"),
    dmgs,
    pops: q(root, ".nx-pops"),
    prompt: q(root, ".nx-prompt"),
    promptText: q(root, ".nx-prompt .tx"),
    promptFill: q(root, ".nx-prompt .bar i"),
    banner: q(root, ".nx-banner"),
    bannerK: q(root, ".nx-banner .k"),
    bannerT: q(root, ".nx-banner .t"),
    bannerS: q(root, ".nx-banner .s"),
    hint: q(root, ".nx-hint"),
    edge: q(root, ".nx-edge"),
    edgeArrow: q(root, ".nx-edge .a"),
    edgeLabel: q(root, ".nx-edge .l"),
    world: q(root, ".nx-world"),
    worldLabel: q(root, ".nx-world span"),
    stick: q(root, ".nx-stick"),
    stickKnob: q(root, ".nx-stick i"),
    stickHint: q(root, ".nx-stickhint"),
    tFire: q<HTMLButtonElement>(root, ".nx-tb.fire"),
    tAds: q<HTMLButtonElement>(root, ".nx-tb.ads"),
    tReload: q<HTMLButtonElement>(root, ".nx-tb.rl"),
    tSwap: q<HTMLButtonElement>(root, ".nx-tb.sw"),
    tCrouch: q<HTMLButtonElement>(root, ".nx-tb.cr"),
    tGren: q<HTMLButtonElement>(root, ".nx-tb.gn"),
    grenRow: q(root, ".nx-wpn .gr"),
    grenN: q(root, ".nx-wpn .gn"),
    grenT: q(root, ".nx-wpn .gt"),
  };
}

export function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
