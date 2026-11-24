/**
 * NEXUS 2100 — adaptive score, fully synthesised.
 *
 * One 4-bar loop in D minor at 112 BPM with stacked layers whose gains follow a single
 * "intensity" value from the game:
 *   pad (always) → bass ostinato (alert) → drums (firefight) → lead arp (uplink / climax).
 * Notes are scheduled a little ahead of the audio clock, so frame hitches never break time.
 */

type Layer = "pad" | "bass" | "drums" | "lead";

const BPM = 112;
const STEP = 60 / BPM / 4; // 16th note
// i – VI – iv – V  (Dm, Bb, Gm, A) — the A major gives the loop its pull back to Dm.
const CHORDS = [
  [62, 65, 69],
  [58, 62, 65],
  [55, 58, 62],
  [57, 61, 64],
];
const ROOTS = [38, 34, 31, 33];
const BASS_PAT = [0, -1, 0, 7, 0, -1, 12, 0, 0, -1, 0, 7, 10, -1, 7, 0]; // semitones from root, -1 = rest
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export type Music = ReturnType<typeof createMusic>;

export function createMusic(c: AudioContext, out: AudioNode, verb: AudioNode, noise: AudioBuffer) {
  const bus = c.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  const tone = c.createBiquadFilter(); // global darkening for menus / killcam
  tone.type = "lowpass";
  tone.frequency.value = Math.min(18000, c.sampleRate / 2 - 100);
  tone.connect(bus);
  const send = c.createGain();
  send.gain.value = 0.5;
  send.connect(verb);

  const layers = {} as Record<Layer, GainNode>;
  for (const l of ["pad", "bass", "drums", "lead"] as Layer[]) {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(tone);
    layers[l] = g;
  }
  layers.pad.connect(send);
  layers.lead.connect(send);
  const weight: Record<Layer, number> = { pad: 0, bass: 0, drums: 0, lead: 0 };

  let running = false;
  let step = 0;
  let next = 0;
  let intensity = 0;
  let target = 0;
  let vol = 0.7;
  let duck = 0;

  function env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function pad(t: number, chord: number[], len: number) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 520 + intensity * 1500;
    f.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.55);
    g.gain.setValueAtTime(0.06, t + len - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 1.2);
    f.connect(g);
    g.connect(layers.pad);
    for (const n of chord) {
      for (const det of [-8, 7]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midi(n - 12);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 1.3);
      }
    }
    // sub
    const s = c.createOscillator();
    s.type = "sine";
    s.frequency.value = midi(chord[0] - 24);
    const sg = c.createGain();
    env(sg, t, 0.05, 0.6, len + 0.6);
    s.connect(sg);
    sg.connect(layers.pad);
    s.start(t);
    s.stop(t + len + 1.3);
  }

  function bass(t: number, note: number, accent: boolean) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = midi(note);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 6;
    f.frequency.setValueAtTime(accent ? 1500 : 900 + intensity * 600, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.16);
    const g = c.createGain();
    env(g, t, accent ? 0.16 : 0.11, 0.004, 0.17);
    o.connect(f);
    f.connect(g);
    g.connect(layers.bass);
    o.start(t);
    o.stop(t + 0.25);
  }

  function kick(t: number, gain = 0.5) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    env(g, t, gain, 0.002, 0.26);
    o.connect(g);
    g.connect(layers.drums);
    o.start(t);
    o.stop(t + 0.32);
  }

  function noiseHit(t: number, type: BiquadFilterType, freq: number, gain: number, dur: number, q = 0.8) {
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    env(g, t, gain, 0.002, dur);
    src.connect(f);
    f.connect(g);
    g.connect(layers.drums);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  function snare(t: number) {
    noiseHit(t, "bandpass", 1900, 0.32, 0.16, 0.7);
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = c.createGain();
    env(g, t, 0.14, 0.002, 0.1);
    o.connect(g);
    g.connect(layers.drums);
    o.start(t);
    o.stop(t + 0.14);
  }

  function lead(t: number, note: number) {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = midi(note);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    const g = c.createGain();
    env(g, t, 0.045, 0.003, 0.22);
    o.connect(f);
    f.connect(g);
    g.connect(layers.lead);
    o.start(t);
    o.stop(t + 0.3);
  }

  function schedule(t: number, s: number) {
    const bar = Math.floor(s / 16) % 4;
    const i = s % 16;
    const chord = CHORDS[bar];
    if (i === 0 && weight.pad > 0.005) pad(t, chord, STEP * 16);
    if (weight.bass > 0.01) {
      const off = BASS_PAT[i];
      if (off >= 0) bass(t, ROOTS[bar] + 12 + off, i % 4 === 0);
    }
    if (weight.drums > 0.01) {
      const hard = intensity > 0.8;
      if (i === 0 || i === 8 || (hard && (i === 10 || i === 14))) kick(t, i === 0 ? 0.55 : 0.45);
      if (i === 4 || i === 12) snare(t);
      if (i % 2 === 0 || hard) noiseHit(t, "highpass", 7600, i % 4 === 2 ? 0.07 : 0.04, 0.045);
    }
    if (weight.lead > 0.01 && i % 2 === 0) {
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      lead(t, chord[arp[(i / 2) % 8]] + 12);
    }
  }

  function levels() {
    const k = intensity;
    weight.pad = 1;
    weight.bass = Math.min(1, Math.max(0, (k - 0.18) / 0.2));
    weight.drums = Math.min(1, Math.max(0, (k - 0.45) / 0.2));
    weight.lead = Math.min(1, Math.max(0, (k - 0.82) / 0.12));
    const now = c.currentTime;
    layers.pad.gain.setTargetAtTime(0.9 * weight.pad, now, 0.6);
    layers.bass.gain.setTargetAtTime(weight.bass, now, 0.5);
    layers.drums.gain.setTargetAtTime(weight.drums, now, 0.35);
    layers.lead.gain.setTargetAtTime(weight.lead * 0.9, now, 0.6);
    tone.frequency.setTargetAtTime(duck > 0 ? 700 : Math.min(18000, c.sampleRate / 2 - 100), now, 0.15);
  }

  return {
    start() {
      if (running) return;
      running = true;
      next = c.currentTime + 0.1;
      step = 0;
      bus.gain.setTargetAtTime(vol, c.currentTime, 0.8);
    },
    stop() {
      running = false;
      bus.gain.setTargetAtTime(0, c.currentTime, 0.4);
    },
    setVolume(v: number) {
      vol = v;
      if (running) bus.gain.setTargetAtTime(v, c.currentTime, 0.1);
    },
    /** 0 = calm, 0.35 = alert, 0.6+ = firefight, 0.9+ = climax. */
    setIntensity(v: number) {
      target = Math.max(0, Math.min(1, v));
    },
    setDuck(on: boolean) {
      duck = on ? 1 : 0;
    },
    /** Rising noise sweep into a phase change. */
    riser() {
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noise;
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 3;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(6000, t + 1.6);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.75);
      src.connect(f);
      f.connect(g);
      g.connect(tone);
      src.start(t, 0, 1.8);
    },
    /** Final chord: D major on success, a low cluster on failure. */
    stinger(win: boolean) {
      const t = c.currentTime + 0.05;
      const notes = win ? [50, 57, 62, 66, 69, 74] : [38, 39, 45, 50];
      for (const n of notes) {
        const o = c.createOscillator();
        o.type = win ? "sawtooth" : "triangle";
        o.frequency.value = midi(n);
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = win ? 2400 : 600;
        const g = c.createGain();
        env(g, t, win ? 0.035 : 0.06, 0.05, 3.2);
        o.connect(f);
        f.connect(g);
        g.connect(bus);
        g.connect(send);
        o.start(t);
        o.stop(t + 3.4);
      }
    },
    update(dt: number) {
      // rise fast, fall slowly so the score doesn't flap between bursts
      const rate = target > intensity ? 1.6 : 0.12;
      intensity += (target - intensity) * Math.min(1, dt * rate);
      levels();
      if (!running) return;
      if (next < c.currentTime) next = c.currentTime + 0.05;
      while (next < c.currentTime + 0.22) {
        schedule(next, step);
        step++;
        next += STEP;
      }
    },
    get intensity() {
      return intensity;
    },
  };
}
