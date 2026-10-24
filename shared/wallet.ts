/**
 * Ягодки — the virtual currency of Amazing Pool (the cherries of the logo).
 *
 * Everything here is pure arithmetic shared by the client and the server. The
 * server is the only authority: the client shows the balance it is told and
 * never computes its own.
 */

/** A fresh wallet starts with enough berries to try the cheap tables. */
export const WELCOME_BERRIES = 150;

/** Stakes a table can be opened with. 0 = просто так, без ставки. */
export const STAKES = [0, 10, 25, 50, 100] as const;
export type Stake = (typeof STAKES)[number];

export type Pack = {
  id: string;
  /** Berries credited after a successful payment. */
  berries: number;
  /** Price in Telegram Stars (currency XTR, whole stars). */
  stars: number;
};

/** Top-up packs. Bigger packs give more berries per star. */
export const PACKS: Pack[] = [
  { id: "berries-100", berries: 100, stars: 15 },
  { id: "berries-350", berries: 350, stars: 45 },
  { id: "berries-1000", berries: 1000, stars: 120 },
];

export const isStake = (value: unknown): value is Stake =>
  typeof value === "number" && (STAKES as readonly number[]).includes(value);

export const packById = (id: unknown): Pack | undefined =>
  typeof id === "string" ? PACKS.find((p) => p.id === id) : undefined;

/** Free tables are always affordable; a staked one needs the berries up front. */
export const canAfford = (balance: number, stake: number) =>
  stake <= 0 || balance >= stake;

/** Both players put the stake in; the winner takes the pot. */
export const potFor = (stake: number) => Math.max(0, stake) * 2;

/** 1 ягодка, 2 ягодки, 5 ягодок. */
export function berries(n: number) {
  const mod10 = n % 10,
    mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ягодка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${n} ягодки`;
  return `${n} ягодок`;
}

/** Spoken label for a stake: «без ставки» or «25 ягодок». */
export const stakeLabel = (stake: number) =>
  stake > 0 ? berries(stake) : "без ставки";
