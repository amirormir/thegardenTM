import {
  applyAction,
  applyAutoAction,
  cancelDraft,
  getCurrentStep,
  pauseDraft,
  resolveAutoAction,
  resumeDraft,
  startDraft,
  STEP_DURATION_MS,
  TOTAL_STEPS,
  type DraftSide,
  type DraftState,
  type LockedAction,
} from '@nexus/draft-engine';
import { prisma } from '@nexus/db';
import { logger } from './logger.js';
import {
  fetchFearlessLocks,
  hydrateStateFromDatabase,
  markDraftCancelled,
  markDraftPaused,
  markDraftResumed,
  markDraftStarted,
  persistLockedAction,
} from './persistence.js';
import { commitDraftState, loadDraftState, saveDraftState, withDraftLock } from './state.js';
import {
  cancelAllStepTimeouts,
  cancelStepTimeout,
  scheduleStepTimeout,
} from './timer-queue.js';

export type ControllerErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_ACTION'
  | 'WRONG_SIDE'
  | 'CHAMPION_UNAVAILABLE'
  | 'STALE_VERSION';

export class ControllerError extends Error {
  constructor(public readonly code: ControllerErrorCode, message: string) {
    super(message);
    this.name = 'ControllerError';
  }
}

async function getOrHydrate(draftId: string): Promise<DraftState | null> {
  const cached = await loadDraftState(draftId);
  if (cached) return cached;
  const hydrated = await hydrateStateFromDatabase(draftId);
  if (hydrated) await saveDraftState(hydrated);
  return hydrated;
}

export async function getState(draftId: string): Promise<DraftState | null> {
  return getOrHydrate(draftId);
}

interface SchedulerCallbacks {
  onAction: (state: DraftState, action: LockedAction) => Promise<void> | void;
  onCompleted: (state: DraftState) => Promise<void> | void;
  onTimer: (state: DraftState) => Promise<void> | void;
  onStarted: (state: DraftState) => Promise<void> | void;
  onPaused: (state: DraftState) => Promise<void> | void;
  onResumed: (state: DraftState) => Promise<void> | void;
  onCancelled: (state: DraftState) => Promise<void> | void;
}

export interface DraftController {
  start(draftId: string): Promise<DraftState>;
  pause(draftId: string): Promise<DraftState>;
  resume(draftId: string): Promise<DraftState>;
  cancel(draftId: string): Promise<DraftState>;
  applyPlayerAction(args: {
    draftId: string;
    actorSide: DraftSide;
    championId: string;
    expectedStep: number;
    expectedVersion: number;
  }): Promise<{ state: DraftState; action: LockedAction }>;
  handleTimeout(args: { draftId: string; step: number; expectedVersion: number }): Promise<void>;
}

export function createDraftController(callbacks: SchedulerCallbacks): DraftController {
  async function commitAndSchedule(state: DraftState, prev: number): Promise<DraftState> {
    const ok = await commitDraftState(state, prev);
    if (!ok) throw new ControllerError('STALE_VERSION', 'Draft state changed mid-transaction.');

    if (state.status === 'IN_PROGRESS' && state.timerDeadline) {
      const delay = state.timerDeadline - Date.now();
      await scheduleStepTimeout(
        { draftId: state.draftId, step: state.currentStep, version: state.version },
        delay,
      );
      await callbacks.onTimer(state);
    } else {
      await cancelAllStepTimeouts(state.draftId);
    }

    return state;
  }

  return {
    async start(draftId) {
      return withDraftLock(draftId, async () => {
        const state = await getOrHydrate(draftId);
        if (!state) throw new ControllerError('NOT_FOUND', 'Draft not found.');
        if (state.status !== 'COINFLIP') {
          throw new ControllerError('CONFLICT', 'Draft is not ready to start yet.');
        }

        // Sequential gate: game N (N>1) requires game N-1 to be COMPLETED.
        // This also enforces "one game running at a time" within a match.
        const meta = await prisma.draft.findUnique({
          where: { id: draftId },
          select: {
            matchId: true,
            gameNumber: true,
            coinflipResolvedAt: true,
            firstPickSide: true,
          },
        });
        if (!meta?.coinflipResolvedAt) {
          throw new ControllerError('CONFLICT', 'Coin flip decision must be resolved first.');
        }
        if (meta && meta.gameNumber > 1) {
          const prev = await prisma.draft.findFirst({
            where: { matchId: meta.matchId, gameNumber: meta.gameNumber - 1 },
            select: { status: true, winnerSide: true },
          });
          if (!prev || prev.status !== 'COMPLETED' || prev.winnerSide === null) {
            throw new ControllerError(
              'CONFLICT',
              `Game ${meta.gameNumber} requires game ${meta.gameNumber - 1} result to be confirmed first.`,
            );
          }
        }

        // Refresh fearless locks at start time so picks from earlier games
        // (only finalised once they complete) carry into this draft.
        const fearless = await fetchFearlessLocks(draftId);

        const now = Date.now();
        const next = startDraft(
          {
            ...state,
            fearlessLockedChampionIds: fearless,
            firstPickSide: meta.firstPickSide ?? state.firstPickSide,
          },
          now,
        );
        await markDraftStarted(draftId, now);
        const committed = await commitAndSchedule(next, state.version);
        await callbacks.onStarted(committed);
        return committed;
      });
    },

    async pause(draftId) {
      return withDraftLock(draftId, async () => {
        const state = await getOrHydrate(draftId);
        if (!state) throw new ControllerError('NOT_FOUND', 'Draft not found.');
        if (state.status !== 'IN_PROGRESS') {
          throw new ControllerError('CONFLICT', 'Draft is not running.');
        }
        const next = pauseDraft(state);
        await markDraftPaused(draftId);
        await cancelAllStepTimeouts(draftId);
        const committed = await commitAndSchedule(next, state.version);
        await callbacks.onPaused(committed);
        return committed;
      });
    },

    async resume(draftId) {
      return withDraftLock(draftId, async () => {
        const state = await getOrHydrate(draftId);
        if (!state) throw new ControllerError('NOT_FOUND', 'Draft not found.');
        if (state.status !== 'PAUSED') {
          throw new ControllerError('CONFLICT', 'Draft is not paused.');
        }
        const next = resumeDraft(state, Date.now());
        await markDraftResumed(draftId);
        const committed = await commitAndSchedule(next, state.version);
        await callbacks.onResumed(committed);
        return committed;
      });
    },

    async cancel(draftId) {
      return withDraftLock(draftId, async () => {
        const state = await getOrHydrate(draftId);
        if (!state) throw new ControllerError('NOT_FOUND', 'Draft not found.');
        if (state.status === 'COMPLETED' || state.status === 'CANCELLED') {
          return state;
        }
        const next = cancelDraft(state);
        await markDraftCancelled(draftId);
        await cancelAllStepTimeouts(draftId);
        const committed = await commitAndSchedule(next, state.version);
        await callbacks.onCancelled(committed);
        return committed;
      });
    },

    async applyPlayerAction({ draftId, actorSide, championId, expectedStep, expectedVersion }) {
      return withDraftLock(draftId, async () => {
        const state = await getOrHydrate(draftId);
        if (!state) throw new ControllerError('NOT_FOUND', 'Draft not found.');

        if (state.version !== expectedVersion || state.currentStep !== expectedStep) {
          throw new ControllerError(
            'STALE_VERSION',
            `Client out of sync (step=${state.currentStep}, v=${state.version}).`,
          );
        }

        const result = applyAction(state, { championId, actorSide, now: Date.now() });
        if (!result.ok) {
          if (result.reason === 'WRONG_SIDE') {
            throw new ControllerError('WRONG_SIDE', 'Not your turn.');
          }
          throw new ControllerError('CHAMPION_UNAVAILABLE', result.reason);
        }

        await persistLockedAction(
          draftId,
          result.locked,
          result.state.currentStep,
          result.state.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          state.startedAt ?? result.state.startedAt,
          result.state.completedAt,
        );

        await cancelStepTimeout(draftId, state.currentStep);
        const committed = await commitAndSchedule(result.state, state.version);
        await callbacks.onAction(committed, result.locked);
        if (committed.status === 'COMPLETED') {
          await callbacks.onCompleted(committed);
        }
        return { state: committed, action: result.locked };
      });
    },

    async handleTimeout({ draftId, step, expectedVersion }) {
      await withDraftLock(draftId, async () => {
        const state = await getOrHydrate(draftId);
        if (!state) return;
        if (state.status !== 'IN_PROGRESS') return;
        if (state.currentStep !== step) return;
        if (state.version !== expectedVersion) return;

        const candidatePool = await loadCandidatePool(draftId);
        const resolution = resolveAutoAction(state, candidatePool);
        const applied = applyAutoAction(state, resolution, Date.now());
        if (!applied) return;

        await persistLockedAction(
          draftId,
          applied.locked,
          applied.state.currentStep,
          applied.state.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          state.startedAt ?? applied.state.startedAt,
          applied.state.completedAt,
        );

        const committed = await commitAndSchedule(applied.state, state.version);
        await callbacks.onAction(committed, applied.locked);
        if (committed.status === 'COMPLETED') {
          await callbacks.onCompleted(committed);
        }

        logger.info({ draftId, step }, 'auto-resolved timeout');
      });
    },
  };
}

const CANDIDATE_CACHE_TTL = 5 * 60 * 1000;
let candidatePoolCache: { ids: string[]; loadedAt: number } | null = null;

async function loadCandidatePool(_draftId: string): Promise<string[]> {
  const now = Date.now();
  if (candidatePoolCache && now - candidatePoolCache.loadedAt < CANDIDATE_CACHE_TTL) {
    return candidatePoolCache.ids;
  }
  const champions = await prisma.champion.findMany({
    where: { enabled: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  candidatePoolCache = { ids: champions.map((c: { id: string }) => c.id), loadedAt: now };
  return candidatePoolCache.ids;
}

export const _CONSTANTS = { STEP_DURATION_MS, TOTAL_STEPS };
