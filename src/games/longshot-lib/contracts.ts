/**
 * LONGSHOT — contract definitions (text + tuning). Unit placement lives in the game, per id.
 */

export type ContractId = "sentry" | "courier" | "overwatch";

export type Contract = {
  id: ContractId;
  n: number;
  title: string;
  tag: string;
  brief: string;
  bullets: string[];
  ident?: string;
  /** base crosswind (m/s, + = blowing toward +X / right on screen) and gust amplitude */
  wind: [number, number];
  /** rounds carried, including the loaded magazine */
  rounds: number;
  stars: [string, string, string];
  par: number;
};

export const CONTRACTS: Contract[] = [
  {
    id: "sentry",
    n: 1,
    title: "SENTRY LINE",
    tag: "Five sentries hold the boulevard. Thin them out without starting a war.",
    brief:
      "A hostile cell has locked down District 07 ahead of a weapons drop. Five sentries walk the boulevard below your nest. Every shot echoes down the canyon — take them in an order that keeps the rest blind.",
    bullets: ["Eliminate all 5 sentries", "Bodies and near-misses raise the alarm", "Compromised → they fire on your nest"],
    wind: [1.2, 0.8],
    rounds: 15,
    stars: ["Contract complete", "Never compromised", "3+ headshots"],
    par: 120,
  },
  {
    id: "courier",
    n: 2,
    title: "THE COURIER",
    tag: "A courier walks a crowded street. Find him. Don't hit anyone else.",
    brief:
      "A courier is carrying the cell's encryption keys to a pickup in the side alley. The evening crowd is thick with umbrellas — you get one clean chance before he disappears.",
    bullets: ["Stop the courier before he reaches the alley", "Civilian casualties: 3 = contract void", "If his escort spots you, he runs"],
    ident: "AMBER CASE · NO UMBRELLA · TWO ARMED ESCORTS",
    wind: [-2.2, 1.6],
    rounds: 12,
    stars: ["Courier eliminated", "No civilian casualties", "Courier down before any alarm"],
    par: 70,
  },
  {
    id: "overwatch",
    n: 3,
    title: "SHEPHERD",
    tag: "Your fireteam pushes down the street. You are the only thing keeping them alive.",
    brief:
      "KESTREL and VOSS are moving to exfil at the far end of the boulevard. Hostiles will pour out of the side streets to pin them down. Watch for laser sights — and for the glint of a counter-sniper hunting you.",
    bullets: ["Escort the fireteam to exfil", "Red lasers = a hostile aiming at your team", "Violet glint = counter-sniper on you — duck or drop him"],
    wind: [0.6, 2.4],
    rounds: 30,
    stars: ["Fireteam reaches exfil", "Nobody goes down", "Under 3:30"],
    par: 210,
  },
];

export const contractById = (id: ContractId) => CONTRACTS.find((c) => c.id === id)!;
