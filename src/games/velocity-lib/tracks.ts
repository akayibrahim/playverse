/**
 * VELOCITY — sky-lane circuits. Control points are [x, altitude, z] in metres; the track is a
 * closed centripetal Catmull-Rom through them, banked by curvature.
 */

export type TrackId = "neon" | "skyfall";

export type TrackDef = {
  id: TrackId;
  n: number;
  name: string;
  tag: string;
  pts: Array<[number, number, number]>;
  width: number;
  rail: number;
  rail2: number;
  laps: number;
  /** [s fraction, lateral -1..1] boost pads */
  pads: Array<[number, number]>;
};

export const TRACKS: TrackDef[] = [
  {
    id: "neon",
    n: 1,
    name: "NEON MILE",
    tag: "A flowing loop through the District 07 megablocks. Learn the lines, then hunt the gold.",
    pts: [
      [0, 12, 306],
      [0, 12, 102],
      [34, 14, -68],
      [153, 21, -187],
      [289, 34, -255],
      [377, 48, -150],
      [394, 57, 17],
      [313, 53, 156],
      [177, 39, 190],
      [82, 30, 105],
      [-51, 25, 65],
      [-187, 30, 136],
      [-286, 34, 255],
      [-255, 25, 405],
      [-109, 16, 459],
      [-20, 12, 411],
    ],
    width: 17,
    rail: 0x35f0ff,
    rail2: 0xff3fc8,
    laps: 3,
    pads: [
      [0.06, 0],
      [0.31, -0.4],
      [0.55, 0.35],
      [0.82, 0],
    ],
  },
  {
    id: "skyfall",
    n: 2,
    name: "SKYFALL",
    tag: "Seventy-metre drops, a climb over the rooftops and a dive under the start straight.",
    pts: [
      [0, 80, 340],
      [0, 83, 136],
      [51, 85, -34],
      [187, 69, -139],
      [340, 37, -105],
      [415, 14, 34],
      [347, 12, 190],
      [224, 23, 309],
      [105, 39, 377],
      [-14, 53, 309],
      [-105, 64, 190],
      [-211, 71, 241],
      [-228, 76, 394],
      [-105, 80, 462],
    ],
    width: 16,
    rail: 0xff3fc8,
    rail2: 0xffb547,
    laps: 3,
    pads: [
      [0.04, 0],
      [0.28, 0.4],
      [0.47, -0.35],
      [0.7, 0],
      [0.9, 0.3],
    ],
  },
];

export const trackById = (id: TrackId) => TRACKS.find((t) => t.id === id)!;

export const RIVALS: Array<{ name: string; color: number; skill: number }> = [
  { name: "KESTREL", color: 0x7dffb0, skill: 0.985 },
  { name: "NOVA", color: 0xff3fc8, skill: 0.965 },
  { name: "RAIJIN", color: 0xffb547, skill: 0.95 },
  { name: "HEX", color: 0x9a5cff, skill: 0.935 },
  { name: "VOSS", color: 0xff4d5c, skill: 0.915 },
];
