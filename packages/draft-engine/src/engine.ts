import {
  DRAFT_SEQUENCE,
  TOTAL_STEPS,
  getStep,
  isCompleted,
  type DraftSide,
  type DraftStep,
} from './sequence';
import type {
  ActionInput,
  ApplyActionResult,
  AutoActionResolution,
  CreateInitialStateOptions,
  DraftState,
  LockedAction,
} from './types';

export const STEP_DURATION_MS = 30_000;

export function createInitialState(options: CreateInitialStateOptions): DraftState {
  return {
    draftId: options.draftId,
    status: 'LOBBY',
    currentStep: 0,
    actions: [],
    fearlessLockedChampionIds: [...(options.fearlessLockedChampionIds ?? [])],
    firstPickSide: options.firstPickSide ?? 'BLUE',
    timerDeadline: null,
    version: 0,
    startedAt: null,
    completedAt: null,
  };
}

/** Opposite draft side. */
export function otherSide(side: DraftSide): DraftSide {
  return side === 'BLUE' ? 'RED' : 'BLUE';
}

/**
 * Remap a canonical sequence step (defined with BLUE as first pick) onto the
 * side that actually holds first pick for this draft. When `firstPickSide` is
 * 'RED', every BLUE↔RED label is swapped so the red side acts on the "first"
 * slots — decoupling in-game side from pick order.
 */
function applyFirstPick(step: DraftStep, firstPickSide: DraftSide): DraftStep {
  if (firstPickSide === 'BLUE') return step;
  return { ...step, side: otherSide(step.side) };
}

export function beginCoinflip(state: DraftState): DraftState {
  if (state.status !== 'LOBBY') return state;
  return {
    ...state,
    status: 'COINFLIP',
    timerDeadline: null,
    version: state.version + 1,
  };
}

export function startDraft(state: DraftState, now: number): DraftState {
  if (state.status !== 'COINFLIP') return state;
  return {
    ...state,
    status: 'IN_PROGRESS',
    currentStep: 1,
    startedAt: now,
    timerDeadline: now + STEP_DURATION_MS,
    version: state.version + 1,
  };
}

export function pauseDraft(state: DraftState): DraftState {
  if (state.status !== 'IN_PROGRESS') return state;
  return { ...state, status: 'PAUSED', timerDeadline: null, version: state.version + 1 };
}

export function resumeDraft(state: DraftState, now: number): DraftState {
  if (state.status !== 'PAUSED') return state;
  return {
    ...state,
    status: 'IN_PROGRESS',
    timerDeadline: now + STEP_DURATION_MS,
    version: state.version + 1,
  };
}

export function cancelDraft(state: DraftState): DraftState {
  if (state.status === 'COMPLETED' || state.status === 'CANCELLED') return state;
  return { ...state, status: 'CANCELLED', timerDeadline: null, version: state.version + 1 };
}

export function getCurrentStep(state: DraftState): DraftStep | null {
  if (state.status !== 'IN_PROGRESS') return null;
  const step = getStep(state.currentStep);
  return step ? applyFirstPick(step, state.firstPickSide ?? 'BLUE') : null;
}

export function getCurrentSide(state: DraftState): DraftSide | null {
  return getCurrentStep(state)?.side ?? null;
}

/**
 * Champions that cannot be picked or banned in the current draft.
 * Includes all champions already locked in this draft + fearless-locked champions.
 */
export function getUnavailableChampionIds(state: DraftState): Set<string> {
  const set = new Set<string>(state.fearlessLockedChampionIds);
  for (const action of state.actions) {
    if (action.championId) set.add(action.championId);
  }
  return set;
}

/**
 * Champions banned in the current draft (cannot be picked but doesn't carry to next BO game).
 * Fearless lock applies only to picks across games — bans never carry.
 */
export function getBannedChampionIds(state: DraftState): Set<string> {
  const set = new Set<string>();
  for (const action of state.actions) {
    if (action.type === 'BAN' && action.championId) set.add(action.championId);
  }
  return set;
}

export function getPickedChampionIds(state: DraftState): Set<string> {
  const set = new Set<string>();
  for (const action of state.actions) {
    if (action.type === 'PICK' && action.championId) set.add(action.championId);
  }
  return set;
}

export function applyAction(state: DraftState, input: ActionInput): ApplyActionResult {
  if (state.status !== 'IN_PROGRESS') {
    return { ok: false, reason: 'NOT_IN_PROGRESS' };
  }

  const step = getCurrentStep(state);
  if (!step) {
    return { ok: false, reason: 'NO_CURRENT_STEP' };
  }

  if (input.actorSide !== step.side) {
    return { ok: false, reason: 'WRONG_SIDE' };
  }

  const picked = getPickedChampionIds(state);
  const banned = getBannedChampionIds(state);

  if (picked.has(input.championId) || banned.has(input.championId)) {
    return { ok: false, reason: 'CHAMPION_ALREADY_PICKED_OR_BANNED' };
  }

  if (state.fearlessLockedChampionIds.includes(input.championId)) {
    return { ok: false, reason: 'CHAMPION_FEARLESS_LOCKED' };
  }

  return { ok: true, ...lock(state, step, input.championId, false, input.now) };
}

/**
 * Resolve what an auto-action should be when the timer expires.
 * - For BAN steps: returns null championId (no-ban).
 * - For PICK steps: returns the first available championId from candidatePool.
 *   If no candidate is available, falls back to null (engine accepts but caller should flag).
 */
export function resolveAutoAction(
  state: DraftState,
  candidatePool: readonly string[],
): AutoActionResolution {
  const step = getCurrentStep(state);
  if (!step || step.type === 'BAN') {
    return { championId: null, wasAutoPicked: true };
  }

  const unavailable = getUnavailableChampionIds(state);
  for (const id of candidatePool) {
    if (!unavailable.has(id)) {
      return { championId: id, wasAutoPicked: true };
    }
  }
  return { championId: null, wasAutoPicked: true };
}

export function applyAutoAction(
  state: DraftState,
  resolution: AutoActionResolution,
  now: number,
): { state: DraftState; locked: LockedAction } | null {
  if (state.status !== 'IN_PROGRESS') return null;
  const step = getCurrentStep(state);
  if (!step) return null;
  return lock(state, step, resolution.championId, true, now);
}

function lock(
  state: DraftState,
  step: DraftStep,
  championId: string | null,
  wasAutoPicked: boolean,
  now: number,
): { state: DraftState; locked: LockedAction } {
  const locked: LockedAction = {
    step: step.step,
    type: step.type,
    side: step.side,
    championId,
    wasAutoPicked,
    lockedAt: now,
  };

  const nextStep = step.step + 1;
  const completed = isCompleted(step.step);

  const newState: DraftState = {
    ...state,
    actions: [...state.actions, locked],
    currentStep: completed ? state.currentStep : nextStep,
    status: completed ? 'COMPLETED' : state.status,
    timerDeadline: completed ? null : now + STEP_DURATION_MS,
    completedAt: completed ? now : state.completedAt,
    version: state.version + 1,
  };

  return { state: newState, locked };
}

export function isStepActive(state: DraftState, step: number): boolean {
  return state.status === 'IN_PROGRESS' && state.currentStep === step;
}

export function progressFraction(state: DraftState): number {
  const denom = TOTAL_STEPS;
  const numerator = Math.min(state.actions.length, denom);
  return numerator / denom;
}

export { DRAFT_SEQUENCE, TOTAL_STEPS, getStep, isCompleted };
