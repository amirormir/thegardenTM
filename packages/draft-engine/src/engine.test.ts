import { describe, expect, it } from 'vitest';
import {
  applyAction,
  applyAutoAction,
  beginCoinflip,
  cancelDraft,
  createInitialState,
  getBannedChampionIds,
  getCurrentSide,
  getCurrentStep,
  getPickedChampionIds,
  getUnavailableChampionIds,
  isCompleted,
  pauseDraft,
  resolveAutoAction,
  resumeDraft,
  startDraft,
  STEP_DURATION_MS,
  TOTAL_STEPS,
} from './engine';
import { DRAFT_SEQUENCE, getStep } from './sequence';
import type { DraftState } from './types';

const T0 = 1_000_000_000_000;

function freshDraft(overrides?: { fearless?: readonly string[] }) {
  return createInitialState({
    draftId: 'draft-1',
    fearlessLockedChampionIds: overrides?.fearless ?? [],
  });
}

function startedDraft(overrides?: { fearless?: readonly string[] }) {
  return startDraft(beginCoinflip(freshDraft(overrides)), T0);
}

function runSteps(state: DraftState, championsBySide: { BLUE: string[]; RED: string[] }) {
  let current = state;
  const blueIt = championsBySide.BLUE[Symbol.iterator]();
  const redIt = championsBySide.RED[Symbol.iterator]();

  for (let step = 1; step <= TOTAL_STEPS; step += 1) {
    const stepDef = getStep(step)!;
    const next = stepDef.side === 'BLUE' ? blueIt.next() : redIt.next();
    if (next.done) break;
    const result = applyAction(current, {
      championId: next.value as string,
      actorSide: stepDef.side,
      now: T0 + step * 1000,
    });
    if (!result.ok) throw new Error(`Step ${step} failed: ${result.reason}`);
    current = result.state;
  }
  return current;
}

describe('decoupled first pick (firstPickSide)', () => {
  it('defaults to BLUE picking/acting first', () => {
    const state = startedDraft();
    expect(state.firstPickSide).toBe('BLUE');
    expect(getCurrentSide(state)).toBe('BLUE');
  });

  it('lets RED act first when firstPickSide is RED (side/order decoupled)', () => {
    const base = createInitialState({ draftId: 'draft-red', firstPickSide: 'RED' });
    const state = startDraft(beginCoinflip(base), T0);

    // Step 1 is a BLUE ban in the canonical sequence — remapped to RED here.
    expect(getCurrentSide(state)).toBe('RED');
    expect(applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 }).ok).toBe(false);

    const res = applyAction(state, { championId: 'Aatrox', actorSide: 'RED', now: T0 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.locked.side).toBe('RED');
      // Step 2 (canonical RED) is remapped to BLUE.
      expect(getCurrentSide(res.state)).toBe('BLUE');
    }
  });
});

describe('DRAFT_SEQUENCE shape', () => {
  it('contains exactly 20 steps', () => {
    expect(DRAFT_SEQUENCE).toHaveLength(20);
  });

  it('has 10 bans and 10 picks', () => {
    const bans = DRAFT_SEQUENCE.filter((s) => s.type === 'BAN').length;
    const picks = DRAFT_SEQUENCE.filter((s) => s.type === 'PICK').length;
    expect(bans).toBe(10);
    expect(picks).toBe(10);
  });

  it('has 5 picks per side', () => {
    const bluePicks = DRAFT_SEQUENCE.filter(
      (s) => s.type === 'PICK' && s.side === 'BLUE',
    ).length;
    const redPicks = DRAFT_SEQUENCE.filter(
      (s) => s.type === 'PICK' && s.side === 'RED',
    ).length;
    expect(bluePicks).toBe(5);
    expect(redPicks).toBe(5);
  });

  it('has 5 bans per side', () => {
    const blueBans = DRAFT_SEQUENCE.filter((s) => s.type === 'BAN' && s.side === 'BLUE').length;
    const redBans = DRAFT_SEQUENCE.filter((s) => s.type === 'BAN' && s.side === 'RED').length;
    expect(blueBans).toBe(5);
    expect(redBans).toBe(5);
  });

  it('starts with Blue ban', () => {
    expect(DRAFT_SEQUENCE[0]).toMatchObject({ step: 1, type: 'BAN', side: 'BLUE' });
  });

  it('first pick goes to Blue (step 7)', () => {
    expect(DRAFT_SEQUENCE[6]).toMatchObject({ step: 7, type: 'PICK', side: 'BLUE' });
  });

  it('last pick goes to Red (step 20)', () => {
    expect(DRAFT_SEQUENCE[19]).toMatchObject({ step: 20, type: 'PICK', side: 'RED' });
  });
});

describe('createInitialState', () => {
  it('starts in LOBBY at step 0 with no actions', () => {
    const state = freshDraft();
    expect(state.status).toBe('LOBBY');
    expect(state.currentStep).toBe(0);
    expect(state.actions).toEqual([]);
    expect(state.timerDeadline).toBeNull();
  });

  it('carries fearless-locked champions', () => {
    const state = freshDraft({ fearless: ['Ahri', 'Aatrox'] });
    expect(state.fearlessLockedChampionIds).toEqual(['Ahri', 'Aatrox']);
  });
});

describe('startDraft', () => {
  it('transitions LOBBY → IN_PROGRESS and sets timer', () => {
    const state = startDraft(beginCoinflip(freshDraft()), T0);
    expect(state.status).toBe('IN_PROGRESS');
    expect(state.currentStep).toBe(1);
    expect(state.timerDeadline).toBe(T0 + STEP_DURATION_MS);
    expect(state.startedAt).toBe(T0);
  });

  it('is a no-op if called before coinflip', () => {
    const lobby = freshDraft();
    expect(startDraft(lobby, T0)).toBe(lobby);
  });

  it('is a no-op if already in progress', () => {
    const started = startedDraft();
    const again = startDraft(started, T0 + 9999);
    expect(again).toBe(started);
  });

  it('bumps version', () => {
    const state = beginCoinflip(freshDraft());
    expect(startDraft(state, T0).version).toBe(state.version + 1);
  });
});

describe('applyAction — happy path', () => {
  it('locks the action and advances to step 2', () => {
    const state = startedDraft();
    const res = applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 + 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.currentStep).toBe(2);
    expect(res.state.actions).toHaveLength(1);
    expect(res.locked).toMatchObject({
      step: 1,
      type: 'BAN',
      side: 'BLUE',
      championId: 'Aatrox',
      wasAutoPicked: false,
    });
  });

  it('refreshes the timer deadline', () => {
    const state = startedDraft();
    const res = applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 + 1000 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.state.timerDeadline).toBe(T0 + 1000 + STEP_DURATION_MS);
  });

  it('full 20-step run reaches COMPLETED', () => {
    const final = runSteps(startedDraft(), {
      BLUE: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
      RED: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'],
    });
    expect(final.status).toBe('COMPLETED');
    expect(final.currentStep).toBe(20);
    expect(final.actions).toHaveLength(20);
    expect(final.timerDeadline).toBeNull();
    expect(final.completedAt).not.toBeNull();
  });
});

describe('applyAction — validation', () => {
  it('rejects if not IN_PROGRESS', () => {
    const state = freshDraft();
    const res = applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_IN_PROGRESS');
  });

  it('rejects wrong side', () => {
    const state = startedDraft();
    const res = applyAction(state, { championId: 'Aatrox', actorSide: 'RED', now: T0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('WRONG_SIDE');
  });

  it('rejects already-banned champion', () => {
    let state = startedDraft();
    const first = applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 });
    if (!first.ok) throw new Error('expected ok');
    state = first.state;
    // step 2 is RED ban
    const dup = applyAction(state, { championId: 'Aatrox', actorSide: 'RED', now: T0 + 100 });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('CHAMPION_ALREADY_PICKED_OR_BANNED');
  });

  it('rejects already-picked champion', () => {
    const partial = runSteps(startedDraft(), {
      BLUE: ['B1', 'B2', 'B3', 'P1'],
      RED: ['R1', 'R2', 'R3'],
    });
    // we ran 7 steps, step 8 is RED pick — try to pick P1
    expect(partial.currentStep).toBe(8);
    const dup = applyAction(partial, { championId: 'P1', actorSide: 'RED', now: T0 + 999 });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('CHAMPION_ALREADY_PICKED_OR_BANNED');
  });

  it('rejects fearless-locked champion', () => {
    const state = startedDraft({ fearless: ['Aatrox'] });
    const res = applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('CHAMPION_FEARLESS_LOCKED');
  });
});

describe('getUnavailableChampionIds', () => {
  it('combines fearless lock + already-picked/banned', () => {
    let state = startedDraft({ fearless: ['Yone'] });
    const first = applyAction(state, { championId: 'Aatrox', actorSide: 'BLUE', now: T0 });
    if (!first.ok) throw new Error('expected ok');
    state = first.state;
    const unavailable = getUnavailableChampionIds(state);
    expect(unavailable.has('Yone')).toBe(true);
    expect(unavailable.has('Aatrox')).toBe(true);
  });
});

describe('resolveAutoAction', () => {
  it('returns null championId on a BAN step', () => {
    const state = startedDraft();
    const res = resolveAutoAction(state, ['Aatrox', 'Ahri']);
    expect(res).toEqual({ championId: null, wasAutoPicked: true });
  });

  it('returns the first available champion on a PICK step', () => {
    const state = runSteps(startedDraft(), {
      BLUE: ['B1', 'B2', 'B3'],
      RED: ['R1', 'R2', 'R3'],
    });
    // step 7 is BLUE pick. B1/B2/B3/R1/R2/R3 are banned.
    expect(state.currentStep).toBe(7);
    const res = resolveAutoAction(state, ['B1', 'P1', 'P2']);
    expect(res.championId).toBe('P1');
  });

  it('falls back to null when no candidate is available', () => {
    const state = runSteps(startedDraft(), {
      BLUE: ['B1', 'B2', 'B3'],
      RED: ['R1', 'R2', 'R3'],
    });
    expect(state.currentStep).toBe(7);
    const res = resolveAutoAction(state, ['B1', 'B2', 'R1']);
    expect(res.championId).toBeNull();
  });

  it('skips fearless-locked candidates', () => {
    const state = startDraft(beginCoinflip(freshDraft({ fearless: ['P1'] })), T0);
    const advanced = runSteps(state, {
      BLUE: ['B1', 'B2', 'B3'],
      RED: ['R1', 'R2', 'R3'],
    });
    expect(advanced.currentStep).toBe(7);
    const res = resolveAutoAction(advanced, ['P1', 'P2']);
    expect(res.championId).toBe('P2');
  });
});

describe('applyAutoAction', () => {
  it('locks a null ban and advances', () => {
    const state = startedDraft();
    const resolution = resolveAutoAction(state, []);
    const result = applyAutoAction(state, resolution, T0 + 30_000);
    expect(result).not.toBeNull();
    expect(result!.locked).toMatchObject({
      step: 1,
      type: 'BAN',
      side: 'BLUE',
      championId: null,
      wasAutoPicked: true,
    });
    expect(result!.state.currentStep).toBe(2);
  });

  it('returns null if not IN_PROGRESS', () => {
    const state = freshDraft();
    const result = applyAutoAction(
      state,
      { championId: null, wasAutoPicked: true },
      T0,
    );
    expect(result).toBeNull();
  });
});

describe('pauseDraft / resumeDraft', () => {
  it('pause clears the timer', () => {
    const paused = pauseDraft(startedDraft());
    expect(paused.status).toBe('PAUSED');
    expect(paused.timerDeadline).toBeNull();
  });

  it('resume restores a fresh timer and IN_PROGRESS', () => {
    const paused = pauseDraft(startedDraft());
    const resumed = resumeDraft(paused, T0 + 5000);
    expect(resumed.status).toBe('IN_PROGRESS');
    expect(resumed.timerDeadline).toBe(T0 + 5000 + STEP_DURATION_MS);
  });

  it('pause is a no-op when not IN_PROGRESS', () => {
    const state = freshDraft();
    expect(pauseDraft(state)).toBe(state);
  });

  it('resume is a no-op when not PAUSED', () => {
    const state = startedDraft();
    expect(resumeDraft(state, T0 + 5000)).toBe(state);
  });
});

describe('cancelDraft', () => {
  it('marks as CANCELLED from any active status', () => {
    expect(cancelDraft(startedDraft()).status).toBe('CANCELLED');
    expect(cancelDraft(pauseDraft(startedDraft())).status).toBe('CANCELLED');
    expect(cancelDraft(freshDraft()).status).toBe('CANCELLED');
  });

  it('no-ops on COMPLETED or already CANCELLED', () => {
    const completed: DraftState = { ...freshDraft(), status: 'COMPLETED' };
    expect(cancelDraft(completed)).toBe(completed);
  });
});

describe('isCompleted', () => {
  it('returns true at step 20', () => {
    expect(isCompleted(20)).toBe(true);
  });

  it('returns false at step 19', () => {
    expect(isCompleted(19)).toBe(false);
  });
});

describe('getCurrentStep / getCurrentSide', () => {
  it('returns null when not IN_PROGRESS', () => {
    expect(getCurrentStep(freshDraft())).toBeNull();
    expect(getCurrentSide(freshDraft())).toBeNull();
  });

  it('returns the current step definition', () => {
    const state = startedDraft();
    expect(getCurrentStep(state)).toMatchObject({ step: 1, type: 'BAN', side: 'BLUE' });
    expect(getCurrentSide(state)).toBe('BLUE');
  });
});

describe('getPickedChampionIds / getBannedChampionIds', () => {
  it('separates picks from bans', () => {
    const partial = runSteps(startedDraft(), {
      BLUE: ['B1', 'B2', 'B3', 'P1'],
      RED: ['R1', 'R2', 'R3'],
    });
    // 6 bans + 1 pick done
    expect(getBannedChampionIds(partial).size).toBe(6);
    expect(getPickedChampionIds(partial).has('P1')).toBe(true);
  });

  it('ignores null championIds (auto bans on timeout)', () => {
    const state = startedDraft();
    const result = applyAutoAction(state, { championId: null, wasAutoPicked: true }, T0);
    if (!result) throw new Error('expected result');
    expect(getBannedChampionIds(result.state).size).toBe(0);
  });
});

describe('beginCoinflip', () => {
  it('transitions LOBBY â†’ COINFLIP without starting the timer', () => {
    const state = beginCoinflip(freshDraft());
    expect(state.status).toBe('COINFLIP');
    expect(state.currentStep).toBe(0);
    expect(state.timerDeadline).toBeNull();
  });

  it('is a no-op outside LOBBY', () => {
    const started = startedDraft();
    expect(beginCoinflip(started)).toBe(started);
  });
});
