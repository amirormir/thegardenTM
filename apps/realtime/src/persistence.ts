import { prisma } from '@nexus/db';
import {
  createInitialState,
  type DraftState,
  type LockedAction,
} from '@nexus/draft-engine';
import { logger } from './logger.js';

/**
 * Compute fearless-locked champion ids for a given draft: every PICK locked in
 * previous non-cancelled drafts of the same match (game numbers < current).
 */
export async function fetchFearlessLocks(draftId: string): Promise<string[]> {
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    select: { matchId: true, gameNumber: true, fearless: true },
  });

  if (!draft || !draft.fearless) return [];

  const previous = await prisma.draft.findMany({
    where: {
      matchId: draft.matchId,
      gameNumber: { lt: draft.gameNumber },
      status: { in: ['COMPLETED', 'IN_PROGRESS', 'PAUSED'] },
    },
    select: {
      actions: {
        where: { type: 'PICK', NOT: { championId: null } },
        select: { championId: true },
      },
    },
  });

  const set = new Set<string>();
  for (const d of previous) {
    for (const a of d.actions) {
      if (a.championId) set.add(a.championId);
    }
  }
  return Array.from(set);
}

/**
 * Build an in-memory engine state from the DB. Used on first hydration.
 */
export async function hydrateStateFromDatabase(draftId: string): Promise<DraftState | null> {
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    select: {
      id: true,
      status: true,
      currentStep: true,
      startedAt: true,
      completedAt: true,
      firstPickSide: true,
      actions: {
        orderBy: { step: 'asc' },
        select: {
          step: true,
          type: true,
          side: true,
          championId: true,
          wasAutoPicked: true,
          lockedAt: true,
        },
      },
    },
  });

  if (!draft) return null;

  const fearless = await fetchFearlessLocks(draftId);
  const base = createInitialState({
    draftId: draft.id,
    fearlessLockedChampionIds: fearless,
    firstPickSide: draft.firstPickSide ?? 'BLUE',
  });

  const actions: LockedAction[] = draft.actions.map((a: {
    step: number;
    type: LockedAction['type'];
    side: LockedAction['side'];
    championId: string | null;
    wasAutoPicked: boolean;
    lockedAt: Date;
  }) => ({
    step: a.step,
    type: a.type,
    side: a.side,
    championId: a.championId,
    wasAutoPicked: a.wasAutoPicked,
    lockedAt: a.lockedAt.getTime(),
  }));

  return {
    ...base,
    status: draft.status,
    currentStep: draft.currentStep,
    actions,
    startedAt: draft.startedAt?.getTime() ?? null,
    completedAt: draft.completedAt?.getTime() ?? null,
    timerDeadline: null,
    version: actions.length,
  };
}

/**
 * Persist a single locked action to Postgres. Idempotent via the unique [draftId, step] constraint.
 */
export async function persistLockedAction(
  draftId: string,
  action: LockedAction,
  nextStep: number,
  status: 'IN_PROGRESS' | 'COMPLETED',
  startedAt: number | null,
  completedAt: number | null,
): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.draftAction.create({
        data: {
          draftId,
          step: action.step,
          type: action.type,
          side: action.side,
          championId: action.championId,
          wasAutoPicked: action.wasAutoPicked,
          lockedAt: new Date(action.lockedAt),
          ...(action.championId
            ? {
                championName: action.championId, // resolved later if needed
              }
            : {}),
        },
      }),
      prisma.draft.update({
        where: { id: draftId },
        data: {
          currentStep: nextStep,
          status,
          ...(startedAt ? { startedAt: new Date(startedAt) } : {}),
          ...(completedAt ? { completedAt: new Date(completedAt) } : {}),
        },
      }),
    ]);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'P2002') {
      // already persisted — race with another worker. Safe to swallow.
      logger.warn({ draftId, step: action.step }, 'duplicate draft action ignored');
      return;
    }
    throw error;
  }
}

export async function markDraftStarted(draftId: string, startedAt: number): Promise<void> {
  await prisma.draft.update({
    where: { id: draftId },
    data: { status: 'IN_PROGRESS', startedAt: new Date(startedAt), currentStep: 1 },
  });
}

export async function markDraftCoinflipStarted(
  draftId: string,
  winnerTeamId: string,
): Promise<void> {
  await prisma.draft.update({
    where: { id: draftId },
    data: {
      status: 'COINFLIP',
      coinflipWinnerTeamId: winnerTeamId,
      coinflipDecision: null,
      coinflipLoserDecision: null,
      coinflipResolvedAt: null,
      firstPickSide: null,
    },
  });
}

export async function markDraftCancelled(draftId: string): Promise<void> {
  await prisma.draft.update({
    where: { id: draftId },
    data: { status: 'CANCELLED' },
  });
}

export async function markDraftPaused(draftId: string): Promise<void> {
  await prisma.draft.update({
    where: { id: draftId },
    data: { status: 'PAUSED' },
  });
}

export async function markDraftResumed(draftId: string): Promise<void> {
  await prisma.draft.update({
    where: { id: draftId },
    data: { status: 'IN_PROGRESS' },
  });
}

export interface NextGameStateRow {
  blueNextGameVote: boolean;
  redNextGameVote: boolean;
  nextGameLockedAt: number | null;
  nextGameDraftId: string | null;
  canStartNextGame: boolean;
}

function maxGamesForFormat(format: 'BO1' | 'BO3' | 'BO5'): number {
  return format === 'BO5' ? 5 : format === 'BO3' ? 3 : 1;
}

function winsToClinch(format: 'BO1' | 'BO3' | 'BO5'): number {
  return format === 'BO5' ? 3 : format === 'BO3' ? 2 : 1;
}

/**
 * Compute the next-game state for a draft. Returns null if the draft itself is
 * missing. `canStartNextGame` is true iff the parent has a winner, the series
 * is not decided, and the format allows another game.
 */
export async function readNextGameState(draftId: string): Promise<NextGameStateRow | null> {
  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    select: {
      matchId: true,
      gameNumber: true,
      format: true,
      winnerSide: true,
      winnerTeamId: true,
      blueTeamId: true,
      redTeamId: true,
      blueNextGameVote: true,
      redNextGameVote: true,
      nextGameLockedAt: true,
    },
  });
  if (!draft) return null;

  const sibling = await prisma.draft.findFirst({
    where: {
      matchId: draft.matchId,
      gameNumber: draft.gameNumber + 1,
      status: { not: 'CANCELLED' },
    },
    select: { id: true },
  });

  let canStartNextGame = false;
  if (draft.winnerSide && draft.gameNumber < maxGamesForFormat(draft.format)) {
    const siblings = await prisma.draft.findMany({
      where: {
        matchId: draft.matchId,
        status: { not: 'CANCELLED' },
        winnerTeamId: { not: null },
      },
      select: { winnerTeamId: true },
    });
    const wins = new Map<string, number>();
    for (const s of siblings) {
      if (!s.winnerTeamId) continue;
      wins.set(s.winnerTeamId, (wins.get(s.winnerTeamId) ?? 0) + 1);
    }
    const clinch = winsToClinch(draft.format);
    const seriesDecided = Array.from(wins.values()).some((n) => n >= clinch);
    canStartNextGame = !seriesDecided;
  }

  return {
    blueNextGameVote: draft.blueNextGameVote,
    redNextGameVote: draft.redNextGameVote,
    nextGameLockedAt: draft.nextGameLockedAt ? draft.nextGameLockedAt.getTime() : null,
    nextGameDraftId: sibling?.id ?? null,
    canStartNextGame,
  };
}

/**
 * Spawn the next Draft row for a BO3/BO5 series. Idempotent: if a non-cancelled
 * draft already exists for `gameNumber + 1`, returns its id. The losing team
 * is set as `coinflipWinnerTeamId` so they pick side first on the new draft.
 */
export async function createNextGameDraft(parentDraftId: string): Promise<string> {
  const parent = await prisma.draft.findUnique({
    where: { id: parentDraftId },
    select: {
      matchId: true,
      seasonId: true,
      format: true,
      fearless: true,
      gameNumber: true,
      patchVersion: true,
      blueTeamId: true,
      redTeamId: true,
      winnerTeamId: true,
      winnerSide: true,
      createdById: true,
    },
  });
  if (!parent) throw new Error('Parent draft not found.');
  if (!parent.winnerTeamId || !parent.winnerSide) {
    throw new Error('Parent draft has no locked winner.');
  }
  if (parent.gameNumber >= maxGamesForFormat(parent.format)) {
    throw new Error('Series already at max games.');
  }

  const existing = await prisma.draft.findFirst({
    where: {
      matchId: parent.matchId,
      gameNumber: parent.gameNumber + 1,
      status: { not: 'CANCELLED' },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const losingTeamId =
    parent.winnerTeamId === parent.blueTeamId ? parent.redTeamId : parent.blueTeamId;

  // Sides default to the parent layout; if the losing team picks the opposite
  // side during coinflip, the existing coinflip resolver swaps blue/red atomically.
  const next = await prisma.draft.create({
    data: {
      matchId: parent.matchId,
      seasonId: parent.seasonId,
      format: parent.format,
      fearless: parent.fearless,
      gameNumber: parent.gameNumber + 1,
      patchVersion: parent.patchVersion,
      blueTeamId: parent.blueTeamId,
      redTeamId: parent.redTeamId,
      status: 'COINFLIP',
      coinflipWinnerTeamId: losingTeamId,
      createdById: parent.createdById,
    },
    select: { id: true },
  });

  logger.info(
    { parentDraftId, nextDraftId: next.id, gameNumber: parent.gameNumber + 1 },
    'next game draft spawned',
  );
  return next.id;
}
