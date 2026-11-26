/**
 * FREEFALL: wingsuit flight model (pure maths, no THREE).
 *
 * The pitch stick commands an angle of attack (not an attitude), roll banks the wing. Lift acts along the
 * banked wing normal, drag opposes the velocity, so a dive trades altitude for speed, a flare trades speed
 * for lift (and stalls if you hold it too long), and banking turns the velocity vector. Everything is
 * v²-based, so the feel is physical but readable.
 */

export const G = 9.81;
export const KD0 = 0.00135; // body drag (dive terminal ≈ 86 m/s)
export const KDA = 0.011; // induced-ish drag from α²
export const KL = 0.0082; // lift scale
export const ALPHA_STALL = 0.42;
export const SIDE = 11; // arcade side-force while banked (m/s²)
export const BOOST_ACC = 30;
export const V_SOFT_MAX = 112; // m/s ≈ 400 km/h hard-ish ceiling

export type Flight = {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  bank: number; // +right wing down
  alpha: number; // current angle of attack
  psi: number; // heading memory (f0 = [sin psi, 0, -cos psi])
  fuel: number; // 0..100
  brakeE: number; // 0..100 air-brake energy
  brakeAmt: number; // smoothed 0..1
  boosting: boolean;
  stall: number; // 0..1
  g: number; // load factor (lift / g)
  chute: number; // 0 = stowed, otherwise seconds since deployment
  chuteOpen: number; // 0..1
  hdg: number; // canopy heading
};

export type FlightInput = { pitch: number; roll: number; boost: boolean; brake: boolean };

export type Frame = {
  f: [number, number, number]; // body forward (nose)
  n: [number, number, number]; // wing normal (up out of the back)
  r: [number, number, number]; // right
  vhat: [number, number, number];
  speed: number;
};

export function newFlight(x: number, y: number, z: number, psi: number): Flight {
  return {
    px: x,
    py: y,
    pz: z,
    vx: Math.sin(psi) * 16,
    vy: 2,
    vz: -Math.cos(psi) * 16,
    bank: 0,
    alpha: 0.2,
    psi,
    fuel: 60,
    brakeE: 100,
    brakeAmt: 0,
    boosting: false,
    stall: 0,
    g: 1,
    chute: 0,
    chuteOpen: 0,
    hdg: psi,
  };
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function cl(alpha: number): number {
  const a = Math.abs(alpha);
  const s = Math.sign(alpha) || 1;
  const k = s < 0 ? 0.55 : 1;
  const v = a <= ALPHA_STALL ? Math.sin((Math.PI / 2) * (a / ALPHA_STALL)) : 1 - 0.6 * sstep(ALPHA_STALL, ALPHA_STALL + 0.45, a);
  return s * k * v;
}

/** Angle of attack commanded by the pitch stick (+1 = flare / pull back, -1 = dive). */
export function alphaFor(pitch: number): number {
  return pitch >= 0 ? 0.17 + pitch * 0.4 : 0.17 + pitch * 0.25;
}

export function frameOf(s: Flight, out: Frame): Frame {
  const sp = Math.hypot(s.vx, s.vy, s.vz) || 1e-6;
  const vx = s.vx / sp;
  const vy = s.vy / sp;
  const vz = s.vz / sp;
  // r0 ⟂ vhat from heading memory
  let rx = Math.cos(s.psi);
  let rz = Math.sin(s.psi);
  const d = rx * vx + rz * vz;
  rx -= d * vx;
  let ry = -d * vy;
  rz -= d * vz;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // u0 = r0 × vhat
  const ux = ry * vz - rz * vy;
  const uy = rz * vx - rx * vz;
  const uz = rx * vy - ry * vx;
  const cb = Math.cos(s.bank);
  const sb = Math.sin(s.bank);
  // banked up (wing normal) and right
  const nx = ux * cb + rx * sb;
  const ny = uy * cb + ry * sb;
  const nz = uz * cb + rz * sb;
  const brx = rx * cb - ux * sb;
  const bry = ry * cb - uy * sb;
  const brz = rz * cb - uz * sb;
  const ca = Math.cos(s.alpha);
  const sa = Math.sin(s.alpha);
  out.vhat = [vx, vy, vz];
  out.n = [nx, ny, nz];
  out.r = [brx, bry, brz];
  out.f = [vx * ca + nx * sa, vy * ca + ny * sa, vz * ca + nz * sa];
  out.speed = sp;
  return out;
}

const tmpFrame: Frame = { f: [0, 0, -1], n: [0, 1, 0], r: [1, 0, 0], vhat: [0, 0, -1], speed: 1 };

/** Wingsuit step (stowed canopy). */
export function stepWing(s: Flight, inp: FlightInput, dt: number) {
  // control surfaces
  const aT = alphaFor(inp.pitch);
  const da = aT - s.alpha;
  const maxA = 2.6 * dt;
  s.alpha += Math.max(-maxA, Math.min(maxA, da)) * Math.min(1, 1 + Math.abs(da) * 2);
  const bT = inp.roll * 1.2;
  s.bank += (bT - s.bank) * (1 - Math.exp(-dt * 4.2));
  // heading memory
  const hs = Math.hypot(s.vx, s.vz);
  if (hs > 4) s.psi = Math.atan2(s.vx, -s.vz);

  const fr = frameOf(s, tmpFrame);
  const sp = fr.speed;
  const [vx, vy, vz] = fr.vhat;
  const [nx, ny, nz] = fr.n;
  const [rx, ry, rz] = fr.r;
  const [fx, fy, fz] = fr.f;

  // brake energy
  const wantBrake = inp.brake && s.brakeE > 2;
  s.brakeAmt += ((wantBrake ? 1 : 0) - s.brakeAmt) * (1 - Math.exp(-dt * 7));
  if (wantBrake) s.brakeE = Math.max(0, s.brakeE - 55 * dt);
  else s.brakeE = Math.min(100, s.brakeE + 18 * dt);

  const c = cl(s.alpha);
  const a = Math.abs(s.alpha);
  const stall = sstep(ALPHA_STALL, ALPHA_STALL + 0.3, a);
  s.stall += (stall - s.stall) * (1 - Math.exp(-dt * 8));
  const lowSpeed = 1 - sstep(10, 26, sp); // weak control at tiny speeds
  const q = sp * sp;
  const lift = KL * c * q;
  const drag = (KD0 * (1 + 4.2 * s.brakeAmt) + KDA * a * a + 0.0034 * stall) * q;

  let ax = -vx * drag + nx * lift;
  let ay = -G - vy * drag + ny * lift;
  let az = -vz * drag + nz * lift;
  // arcade side force while banked
  const side = SIDE * Math.sin(s.bank) * Math.min(1, sp / 30) * (1 - lowSpeed);
  ax += rx * side;
  ay += ry * side;
  az += rz * side;
  // boost
  s.boosting = inp.boost && s.fuel > 0.5;
  if (s.boosting) {
    ax += fx * BOOST_ACC;
    ay += fy * BOOST_ACC;
    az += fz * BOOST_ACC;
    s.fuel = Math.max(0, s.fuel - 24 * dt);
  }
  // soft ceiling
  if (sp > V_SOFT_MAX) {
    const k = (sp - V_SOFT_MAX) * 1.5;
    ax -= vx * k;
    ay -= vy * k;
    az -= vz * k;
  }
  s.g = Math.hypot(nx * lift + rx * side, ny * lift + ry * side, nz * lift + rz * side) / G;
  s.vx += ax * dt;
  s.vy += ay * dt;
  s.vz += az * dt;
  s.px += s.vx * dt;
  s.py += s.vy * dt;
  s.pz += s.vz * dt;
}

export const CHUTE_VY = -8.4;
/** Canopy descent: velocity relaxes toward a slow glide; steer with roll (turn) and pitch (speed). */
export function stepCanopy(s: Flight, inp: FlightInput, dt: number) {
  s.chute += dt;
  s.chuteOpen = Math.min(1, s.chute / 0.5);
  s.bank += (inp.roll * 0.45 - s.bank) * (1 - Math.exp(-dt * 3));
  s.hdg += inp.roll * 0.85 * dt;
  s.alpha += (0.1 - s.alpha) * (1 - Math.exp(-dt * 4));
  const fwd = 11 - inp.pitch * 6; // pitch back slows the canopy, forward speeds it up
  const tx = Math.sin(s.hdg) * fwd;
  const tz = -Math.cos(s.hdg) * fwd;
  const k = 3.2 * s.chuteOpen * s.chuteOpen + 0.15;
  const e = 1 - Math.exp(-dt * k);
  s.vx += (tx - s.vx) * e;
  s.vz += (tz - s.vz) * e;
  s.vy += (CHUTE_VY - s.vy) * e;
  s.psi = s.hdg;
  s.px += s.vx * dt;
  s.py += s.vy * dt;
  s.pz += s.vz * dt;
  s.g = 1;
  s.stall = 0;
  s.boosting = false;
  s.brakeE = Math.min(100, s.brakeE + 18 * dt);
  s.brakeAmt *= 0.9;
}

export function deployChute(s: Flight) {
  if (s.chute > 0) return false;
  s.chute = 1e-4;
  s.hdg = Math.atan2(s.vx, -s.vz);
  if (Math.hypot(s.vx, s.vz) < 3) s.hdg = s.psi;
  return true;
}

/** Altitude a canopy needs to arrest the current vertical speed (conservative estimate, m). */
export function chuteNeed(vy: number): number {
  const v = Math.max(0, -vy - 6);
  return v * 0.62 + 6;
}
