import { describe, expect, it } from 'vitest';
import { CEIL, FLOOR, SEED_BASELINE, SEED_VOL } from './config';
import { ValueEngine, target } from './value-engine';

const M = 1_000_000;

function runSequence(start: number, notes: number[]) {
  const engine = new ValueEngine(start, SEED_BASELINE, SEED_VOL);
  const steps = notes.map((note) => {
    const r = engine.update(note);
    return { note, value: r.value, delta: r.delta };
  });
  return { engine, steps };
}

/** Repeat one note until the engine settles at target(note). */
function plateau(start: number, note: number, iters = 40): number {
  const engine = new ValueEngine(start, SEED_BASELINE, SEED_VOL);
  for (let i = 0; i < iters; i += 1) engine.update(note);
  return engine.value;
}

describe('target() — convex mapping [FLOOR, CEIL] = [10M, 150M]', () => {
  it('anchors the extremes at floor and ceiling', () => {
    expect(target(0)).toBe(FLOOR);
    expect(target(100)).toBe(CEIL);
  });

  it('keeps the average player (~baseline 50) near ~32.5M (unchanged vs old scale)', () => {
    expect(target(50)).toBeGreaterThan(31 * M);
    expect(target(50)).toBeLessThan(34 * M);
  });

  it('is strictly increasing', () => {
    expect(target(30)).toBeLessThan(target(50));
    expect(target(50)).toBeLessThan(target(75));
    expect(target(75)).toBeLessThan(target(90));
    expect(target(90)).toBeLessThan(target(100));
  });

  it('is convex — the top is stretched, only elites approach 150M', () => {
    // Upper gap (50->75) far larger than lower gap (25->50).
    expect(target(75) - target(50)).toBeGreaterThan(target(50) - target(25));
    // A below-average player stays modest, not inflated.
    expect(target(30)).toBeLessThan(20 * M);
  });
});

describe('ValueEngine — converges toward target(note)', () => {
  it('a steady average (50) player stays around ~32.5M', () => {
    const v = plateau(32.5 * M, 50);
    expect(v).toBeGreaterThan(30 * M);
    expect(v).toBeLessThan(35 * M);
  });

  it('a steady strong (75) player settles clearly higher (~75M)', () => {
    const v = plateau(32.5 * M, 75);
    expect(v).toBeGreaterThan(target(75) - 3 * M);
    expect(v).toBeLessThan(target(75) + 3 * M);
  });

  it('a steady weak (30) player sinks below the average (~16M)', () => {
    const v = plateau(32.5 * M, 30);
    expect(v).toBeLessThan(32.5 * M);
    expect(v).toBeGreaterThan(target(30) - 3 * M);
    expect(v).toBeLessThan(target(30) + 3 * M);
  });

  it('a sustained elite (90) climbs well past the old 55M cap', () => {
    const v = plateau(32.5 * M, 90, 60);
    expect(v).toBeGreaterThan(100 * M);
    expect(v).toBeLessThanOrEqual(CEIL);
  });

  it('a near-perfect (100) run approaches the 150M ceiling', () => {
    const v = plateau(32.5 * M, 100, 60);
    expect(v).toBeGreaterThan(140 * M);
    expect(v).toBeLessThanOrEqual(CEIL);
  });
});

describe('ValueEngine — dynamics', () => {
  it('rises on repeated strong games, then a below-form game pulls it back down', () => {
    const { steps } = runSequence(32.5 * M, [80, 80, 80, 80, 80, 60]);
    for (const up of steps.slice(0, 5)) expect(up.delta).toBeGreaterThan(0);
    expect(steps[4]!.value).toBeGreaterThan(32.5 * M);
    expect(steps[4]!.value).toBeLessThanOrEqual(CEIL);
    // A 60 under a recent ~80 form pulls the value down.
    expect(steps[5]!.delta).toBeLessThan(0);
  });

  it('repeated identical notes converge — moves tighten (regularity dampens)', () => {
    const engine = new ValueEngine(32.5 * M);
    const deltas: number[] = [];
    for (let i = 0; i < 20; i += 1) deltas.push(engine.update(75).delta);
    const peak = Math.max(...deltas.map(Math.abs));
    expect(Math.abs(deltas[deltas.length - 1]!)).toBeLessThan(peak * 0.5);
  });

  it('gains are asymmetric — up amplified when cheap, down amplified when pricey', () => {
    const upLow = new ValueEngine(15 * M).update(80).delta;
    const upHigh = new ValueEngine(45 * M).update(80).delta;
    const downLow = new ValueEngine(15 * M).update(20).delta;
    const downHigh = new ValueEngine(45 * M).update(20).delta;

    // Cheap + good surprise => the biggest upward move.
    expect(upLow).toBeGreaterThan(upHigh);
    expect(upLow).toBeGreaterThan(3 * M);
    // Pricey + bad surprise => the biggest downward move.
    expect(downHigh).toBeLessThan(downLow);
    // Cheap + bad surprise stays protected (no big loss).
    expect(downLow).toBeGreaterThan(-2 * M);
  });

  it('an isolated catastrophe dents without assassinating, and is recoverable', () => {
    const engine = new ValueEngine(32.5 * M);
    for (let i = 0; i < 15; i += 1) engine.update(78);
    const before = engine.value;

    const crash = engine.update(10);
    const lossPct = (-crash.delta / before) * 100;
    expect(lossPct).toBeGreaterThan(0);
    expect(lossPct).toBeLessThan(10); // pas d'assassinat

    const recovery = engine.update(78);
    expect(recovery.delta).toBeGreaterThan(0);
  });
});

describe('ValueEngine — invariants', () => {
  it('value stays within [FLOOR, CEIL] over a long noisy run', () => {
    const engine = new ValueEngine(FLOOR);
    const notes = [0, 100, 0, 100, 50, 80, 20, 95, 5, 60, 40, 10, 90, 30, 70];
    for (let i = 0; i < 300; i += 1) {
      const r = engine.update(notes[i % notes.length]!);
      expect(r.value).toBeGreaterThanOrEqual(FLOOR);
      expect(r.value).toBeLessThanOrEqual(CEIL);
    }
  });

  it('is a faithful port: applyNote is pure and matches the stateful engine', () => {
    const a = new ValueEngine(32.5 * M).update(70);
    const b = new ValueEngine(32.5 * M).update(70);
    expect(a.value).toBe(b.value);
    expect(a.baseline).toBe(b.baseline);
    expect(a.volatility).toBe(b.volatility);
  });
});
