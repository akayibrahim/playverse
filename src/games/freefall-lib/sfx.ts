/**
 * FREEFALL: synthesized SFX (own WebAudio graph): wind that rises with speed, ring chimes, near-miss
 * whooshes, chute, crash, landing. Music / ambience still come from the shared createAudio().
 */

export function createSfx() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let white: AudioBuffer | null = null;
  let brown: AudioBuffer | null = null;
  let wind: { bp: BiquadFilterNode; hp: BiquadFilterNode; g: GainNode; g2: GainNode; rumble: GainNode; src: AudioScheduledSourceNode[] } | null = null;
  let vol = 0.8;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol * 0.7;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    const mk = (kind: "white" | "brown") => {
      const n = ctx!.sampleRate * 3;
      const b = ctx!.createBuffer(1, n, ctx!.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w;
        else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
      return b;
    };
    white = mk("white");
    brown = mk("brown");
  }

  function out(g: AudioNode, pan = 0) {
    if (!ctx || !master) return;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(master);
    } else g.connect(master);
  }

  function burst(o: { dur: number; type: BiquadFilterType; freq: number; freqEnd?: number; q?: number; gain: number; attack?: number; brown?: boolean; pan?: number; delay?: number }) {
    if (!ctx || !white || !brown) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brown : white;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    out(g, o.pan);
    src.start(t, Math.random() * 1.5, o.dur + 0.05);
  }

  function tone(o: { type: OscillatorType; f0: number; f1: number; dur: number; gain: number; delay?: number; pan?: number }) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const n = ctx.createOscillator();
    n.type = o.type;
    n.frequency.setValueAtTime(o.f0, t);
    n.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    n.connect(g);
    out(g, o.pan);
    n.start(t);
    n.stop(t + o.dur + 0.03);
  }

  function startWind() {
    if (!ctx || !master || !white || !brown || wind) return;
    const mkLoop = (buf: AudioBuffer) => {
      const s = ctx!.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    const s1 = mkLoop(white);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    s1.connect(bp);
    bp.connect(g);
    g.connect(master);
    const s2 = mkLoop(white);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400;
    const g2 = ctx.createGain();
    g2.gain.value = 0;
    s2.connect(hp);
    hp.connect(g2);
    g2.connect(master);
    const s3 = mkLoop(brown);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    s3.connect(lp);
    lp.connect(rumble);
    rumble.connect(master);
    wind = { bp, hp, g, g2, rumble, src: [s1, s2, s3] };
  }

  function stopWind() {
    if (!wind) return;
    for (const s of wind.src) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    wind = null;
  }

  return {
    ensure,
    get ready() {
      return !!ctx;
    },
    setVolume(v: number) {
      vol = v;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : v * 0.7, ctx.currentTime, 0.05);
    },
    setMuted(m: boolean) {
      muted = m;
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : vol * 0.7, ctx.currentTime, 0.05);
    },
    pause(p: boolean) {
      if (!ctx) return;
      if (p) void ctx.suspend();
      else void ctx.resume();
    },
    windStart: startWind,
    windStop: stopWind,
    /** speed in m/s, canopy 0..1 (softens wind), near 0..1 (proximity hiss) */
    windSet(speed: number, canopy: number, near: number) {
      if (!ctx || !wind) return;
      const k = Math.min(1.3, speed / 90);
      const t = ctx.currentTime;
      wind.bp.frequency.setTargetAtTime(280 + k * 1900, t, 0.08);
      wind.hp.frequency.setTargetAtTime(2200 + k * 2600, t, 0.08);
      const c = 1 - canopy * 0.8;
      wind.g.gain.setTargetAtTime(Math.pow(k, 1.4) * 0.5 * c, t, 0.08);
      wind.g2.gain.setTargetAtTime((Math.pow(k, 2.2) * 0.12 + near * 0.06) * c, t, 0.08);
      wind.rumble.gain.setTargetAtTime(Math.pow(k, 1.2) * 0.55 * c, t, 0.1);
    },
    ring(perfect: boolean, streak: number) {
      const b = 660 * Math.pow(1.0595, Math.min(12, streak));
      tone({ type: "sine", f0: b, f1: b * 1.5, dur: 0.22, gain: 0.13 });
      tone({ type: "triangle", f0: b * 2, f1: b * 3, dur: 0.3, gain: perfect ? 0.1 : 0.04, delay: 0.04 });
      if (perfect) tone({ type: "sine", f0: b * 3, f1: b * 4, dur: 0.4, gain: 0.07, delay: 0.09 });
    },
    miss() {
      tone({ type: "sawtooth", f0: 220, f1: 110, dur: 0.3, gain: 0.07 });
    },
    whoosh(pan: number, k: number) {
      burst({ dur: 0.35, type: "bandpass", freq: 900, freqEnd: 3200, q: 1.1, gain: 0.1 + k * 0.18, pan, attack: 0.06 });
    },
    boost() {
      burst({ dur: 0.8, type: "bandpass", freq: 500, freqEnd: 3800, q: 1.2, gain: 0.3, attack: 0.05 });
      tone({ type: "sawtooth", f0: 80, f1: 240, dur: 0.5, gain: 0.1 });
    },
    brake() {
      burst({ dur: 0.5, type: "bandpass", freq: 3000, freqEnd: 800, q: 0.9, gain: 0.18, attack: 0.03 });
    },
    countdown(go: boolean) {
      tone({ type: "square", f0: go ? 1320 : 660, f1: go ? 1320 : 660, dur: go ? 0.45 : 0.15, gain: 0.07 });
    },
    jump() {
      burst({ dur: 0.9, type: "lowpass", freq: 1800, freqEnd: 200, gain: 0.3, attack: 0.02 });
      tone({ type: "sine", f0: 140, f1: 50, dur: 0.5, gain: 0.2 });
    },
    chute() {
      burst({ dur: 0.35, type: "lowpass", freq: 3200, freqEnd: 400, q: 0.6, gain: 0.5, attack: 0.01 });
      burst({ dur: 0.9, type: "lowpass", freq: 240, freqEnd: 60, gain: 0.5, brown: true, attack: 0.02 });
      tone({ type: "sine", f0: 120, f1: 45, dur: 0.6, gain: 0.25 });
    },
    warn() {
      tone({ type: "square", f0: 880, f1: 880, dur: 0.1, gain: 0.05 });
      tone({ type: "square", f0: 880, f1: 880, dur: 0.1, gain: 0.05, delay: 0.16 });
    },
    stall() {
      tone({ type: "sawtooth", f0: 300, f1: 200, dur: 0.14, gain: 0.04 });
    },
    crash(k = 1) {
      burst({ dur: 1.4, type: "lowpass", freq: 1400, freqEnd: 60, gain: 0.9 * k, brown: true, attack: 0.004 });
      burst({ dur: 0.6, type: "bandpass", freq: 2600, freqEnd: 500, q: 0.8, gain: 0.5 * k, attack: 0.002 });
      tone({ type: "sawtooth", f0: 160, f1: 28, dur: 0.9, gain: 0.3 * k });
    },
    hit() {
      burst({ dur: 0.35, type: "bandpass", freq: 1500, freqEnd: 300, q: 1, gain: 0.35, attack: 0.002 });
      tone({ type: "square", f0: 200, f1: 60, dur: 0.25, gain: 0.1 });
    },
    land(good: boolean) {
      burst({ dur: 0.5, type: "lowpass", freq: 500, freqEnd: 80, gain: 0.5, brown: true });
      if (good) {
        tone({ type: "sine", f0: 523, f1: 523, dur: 0.5, gain: 0.1, delay: 0.1 });
        tone({ type: "sine", f0: 659, f1: 659, dur: 0.5, gain: 0.1, delay: 0.2 });
        tone({ type: "sine", f0: 784, f1: 784, dur: 0.7, gain: 0.1, delay: 0.3 });
      }
    },
    split(good: boolean) {
      tone({ type: "sine", f0: good ? 880 : 520, f1: good ? 1320 : 440, dur: 0.18, gain: 0.09 });
    },
    dispose() {
      stopWind();
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      master = null;
    },
  };
}
