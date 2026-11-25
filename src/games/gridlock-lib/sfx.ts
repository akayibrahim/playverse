/** GRIDLOCK — small WebAudio synth: shots, impacts, UI blips and a rainy-city drone. No audio files. */

export type Sfx = ReturnType<typeof createSfx>;

export function createSfx() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let amb: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let volume = 0.8;
  let muted = false;
  const last: Record<string, number> = {};
  let droneNodes: AudioScheduledSourceNode[] = [];
  let droneGain: GainNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let disposed = false;

  function ensure() {
    if (disposed) return null;
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume * 0.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ctx.destination);
      amb = ctx.createGain();
      amb.gain.value = 0.6;
      amb.connect(master);
      const n = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      startAmbient();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function startAmbient() {
    if (!ctx || !amb || !noiseBuf) return;
    // rain: filtered noise loop
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 3200;
    f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(amb);
    src.start();
    // city drone: two detuned saws through a slow lowpass, intensity follows threat
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 260;
    lowpass.Q.value = 3;
    droneGain.connect(lowpass).connect(amb);
    const a = ctx.createOscillator();
    a.type = "sawtooth";
    a.frequency.value = 55;
    const b = ctx.createOscillator();
    b.type = "sawtooth";
    b.frequency.value = 55.6;
    const c = ctx.createOscillator();
    c.type = "sine";
    c.frequency.value = 82.4;
    a.connect(droneGain);
    b.connect(droneGain);
    c.connect(droneGain);
    a.start();
    b.start();
    c.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(lowpass.frequency);
    lfo.start();
    droneNodes = [src, a, b, c, lfo];
  }

  function gate(key: string, minGap: number) {
    if (!ctx) return false;
    const t = ctx.currentTime;
    if ((last[key] ?? -9) + minGap > t) return false;
    last[key] = t;
    return true;
  }

  type O = { type?: OscillatorType; f0: number; f1?: number; dur: number; gain: number; delay?: number; pan?: number };
  function osc(o: O) {
    const c = ensure();
    if (!c || !master) return;
    const t = c.currentTime + (o.delay ?? 0);
    const os = c.createOscillator();
    os.type = o.type ?? "sine";
    os.frequency.setValueAtTime(o.f0, t);
    if (o.f1) os.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + Math.min(0.01, o.dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node: AudioNode = g;
    os.connect(g);
    if (o.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p);
      node = p;
    }
    node.connect(master);
    os.start(t);
    os.stop(t + o.dur + 0.03);
  }
  type N = { type?: BiquadFilterType; f0: number; f1?: number; q?: number; dur: number; gain: number; delay?: number; pan?: number };
  function noise(o: N) {
    const c = ensure();
    if (!c || !master || !noiseBuf) return;
    const t = c.currentTime + (o.delay ?? 0);
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f).connect(g);
    let node: AudioNode = g;
    if (o.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p);
      node = p;
    }
    node.connect(master);
    s.start(t, Math.random());
    s.stop(t + o.dur + 0.03);
  }

  return {
    ensure,
    get ready() {
      return !!ctx;
    },
    setVolume(v: number) {
      volume = v;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : v * 0.5, ctx.currentTime, 0.05);
    },
    setMuted(m: boolean) {
      muted = m;
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : volume * 0.5, ctx.currentTime, 0.05);
    },
    /** 0..1 threat → drone brightness/level */
    intensity(v: number) {
      if (!ctx || !lowpass || !droneGain) return;
      lowpass.frequency.setTargetAtTime(220 + v * 700, ctx.currentTime, 0.4);
      droneGain.gain.setTargetAtTime(0.04 + v * 0.05, ctx.currentTime, 0.4);
    },
    pause(p: boolean) {
      if (!ctx) return;
      if (p) void ctx.suspend();
      else void ctx.resume();
    },
    pulse(pan = 0) {
      if (!gate("pulse", 0.045)) return;
      osc({ type: "square", f0: 1500 + Math.random() * 200, f1: 380, dur: 0.07, gain: 0.07, pan });
    },
    arc(pan = 0) {
      if (!gate("arc", 0.08)) return;
      noise({ type: "bandpass", f0: 5200, f1: 900, q: 1.5, dur: 0.22, gain: 0.35, pan });
      osc({ type: "sawtooth", f0: 220, f1: 70, dur: 0.18, gain: 0.07, pan });
    },
    emp(pan = 0) {
      if (!gate("emp", 0.12)) return;
      osc({ type: "sine", f0: 600, f1: 120, dur: 0.55, gain: 0.16, pan });
      osc({ type: "triangle", f0: 1200, f1: 200, dur: 0.4, gain: 0.05, pan });
    },
    rail(pan = 0) {
      if (!gate("rail", 0.1)) return;
      noise({ type: "highpass", f0: 2400, dur: 0.08, gain: 0.5, pan });
      osc({ type: "sawtooth", f0: 1800, f1: 70, dur: 0.5, gain: 0.16, pan });
      osc({ type: "sine", f0: 90, f1: 38, dur: 0.6, gain: 0.35, pan });
    },
    flak(pan = 0) {
      if (!gate("flak", 0.08)) return;
      noise({ type: "lowpass", f0: 1800, f1: 200, dur: 0.3, gain: 0.5, pan });
      osc({ type: "sine", f0: 140, f1: 45, dur: 0.25, gain: 0.3, pan });
    },
    hit() {
      if (!gate("hit", 0.05)) return;
      osc({ type: "triangle", f0: 420 + Math.random() * 160, f1: 160, dur: 0.05, gain: 0.04 });
    },
    kill(big = false, pan = 0) {
      if (!gate(big ? "killB" : "kill", big ? 0.1 : 0.04)) return;
      noise({ type: "lowpass", f0: big ? 1600 : 2600, f1: 120, dur: big ? 0.9 : 0.16, gain: big ? 0.9 : 0.22, pan });
      osc({ type: "sine", f0: big ? 120 : 200, f1: 40, dur: big ? 0.8 : 0.14, gain: big ? 0.5 : 0.1, pan });
    },
    leak() {
      if (!gate("leak", 0.15)) return;
      osc({ type: "sawtooth", f0: 440, f1: 90, dur: 0.5, gain: 0.22 });
      osc({ type: "square", f0: 880, f1: 880, dur: 0.12, gain: 0.08 });
      osc({ type: "square", f0: 660, f1: 660, dur: 0.12, gain: 0.08, delay: 0.14 });
    },
    stomp() {
      osc({ type: "sine", f0: 80, f1: 28, dur: 0.9, gain: 0.7 });
      noise({ type: "lowpass", f0: 700, f1: 60, dur: 0.8, gain: 0.7 });
    },
    place() {
      osc({ type: "square", f0: 300, f1: 900, dur: 0.12, gain: 0.07 });
      osc({ type: "triangle", f0: 600, f1: 1800, dur: 0.18, gain: 0.08, delay: 0.08 });
      noise({ type: "highpass", f0: 3000, dur: 0.1, gain: 0.15, delay: 0.1 });
    },
    upgrade() {
      for (let i = 0; i < 3; i++) osc({ type: "triangle", f0: 440 * Math.pow(1.5, i), dur: 0.14, gain: 0.08, delay: i * 0.07 });
    },
    sell() {
      osc({ type: "triangle", f0: 900, f1: 300, dur: 0.18, gain: 0.08 });
      osc({ type: "square", f0: 1400, f1: 1400, dur: 0.04, gain: 0.04, delay: 0.1 });
    },
    click() {
      if (!gate("click", 0.03)) return;
      osc({ type: "square", f0: 900, f1: 700, dur: 0.04, gain: 0.04 });
    },
    deny() {
      if (!gate("deny", 0.1)) return;
      osc({ type: "sawtooth", f0: 160, f1: 110, dur: 0.18, gain: 0.1 });
    },
    wave(boss = false) {
      for (let i = 0; i < 3; i++) osc({ type: "sawtooth", f0: boss ? 70 : 110, f1: boss ? 60 : 140, dur: 0.35, gain: 0.14, delay: i * 0.18 });
      noise({ type: "bandpass", f0: 300, f1: 1400, dur: 0.7, gain: 0.25 });
    },
    clear() {
      for (let i = 0; i < 4; i++) osc({ type: "triangle", f0: 523 * Math.pow(1.26, i), dur: 0.22, gain: 0.08, delay: i * 0.08 });
    },
    coin() {
      if (!gate("coin", 0.05)) return;
      osc({ type: "square", f0: 1318, dur: 0.05, gain: 0.025 });
      osc({ type: "square", f0: 1760, dur: 0.09, gain: 0.025, delay: 0.05 });
    },
    win() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => osc({ type: "triangle", f0: f, dur: 0.5, gain: 0.1, delay: i * 0.12 }));
    },
    lose() {
      [330, 262, 196, 130].forEach((f, i) => osc({ type: "sawtooth", f0: f, f1: f * 0.9, dur: 0.6, gain: 0.12, delay: i * 0.22 }));
      noise({ type: "lowpass", f0: 900, f1: 60, dur: 2, gain: 0.6, delay: 0.2 });
    },
    dispose() {
      disposed = true;
      for (const n of droneNodes) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      if (ctx) void ctx.close();
      ctx = null;
    },
  };
}
