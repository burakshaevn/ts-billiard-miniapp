import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PACKS,
  STAKES,
  WELCOME_BERRIES,
  berries,
  canAfford,
  isStake,
  packById,
  potFor,
  stakeLabel,
} from "./wallet.ts";

test("stakes are a closed list and are validated as such", () => {
  assert.ok(STAKES.includes(0));
  assert.ok(isStake(25));
  assert.equal(isStake(30), false, "an arbitrary stake must not be accepted");
  assert.equal(isStake("25"), false);
  assert.equal(isStake(-10), false);
  assert.equal(isStake(Infinity), false);
});

test("a free table is affordable with an empty wallet, a staked one is not", () => {
  assert.equal(canAfford(0, 0), true);
  assert.equal(canAfford(0, 10), false);
  assert.equal(canAfford(10, 10), true, "exactly the stake is enough");
  assert.equal(canAfford(9, 10), false);
  assert.ok(canAfford(WELCOME_BERRIES, 100), "the welcome gift opens a table");
});

test("the pot is both stakes together", () => {
  assert.equal(potFor(25), 50);
  assert.equal(potFor(0), 0);
  assert.equal(potFor(-5), 0, "a negative stake can never create a pot");
});

test("packs are unique, priced in whole stars and get cheaper per berry", () => {
  assert.equal(new Set(PACKS.map((p) => p.id)).size, PACKS.length);
  let previous = Infinity;
  for (const pack of PACKS) {
    assert.ok(Number.isInteger(pack.stars) && pack.stars > 0);
    assert.ok(Number.isInteger(pack.berries) && pack.berries > 0);
    const rate = pack.stars / pack.berries;
    assert.ok(rate <= previous, "a bigger pack must not be worse value");
    previous = rate;
  }
  assert.equal(packById(PACKS[0].id)?.berries, PACKS[0].berries);
  assert.equal(packById("berries-999999"), undefined);
  assert.equal(packById(42), undefined);
});

test("berries are spelled the Russian way", () => {
  assert.equal(berries(1), "1 ягодка");
  assert.equal(berries(3), "3 ягодки");
  assert.equal(berries(5), "5 ягодок");
  assert.equal(berries(11), "11 ягодок");
  assert.equal(berries(21), "21 ягодка");
  assert.equal(berries(114), "114 ягодок");
  assert.equal(stakeLabel(0), "без ставки");
  assert.equal(stakeLabel(50), "50 ягодок");
});
