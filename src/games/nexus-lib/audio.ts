/**
 * NEXUS 2100 — procedural audio engine.
 *
 * Everything is synthesised with WebAudio: no audio files to download.
 * Noise buffers and the reverb impulse are generated once and reused, so a
 * sustained full-auto burst allocates only a handful of short-lived nodes.
 */

type BurstOpts = {
  dur: number;
  type: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  gain: number;
  attack?: number;
  pan?: number;
  send?: number;
  delay?: number;
  rate?: number;
  brown?: boolean;
};

type OscOpts = {
  type: OscillatorType;
  f0: number;
  f1: number;
  dur: number;
  gain: number;
  pan?: number;
  send?: number;
  delay?: number;
};

export type AudioEngine = ReturnType<typeof createAudio>;

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let ambBus: GainNode | null = null;
  let reverbIn: GainNode | null = null;
  let white: AudioBuffer | null = null;
  let brown: AudioBuffer | null = null;
  let volume = 0.8;
  let ambient: AudioBufferSourceNode[] = [];
  let sirenTimer = 9;
  let heartTimer = 0;
  let lowHp = 0;

  function makeNoise(c: AudioContext, seconds: number, kind: "white" | "brown") {
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  function makeImpulse(c: AudioContext, seconds: number, decay: number) {
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // Early reflections (urban canyon slap-back) + diffuse tail.
        const slap = i > c.sampleRate * 0.045 && i < c.sampleRate * 0.06 ? 0.6 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, decay) + slap);
      }
    }
    return buf;
  }

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = new Ctor();
      ctx = c;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(c.destination);
      master = c.createGain();
      master.gain.value = volume * 0.55;
      master.connect(comp);
      sfxBus = c.createGain();
      sfxBus.connect(master);
      ambBus = c.createGain();
      ambBus.gain.value = 0.9;
      ambBus.connect(master);
      const conv = c.createConvolver();
      conv.buffer = makeImpulse(c, 1.9, 3.2);
      const wet = c.createGain();
      wet.gain.value = 0.55;
      conv.connect(wet);
      wet.connect(master);
      reverbIn = c.createGain();
      reverbIn.connect(conv);
      white = makeNoise(c, 2, "white");
      brown = makeNoise(c, 4, "brown");
    } catch {
      ctx = null;
    }
  }

  function out(node: AudioNode, pan = 0, send = 0) {
    if (!ctx || !sfxBus) return;
    let tail: AudioNode = node;
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      tail.connect(p);
      tail = p;
    }
    tail.connect(sfxBus);
    if (send > 0 && reverbIn) {
      const s = ctx.createGain();
      s.gain.value = send;
      tail.connect(s);
      s.connect(reverbIn);
    }
  }

  function burst(o: BurstOpts) {
    if (!ctx || !white || !brown) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brown : white;
    src.playbackRate.value = o.rate ?? 1;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqEnd), t + o.dur);
    filter.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    const atk = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(filter);
    filter.connect(g);
    out(g, o.pan, o.send);
    const offset = Math.random() * 1.5;
    src.start(t, offset, o.dur + 0.05);
  }

  function osc(o: OscOpts) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const node = ctx.createOscillator();
    node.type = o.type;
    node.frequency.setValueAtTime(o.f0, t);
    node.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    node.connect(g);
    out(g, o.pan, o.send);
    node.start(t);
    node.stop(t + o.dur + 0.02);
  }

  function startAmbient() {
    if (!ctx || !ambBus || !white || !brown || ambient.length) return;
    const loop = (buf: AudioBuffer, type: BiquadFilterType, freq: number, gain: number, q = 0.5) => {
      if (!ctx || !ambBus) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 2.5);
      src.connect(f);
      f.connect(g);
      g.connect(ambBus);
      src.start();
      ambient.push(src);
    };
    loop(brown, "lowpass", 220, 0.55); // city rumble
    loop(white, "bandpass", 5200, 0.05, 0.4); // rain hiss
    loop(white, "lowpass", 900, 0.035); // rain body
  }

  return {
    ensure,
    startAmbient,
    get ready() {
      return !!ctx;
    },
    setVolume(v: number) {
      volume = v;
      if (master && ctx) master.gain.setTargetAtTime(v * 0.55, ctx.currentTime, 0.05);
    },
    pause(paused: boolean) {
      if (!ctx) return;
      if (paused) void ctx.suspend();
      else void ctx.resume();
    },
    setLowHp(v: number) {
      lowHp = v;
    },
    update(dt: number) {
      if (!ctx || ctx.state !== "running") return;
      sirenTimer -= dt;
      if (sirenTimer <= 0) {
        sirenTimer = 22 + Math.random() * 25;
        const pan = Math.random() * 1.6 - 0.8;
        for (let i = 0; i < 3; i++) {
          osc({ type: "triangle", f0: 640, f1: 880, dur: 0.75, gain: 0.025, pan, send: 0.9, delay: i * 1.5 });
          osc({ type: "triangle", f0: 880, f1: 640, dur: 0.75, gain: 0.025, pan, send: 0.9, delay: i * 1.5 + 0.75 });
        }
      }
      if (lowHp > 0.01) {
        heartTimer -= dt;
        if (heartTimer <= 0) {
          heartTimer = 0.95 - lowHp * 0.3;
          osc({ type: "sine", f0: 70, f1: 38, dur: 0.16, gain: 0.35 * lowHp });
          osc({ type: "sine", f0: 64, f1: 34, dur: 0.18, gain: 0.26 * lowHp, delay: 0.2 });
        }
      }
    },
    rifle() {
      burst({ dur: 0.035, type: "highpass", freq: 2600, gain: 0.55, send: 0.1 });
      burst({ dur: 0.16, type: "bandpass", freq: 1100, freqEnd: 260, q: 0.6, gain: 0.7, send: 0.45 });
      osc({ type: "sine", f0: 150, f1: 42, dur: 0.16, gain: 0.75 });
      burst({ dur: 0.05, type: "lowpass", freq: 600, gain: 0.35, brown: true });
    },
    remoteShot(dist: number, pan: number, hostile: boolean) {
      const lp = Math.max(520, 3400 - dist * 85);
      const g = 0.55 / (1 + dist * 0.07);
      burst({ dur: 0.18, type: "lowpass", freq: lp, freqEnd: lp * 0.35, gain: g, pan, send: 0.35 + Math.min(0.5, dist * 0.02) });
      osc({ type: "sine", f0: hostile ? 120 : 135, f1: 40, dur: 0.15, gain: g * 0.9, pan });
    },
    sniper(dist: number, pan: number) {
      const g = 0.8 / (1 + dist * 0.035);
      burst({ dur: 0.03, type: "highpass", freq: 3200, gain: g * 0.9, pan, send: 0.3 });
      burst({ dur: 0.35, type: "lowpass", freq: 1400, freqEnd: 200, gain: g, pan, send: 0.9 });
      osc({ type: "sine", f0: 90, f1: 32, dur: 0.4, gain: g * 0.9, pan });
    },
    explode(dist: number, pan: number) {
      const g = 0.9 / (1 + dist * 0.05);
      burst({ dur: 0.9, type: "lowpass", freq: 900, freqEnd: 80, gain: g, pan, send: 0.8, brown: true });
      burst({ dur: 0.25, type: "bandpass", freq: 2200, freqEnd: 500, gain: g * 0.5, pan, send: 0.5 });
      osc({ type: "sine", f0: 70, f1: 28, dur: 0.6, gain: g, pan });
    },
    whiz(pan: number) {
      burst({ dur: 0.2, type: "bandpass", freq: 4200, freqEnd: 900, q: 3, gain: 0.32, pan });
    },
    impact(dist: number, pan: number) {
      const g = 0.22 / (1 + dist * 0.08);
      burst({ dur: 0.05, type: "highpass", freq: 1800, gain: g, pan, send: 0.2 });
      if (Math.random() < 0.3) osc({ type: "sine", f0: 2900, f1: 1300, dur: 0.12, gain: g * 0.35, pan, send: 0.4 });
    },
    hitmarker() {
      osc({ type: "square", f0: 2350, f1: 2100, dur: 0.035, gain: 0.09 });
      burst({ dur: 0.06, type: "lowpass", freq: 700, gain: 0.3, brown: true });
    },
    headshot() {
      osc({ type: "sine", f0: 1900, f1: 1750, dur: 0.22, gain: 0.16 });
      osc({ type: "sine", f0: 2850, f1: 2700, dur: 0.18, gain: 0.08 });
      burst({ dur: 0.08, type: "lowpass", freq: 900, gain: 0.4, brown: true });
    },
    kill() {
      osc({ type: "triangle", f0: 520, f1: 500, dur: 0.07, gain: 0.12 });
      osc({ type: "triangle", f0: 780, f1: 760, dur: 0.12, gain: 0.12, delay: 0.06 });
    },
    hurt() {
      burst({ dur: 0.18, type: "lowpass", freq: 420, gain: 0.7, brown: true });
      osc({ type: "sine", f0: 110, f1: 50, dur: 0.2, gain: 0.45 });
    },
    reloadOut() {
      osc({ type: "square", f0: 1100, f1: 900, dur: 0.025, gain: 0.08 });
      burst({ dur: 0.08, type: "bandpass", freq: 1800, q: 2, gain: 0.18 });
    },
    reloadIn() {
      burst({ dur: 0.05, type: "bandpass", freq: 2400, q: 3, gain: 0.25 });
      osc({ type: "square", f0: 700, f1: 640, dur: 0.03, gain: 0.08 });
    },
    bolt() {
      burst({ dur: 0.04, type: "bandpass", freq: 3200, q: 4, gain: 0.25 });
      burst({ dur: 0.05, type: "bandpass", freq: 2100, q: 4, gain: 0.25, delay: 0.09 });
    },
    /** Brass casing bouncing on wet asphalt. */
    casing(speed: number) {
      const g = Math.min(0.06, 0.012 * speed);
      const f = 4200 + Math.random() * 1800;
      osc({ type: "sine", f0: f, f1: f * 0.96, dur: 0.07, gain: g, send: 0.15 });
      osc({ type: "sine", f0: f * 1.48, f1: f * 1.45, dur: 0.05, gain: g * 0.5 });
    },
    /** Rifle / wreck clattering onto the ground. */
    clatter(dist: number, speed: number) {
      const g = Math.min(0.25, 0.05 * speed) / (1 + dist * 0.08);
      burst({ dur: 0.12, type: "bandpass", freq: 1400 + Math.random() * 600, q: 2.5, gain: g, send: 0.3 });
      osc({ type: "triangle", f0: 820, f1: 610, dur: 0.09, gain: g * 0.4 });
    },
    emp(dist: number, pan: number) {
      const g = 0.7 / (1 + dist * 0.05);
      osc({ type: "sawtooth", f0: 1800, f1: 60, dur: 0.7, gain: g * 0.35, pan, send: 0.7 });
      osc({ type: "square", f0: 120, f1: 40, dur: 0.5, gain: g * 0.3, pan });
      burst({ dur: 0.5, type: "bandpass", freq: 5200, freqEnd: 900, q: 4, gain: g * 0.4, pan, send: 0.6 });
    },
    pin() {
      osc({ type: "square", f0: 2600, f1: 2400, dur: 0.03, gain: 0.05 });
      burst({ dur: 0.05, type: "bandpass", freq: 3600, q: 3, gain: 0.12, delay: 0.05 });
    },
    takedown() {
      burst({ dur: 0.16, type: "lowpass", freq: 380, gain: 0.55, brown: true });
      osc({ type: "sine", f0: 140, f1: 55, dur: 0.18, gain: 0.35 });
      burst({ dur: 0.05, type: "bandpass", freq: 1500, q: 2, gain: 0.12, delay: 0.04 });
    },
    dry() {
      osc({ type: "square", f0: 1500, f1: 1400, dur: 0.02, gain: 0.07 });
    },
    footstep(sprint: boolean) {
      burst({
        dur: sprint ? 0.09 : 0.07,
        type: "lowpass",
        freq: 500 + Math.random() * 300,
        gain: sprint ? 0.2 : 0.12,
        brown: true,
      });
      burst({ dur: 0.04, type: "highpass", freq: 3500, gain: 0.03 }); // wet splash
    },
    pickup() {
      osc({ type: "sine", f0: 660, f1: 990, dur: 0.12, gain: 0.12 });
      osc({ type: "sine", f0: 990, f1: 1320, dur: 0.12, gain: 0.1, delay: 0.08 });
    },
    alarm() {
      for (let i = 0; i < 2; i++) {
        osc({ type: "sawtooth", f0: 420, f1: 420, dur: 0.22, gain: 0.07, delay: i * 0.32, send: 0.6 });
        osc({ type: "sawtooth", f0: 315, f1: 315, dur: 0.22, gain: 0.07, delay: i * 0.32 + 0.16, send: 0.6 });
      }
    },
    objective() {
      osc({ type: "sine", f0: 523, f1: 523, dur: 0.18, gain: 0.12, send: 0.5 });
      osc({ type: "sine", f0: 659, f1: 659, dur: 0.18, gain: 0.12, delay: 0.12, send: 0.5 });
      osc({ type: "sine", f0: 784, f1: 784, dur: 0.32, gain: 0.12, delay: 0.24, send: 0.5 });
    },
    medal() {
      osc({ type: "triangle", f0: 660, f1: 660, dur: 0.1, gain: 0.1, send: 0.4 });
      osc({ type: "triangle", f0: 990, f1: 990, dur: 0.16, gain: 0.1, delay: 0.08, send: 0.4 });
      osc({ type: "sine", f0: 1320, f1: 1320, dur: 0.3, gain: 0.07, delay: 0.16, send: 0.6 });
    },
    ui() {
      osc({ type: "sine", f0: 900, f1: 1150, dur: 0.06, gain: 0.08 });
    },
    revive() {
      osc({ type: "sine", f0: 440, f1: 880, dur: 0.3, gain: 0.12, send: 0.4 });
    },
    dispose() {
      for (const s of ambient) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      ambient = [];
      void ctx?.close();
      ctx = null;
    },
  };
}
