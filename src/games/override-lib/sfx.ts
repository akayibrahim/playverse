/** OVERRIDE — synthesized WebAudio: rotor hum, hack chirps, alarms, ambient pad. No assets. */
export function createSfx() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let vol = 0.8;
  let musicVol = 0.6;
  let muted = false;
  // rotor
  let rot: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; lp: BiquadFilterNode } | null = null;
  // alarm
  let alarmOsc: { o: OscillatorNode; g: GainNode } | null = null;
  let alarmT = 0;
  // music
  let pad: { o: OscillatorNode[]; g: GainNode; lp: BiquadFilterNode } | null = null;
  let step = 0;
  let stepT = 0;
  let intensity = 0.3;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : vol;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.35 * musicVol;
    musicBus.connect(master);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.2, when = 0, slideTo?: number, dest?: AudioNode) {
    const c = ensure();
    if (!c || !sfx) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest ?? sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function burst(dur: number, gain: number, freq: number, q = 1, type: BiquadFilterType = "bandpass", when = 0, sweepTo?: number) {
    const c = ensure();
    if (!c || !sfx || !noise) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(sfx);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  function startRotor() {
    const c = ensure();
    if (!c || !sfx || rot) return;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    o1.type = "sawtooth";
    o2.type = "triangle";
    o1.frequency.value = 96;
    o2.frequency.value = 142;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(sfx);
    o1.start();
    o2.start();
    rot = { o1, o2, g, lp };
  }
  function stopRotor() {
    if (!rot) return;
    try {
      rot.o1.stop();
      rot.o2.stop();
    } catch {
      /* already stopped */
    }
    rot = null;
  }
  function startPad() {
    const c = ensure();
    if (!c || !musicBus || pad) return;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    const g = c.createGain();
    g.gain.value = 0.5;
    lp.connect(g);
    g.connect(musicBus);
    const os: OscillatorNode[] = [];
    for (const f of [55, 55.4, 82.4, 110.3]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = 0.16;
      o.connect(og);
      og.connect(lp);
      o.start();
      os.push(o);
    }
    pad = { o: os, g, lp };
  }

  return {
    ensure,
    start() {
      ensure();
      startRotor();
      startPad();
    },
    stop() {
      stopRotor();
      if (alarmOsc) {
        try {
          alarmOsc.o.stop();
        } catch {
          /* ok */
        }
        alarmOsc = null;
      }
    },
    setVolume(v: number) {
      vol = v;
      if (master) master.gain.value = muted ? 0 : v;
    },
    setMuted(m: boolean) {
      muted = m;
      if (master) master.gain.value = m ? 0 : vol;
    },
    setMusic(v: number) {
      musicVol = v;
      if (musicBus) musicBus.gain.value = 0.35 * v;
    },
    suspend(on: boolean) {
      if (!ctx) return;
      if (on) void ctx.suspend();
      else void ctx.resume();
    },
    /** continuous: speed 0..1, hacking/riding flags */
    update(dt: number, speed: number, mode: "drone" | "ride" | "cam", alarm: boolean, near: number) {
      if (!ctx) return;
      if (rot) {
        const k = mode === "cam" ? 0.15 : mode === "ride" ? 0.25 : 1;
        const t = ctx.currentTime;
        rot.o1.frequency.setTargetAtTime(88 + speed * 38 + (mode === "ride" ? -30 : 0), t, 0.1);
        rot.o2.frequency.setTargetAtTime(134 + speed * 54 + (mode === "ride" ? -40 : 0), t, 0.1);
        rot.lp.frequency.setTargetAtTime(300 + speed * 380, t, 0.1);
        rot.g.gain.setTargetAtTime((0.02 + speed * 0.035) * k * (0.6 + near * 0.0), t, 0.1);
      }
      if (pad) {
        pad.lp.frequency.setTargetAtTime(380 + intensity * 700, ctx.currentTime, 0.4);
      }
      // siren
      if (alarm) {
        alarmT += dt;
        if (!alarmOsc && ctx && sfx) {
          const o = ctx.createOscillator();
          o.type = "square";
          const g = ctx.createGain();
          g.gain.value = 0.05;
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 900;
          o.connect(lp);
          lp.connect(g);
          g.connect(sfx);
          o.start();
          alarmOsc = { o, g };
        }
        if (alarmOsc) alarmOsc.o.frequency.setTargetAtTime(alarmT % 1 < 0.5 ? 760 : 560, ctx.currentTime, 0.02);
      } else if (alarmOsc) {
        try {
          alarmOsc.o.stop();
        } catch {
          /* ok */
        }
        alarmOsc = null;
      }
      // sparse arpeggio
      stepT -= dt;
      if (stepT <= 0) {
        stepT = alarm ? 0.19 : 0.46 - intensity * 0.12;
        const seq = [55, 82.4, 65.4, 98, 55, 73.4, 82.4, 110];
        const f = seq[step++ % seq.length] * (alarm ? 4 : 2);
        tone(f, 0.28, "triangle", 0.045 * (alarm ? 1.4 : 0.8), 0, f * 0.97, musicBus ?? undefined);
      }
    },
    intensity(v: number) {
      intensity = v;
    },
    ui() {
      tone(880, 0.07, "square", 0.05);
    },
    click() {
      tone(520, 0.05, "square", 0.05);
    },
    hackTick(k: number) {
      tone(420 + k * 700, 0.05, "square", 0.05);
    },
    hackDone() {
      [660, 880, 1320].forEach((f, i) => tone(f, 0.12, "triangle", 0.12, i * 0.07));
    },
    jackIn() {
      burst(0.5, 0.18, 3000, 0.7, "bandpass", 0, 300);
      tone(180, 0.4, "sawtooth", 0.08, 0, 700);
    },
    jackOut() {
      burst(0.35, 0.14, 700, 0.7, "bandpass", 0, 3000);
      tone(700, 0.3, "sawtooth", 0.06, 0, 160);
    },
    ride() {
      tone(110, 0.5, "sawtooth", 0.1, 0, 220);
      tone(330, 0.15, "square", 0.06, 0.1);
    },
    suspicious(k: number) {
      tone(300 + k * 260, 0.09, "square", 0.05);
    },
    alarm() {
      burst(0.6, 0.25, 1800, 1.5, "bandpass", 0, 200);
      tone(140, 0.6, "sawtooth", 0.2, 0, 60);
    },
    caught() {
      tone(90, 0.9, "sawtooth", 0.28, 0, 30);
      burst(0.8, 0.3, 900, 0.5, "lowpass", 0, 80);
    },
    door() {
      burst(0.5, 0.12, 400, 2, "bandpass", 0, 1400);
      tone(220, 0.4, "triangle", 0.06, 0, 330);
    },
    charge() {
      tone(540, 0.12, "sine", 0.05, 0, 760);
    },
    zap() {
      burst(0.4, 0.35, 2400, 3, "bandpass", 0, 120);
      tone(1100, 0.3, "sawtooth", 0.1, 0, 90);
    },
    laserOff() {
      tone(900, 0.4, "triangle", 0.1, 0, 120);
    },
    win() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, "triangle", 0.12, i * 0.1));
    },
    lowBattery() {
      tone(330, 0.12, "square", 0.07);
      tone(260, 0.16, "square", 0.07, 0.14);
    },
    dispose() {
      this.stop();
      try {
        pad?.o.forEach((o) => o.stop());
      } catch {
        /* ok */
      }
      pad = null;
      if (ctx) void ctx.close();
      ctx = null;
    },
  };
}
export type Sfx = ReturnType<typeof createSfx>;
