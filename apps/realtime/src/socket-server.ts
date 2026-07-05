import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import {
  beginCoinflip,
  getCurrentSide,
  type AckResponse,
  type ClientToServerEvents,
  type CoinflipDecision,
  type DraftSide,
  type ServerErrorPayload,
  type ServerParticipantPayload,
  type ServerToClientEvents,
} from '@nexus/draft-engine';
import { prisma } from '@nexus/db';
import { verifyDraftToken, type DraftTokenClaims } from './auth.js';
import { ControllerError, getState, type DraftController } from './draft-controller.js';
import { env } from './env.js';
import { logger } from './logger.js';
import {
  createNextGameDraft,
  markDraftCoinflipStarted,
  readNextGameState,
} from './persistence.js';
import { saveDraftState, withDraftLock } from './state.js';

interface SocketData {
  user?: DraftTokenClaims;
}

type DraftSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;
type DraftIO = IOServer<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

const CONTROL_ACTIONS = new Set(['start', 'pause', 'resume', 'cancel']);
const COINFLIP_DECISIONS = new Set<CoinflipDecision>([
  'SIDE_BLUE',
  'SIDE_RED',
  'FIRST_PICK',
  'SECOND_PICK',
]);
const lobbyPresence = new Map<string, Map<string, ServerParticipantPayload>>();

function room(draftId: string): string {
  return `draft:${draftId}`;
}

function sideFromRole(role: DraftTokenClaims['role']): DraftSide | null {
  if (role === 'BLUE_CAPTAIN') return 'BLUE';
  if (role === 'RED_CAPTAIN') return 'RED';
  return null;
}

function errAck(code: ServerErrorPayload['code'], message: string, draftId: string): AckResponse {
  return { ok: false, error: { draftId, code, message } };
}

function getPresenceMap(draftId: string): Map<string, ServerParticipantPayload> {
  let map = lobbyPresence.get(draftId);
  if (!map) {
    map = new Map<string, ServerParticipantPayload>();
    lobbyPresence.set(draftId, map);
  }
  return map;
}

function upsertPresence(entry: ServerParticipantPayload): ServerParticipantPayload {
  const map = getPresenceMap(entry.draftId);
  const current = map.get(entry.userId);
  const next = current ? { ...entry, ready: current.ready } : entry;
  map.set(entry.userId, next);
  return next;
}

function markPresenceReady(args: {
  draftId: string;
  userId: string;
  role: ServerParticipantPayload['role'];
  side: DraftSide | null;
  ready: boolean;
}): ServerParticipantPayload {
  const map = getPresenceMap(args.draftId);
  const current = map.get(args.userId);
  const next: ServerParticipantPayload = current
    ? { ...current, ready: args.ready }
    : {
        draftId: args.draftId,
        userId: args.userId,
        role: args.role,
        side: args.side,
        ready: args.ready,
      };
  map.set(args.userId, next);
  return next;
}

function removePresence(draftId: string, userId: string): boolean {
  const map = lobbyPresence.get(draftId);
  if (!map) return false;
  const removed = map.delete(userId);
  if (map.size === 0) {
    lobbyPresence.delete(draftId);
  }
  return removed;
}

function listPresence(draftId: string): ServerParticipantPayload[] {
  const map = lobbyPresence.get(draftId);
  return map ? Array.from(map.values()) : [];
}

function areCaptainsReady(draftId: string): boolean {
  const entries = listPresence(draftId);
  if (entries.some((entry) => entry.role === 'DEV_DUAL_CAPTAIN' && entry.ready)) {
    return true;
  }
  const blueReady = entries.some((entry) => entry.role === 'BLUE_CAPTAIN' && entry.ready);
  const redReady = entries.some((entry) => entry.role === 'RED_CAPTAIN' && entry.ready);
  return blueReady && redReady;
}

function resolveTeamSide(
  user: DraftTokenClaims,
  draft: { blueTeamId: string; redTeamId: string },
): DraftSide | null {
  if (user.teamId) {
    if (user.teamId === draft.blueTeamId) return 'BLUE';
    if (user.teamId === draft.redTeamId) return 'RED';
  }
  return sideFromRole(user.role);
}

function isCoinflipDecision(value: string): value is CoinflipDecision {
  return COINFLIP_DECISIONS.has(value as CoinflipDecision);
}

async function ensurePreviousDraftResolved(draftId: string): Promise<void> {
  const meta = await prisma.draft.findUnique({
    where: { id: draftId },
    select: { matchId: true, gameNumber: true },
  });
  if (!meta) {
    throw new ControllerError('NOT_FOUND', 'Draft not found.');
  }
  if (meta.gameNumber <= 1) return;

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

function isSideDecision(d: CoinflipDecision): boolean {
  return d === 'SIDE_BLUE' || d === 'SIDE_RED';
}
function isOrderDecision(d: CoinflipDecision): boolean {
  return d === 'FIRST_PICK' || d === 'SECOND_PICK';
}

/**
 * Resolve independent side + pick-order from the two coin-flip choices.
 * `winnerDecision` is made by the winner, `loserDecision` by the loser; one is
 * a SIDE_* value and the other a FIRST/SECOND_PICK value (enforced by caller).
 * Side (blue/red) and first pick are decoupled: the first-pick team may be red.
 */
function resolveCoinflipSides(
  winnerId: string,
  loserId: string,
  winnerDecision: CoinflipDecision,
  loserDecision: CoinflipDecision,
): { blueTeamId: string; redTeamId: string; firstPickSide: DraftSide } {
  const otherOf = (id: string) => (id === winnerId ? loserId : winnerId);

  const sideDecision = isSideDecision(winnerDecision) ? winnerDecision : loserDecision;
  const sideChooser = isSideDecision(winnerDecision) ? winnerId : loserId;
  const orderDecision = isOrderDecision(winnerDecision) ? winnerDecision : loserDecision;
  const orderChooser = isOrderDecision(winnerDecision) ? winnerId : loserId;

  const blueTeamId = sideDecision === 'SIDE_BLUE' ? sideChooser : otherOf(sideChooser);
  const redTeamId = otherOf(blueTeamId);

  const firstPickTeam = orderDecision === 'FIRST_PICK' ? orderChooser : otherOf(orderChooser);
  const firstPickSide: DraftSide = firstPickTeam === blueTeamId ? 'BLUE' : 'RED';

  return { blueTeamId, redTeamId, firstPickSide };
}

interface CoinflipRow {
  blueTeamId: string;
  redTeamId: string;
  coinflipWinnerTeamId: string | null;
  coinflipDecision: CoinflipDecision | null;
  coinflipLoserDecision: CoinflipDecision | null;
  coinflipResolvedAt: Date | null;
  firstPickSide: DraftSide | null;
}

function coinflipPayload(draftId: string, row: CoinflipRow) {
  const loserTeamId = row.coinflipWinnerTeamId
    ? row.coinflipWinnerTeamId === row.blueTeamId
      ? row.redTeamId
      : row.blueTeamId
    : null;
  return {
    draftId,
    winnerTeamId: row.coinflipWinnerTeamId,
    loserTeamId,
    blueTeamId: row.blueTeamId,
    redTeamId: row.redTeamId,
    decision: row.coinflipDecision,
    loserDecision: row.coinflipLoserDecision,
    firstPickSide: row.firstPickSide,
    resolvedAt: row.coinflipResolvedAt ? row.coinflipResolvedAt.getTime() : null,
  };
}

async function readCoinflipState(draftId: string) {
  const row = await prisma.draft.findUnique({
    where: { id: draftId },
    select: {
      status: true,
      blueTeamId: true,
      redTeamId: true,
      coinflipWinnerTeamId: true,
      coinflipDecision: true,
      coinflipLoserDecision: true,
      coinflipResolvedAt: true,
      firstPickSide: true,
    },
  });
  if (!row) return null;
  if (
    row.status === 'LOBBY' &&
    row.coinflipWinnerTeamId === null &&
    row.coinflipDecision === null &&
    row.coinflipResolvedAt === null
  ) {
    return null;
  }
  return coinflipPayload(draftId, row);
}

async function readNextGamePayload(draftId: string) {
  const row = await readNextGameState(draftId);
  if (!row) return null;
  return {
    draftId,
    blueNextGameVote: row.blueNextGameVote,
    redNextGameVote: row.redNextGameVote,
    nextGameLockedAt: row.nextGameLockedAt,
    nextGameDraftId: row.nextGameDraftId,
    canStartNextGame: row.canStartNextGame,
  };
}

async function readResultState(draftId: string) {
  const row = await prisma.draft.findUnique({
    where: { id: draftId },
    select: {
      blueResultVote: true,
      redResultVote: true,
      winnerSide: true,
      winnerTeamId: true,
      resultLockedAt: true,
    },
  });
  if (!row) return null;
  return {
    draftId,
    blueResultVote: row.blueResultVote,
    redResultVote: row.redResultVote,
    winnerSide: row.winnerSide,
    winnerTeamId: row.winnerTeamId,
    resultLockedAt: row.resultLockedAt ? row.resultLockedAt.getTime() : null,
  };
}

async function maybeTriggerCoinflip(draftId: string, io: DraftIO): Promise<void> {
  if (!areCaptainsReady(draftId)) return;

  try {
    await withDraftLock(draftId, async () => {
      if (!areCaptainsReady(draftId)) return;

      const state = await getState(draftId);
      if (!state) throw new ControllerError('NOT_FOUND', 'Draft not found.');
      if (state.status !== 'LOBBY') return;

      await ensurePreviousDraftResolved(draftId);

      const draft = await prisma.draft.findUnique({
        where: { id: draftId },
        select: {
          blueTeamId: true,
          redTeamId: true,
          coinflipWinnerTeamId: true,
          coinflipDecision: true,
        },
      });
      if (!draft) throw new ControllerError('NOT_FOUND', 'Draft not found.');
      if (draft.coinflipWinnerTeamId || draft.coinflipDecision) return;

      const winnerTeamId = Math.random() < 0.5 ? draft.blueTeamId : draft.redTeamId;
      const nextState = beginCoinflip(state);

      await markDraftCoinflipStarted(draftId, winnerTeamId);
      await saveDraftState(nextState);

      io.to(room(draftId)).emit('draft:state', { state: nextState });
      io.to(room(draftId)).emit('draft:coinflip_result', {
        draftId,
        winnerTeamId,
        blueTeamId: draft.blueTeamId,
        redTeamId: draft.redTeamId,
      });
      io.to(room(draftId)).emit(
        'draft:coinflip_state',
        coinflipPayload(draftId, {
          blueTeamId: draft.blueTeamId,
          redTeamId: draft.redTeamId,
          coinflipWinnerTeamId: winnerTeamId,
          coinflipDecision: null,
          coinflipLoserDecision: null,
          coinflipResolvedAt: null,
          firstPickSide: null,
        }),
      );
    });
  } catch (error) {
    if (error instanceof ControllerError) {
      io.to(room(draftId)).emit('draft:error', {
        draftId,
        code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
        message: error.message,
      });
      return;
    }
    logger.warn({ err: error, draftId }, 'coinflip trigger failed');
    io.to(room(draftId)).emit('draft:error', {
      draftId,
      code: 'CONFLICT',
      message: (error as Error).message,
    });
  }
}

async function resolveCoinflipChoice(args: {
  draftId: string;
  role: DraftTokenClaims['role'];
  teamId: string | null;
  decision: CoinflipDecision;
}) {
  const { draftId, role, teamId, decision } = args;

  const SELECT = {
    blueTeamId: true,
    redTeamId: true,
    coinflipWinnerTeamId: true,
    coinflipDecision: true,
    coinflipLoserDecision: true,
    coinflipResolvedAt: true,
    firstPickSide: true,
  } as const;

  return withDraftLock(draftId, async () => {
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      select: { status: true, ...SELECT },
    });
    if (!draft) throw new ControllerError('NOT_FOUND', 'Draft not found.');
    if (draft.status !== 'COINFLIP') {
      throw new ControllerError('CONFLICT', 'Coin flip is not active.');
    }
    if (!draft.coinflipWinnerTeamId) {
      throw new ControllerError('CONFLICT', 'Coin flip has not been rolled yet.');
    }

    // Fully resolved already — idempotent no-op, return current state.
    if (draft.coinflipResolvedAt !== null) {
      return coinflipPayload(draftId, draft);
    }

    const winnerId = draft.coinflipWinnerTeamId;
    const loserId = winnerId === draft.blueTeamId ? draft.redTeamId : draft.blueTeamId;
    const isDev = role === 'DEV_DUAL_CAPTAIN';
    const isWinnerActor = isDev || (teamId !== null && teamId === winnerId);
    const isLoserActor = isDev || (teamId !== null && teamId === loserId);

    // ── Step 1: the coin-flip winner makes the first choice (side OR order) ──
    if (draft.coinflipDecision === null) {
      if (!isWinnerActor) {
        throw new ControllerError('WRONG_SIDE', 'Only the coin flip winner makes the first choice.');
      }
      const updated = await prisma.draft.update({
        where: { id: draftId },
        data: { coinflipDecision: decision },
        select: SELECT,
      });
      return coinflipPayload(draftId, updated);
    }

    // ── Step 2: the loser picks the remaining category ──
    // Winner re-submitting their own (unchanged) first choice: idempotent.
    if (decision === draft.coinflipDecision && isWinnerActor && !isLoserActor) {
      return coinflipPayload(draftId, draft);
    }
    if (!isLoserActor) {
      throw new ControllerError('WRONG_SIDE', 'Only the coin flip loser makes the second choice.');
    }

    const winnerChoseSide = isSideDecision(draft.coinflipDecision);
    if (winnerChoseSide && !isOrderDecision(decision)) {
      throw new ControllerError('CONFLICT', 'Expected a pick-order choice (first/second pick).');
    }
    if (!winnerChoseSide && !isSideDecision(decision)) {
      throw new ControllerError('CONFLICT', 'Expected a side choice (blue/red).');
    }

    const sides = resolveCoinflipSides(winnerId, loserId, draft.coinflipDecision, decision);
    const updated = await prisma.draft.update({
      where: { id: draftId },
      data: {
        coinflipLoserDecision: decision,
        blueTeamId: sides.blueTeamId,
        redTeamId: sides.redTeamId,
        firstPickSide: sides.firstPickSide,
        coinflipResolvedAt: new Date(),
      },
      select: SELECT,
    });
    return coinflipPayload(draftId, updated);
  });
}

async function castResultVote(args: {
  draftId: string;
  role: DraftTokenClaims['role'];
  teamId: string | null;
  winnerSide: DraftSide;
}) {
  const { draftId, role, teamId, winnerSide } = args;

  const draft = await prisma.draft.findUnique({
    where: { id: draftId },
    select: {
      status: true,
      blueTeamId: true,
      redTeamId: true,
      blueResultVote: true,
      redResultVote: true,
      winnerSide: true,
    },
  });
  if (!draft) throw new ControllerError('NOT_FOUND', 'Draft not found.');
  if (draft.status !== 'COMPLETED') {
    throw new ControllerError('CONFLICT', 'Draft is not completed yet.');
  }
  if (draft.winnerSide !== null) {
    throw new ControllerError('CONFLICT', 'Result already locked.');
  }

  let blueVote = draft.blueResultVote;
  let redVote = draft.redResultVote;
  if (role === 'DEV_DUAL_CAPTAIN') {
    blueVote = winnerSide;
    redVote = winnerSide;
  } else if (teamId && teamId === draft.blueTeamId) {
    blueVote = winnerSide;
  } else if (teamId && teamId === draft.redTeamId) {
    redVote = winnerSide;
  } else if (role === 'BLUE_CAPTAIN') {
    blueVote = winnerSide;
  } else if (role === 'RED_CAPTAIN') {
    redVote = winnerSide;
  } else {
    throw new ControllerError('WRONG_SIDE', 'Only captains can vote.');
  }

  const agree = blueVote !== null && redVote !== null && blueVote === redVote;
  const lockedWinner: DraftSide | null = agree ? blueVote : null;
  const winnerTeamId = lockedWinner
    ? lockedWinner === 'BLUE'
      ? draft.blueTeamId
      : draft.redTeamId
    : null;
  const resultLockedAt = lockedWinner ? new Date() : null;

  const updated = await prisma.draft.update({
    where: { id: draftId },
    data: {
      blueResultVote: blueVote,
      redResultVote: redVote,
      winnerSide: lockedWinner,
      winnerTeamId,
      resultLockedAt,
    },
    select: {
      blueResultVote: true,
      redResultVote: true,
      winnerSide: true,
      winnerTeamId: true,
      resultLockedAt: true,
    },
  });

  return {
    draftId,
    blueResultVote: updated.blueResultVote,
    redResultVote: updated.redResultVote,
    winnerSide: updated.winnerSide,
    winnerTeamId: updated.winnerTeamId,
    resultLockedAt: updated.resultLockedAt ? updated.resultLockedAt.getTime() : null,
  };
}

async function castNextGameVote(args: {
  draftId: string;
  role: DraftTokenClaims['role'];
  teamId: string | null;
}) {
  const { draftId, role, teamId } = args;

  return withDraftLock(draftId, async () => {
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      select: {
        blueTeamId: true,
        redTeamId: true,
        winnerSide: true,
        blueNextGameVote: true,
        redNextGameVote: true,
        nextGameLockedAt: true,
      },
    });
    if (!draft) throw new ControllerError('NOT_FOUND', 'Draft not found.');
    if (draft.winnerSide === null) {
      throw new ControllerError('CONFLICT', 'Result must be locked before voting next game.');
    }

    const pre = await readNextGameState(draftId);
    if (!pre) throw new ControllerError('NOT_FOUND', 'Draft not found.');
    if (!pre.canStartNextGame) {
      throw new ControllerError('CONFLICT', 'No more games can be started in this series.');
    }

    let blueVote = draft.blueNextGameVote;
    let redVote = draft.redNextGameVote;
    if (role === 'DEV_DUAL_CAPTAIN') {
      blueVote = true;
      redVote = true;
    } else if (teamId && teamId === draft.blueTeamId) {
      blueVote = true;
    } else if (teamId && teamId === draft.redTeamId) {
      redVote = true;
    } else if (role === 'BLUE_CAPTAIN') {
      blueVote = true;
    } else if (role === 'RED_CAPTAIN') {
      redVote = true;
    } else {
      throw new ControllerError('WRONG_SIDE', 'Only captains can vote.');
    }

    const bothAgreed = blueVote && redVote;
    const lockedAt = bothAgreed && !draft.nextGameLockedAt ? new Date() : draft.nextGameLockedAt;

    await prisma.draft.update({
      where: { id: draftId },
      data: {
        blueNextGameVote: blueVote,
        redNextGameVote: redVote,
        nextGameLockedAt: lockedAt,
      },
    });

    let nextGameDraftId = pre.nextGameDraftId;
    if (bothAgreed && !nextGameDraftId) {
      try {
        nextGameDraftId = await createNextGameDraft(draftId);
      } catch (error) {
        logger.error({ err: error, draftId }, 'failed to create next game draft');
        throw new ControllerError('CONFLICT', 'Failed to create next game.');
      }
    }

    return {
      draftId,
      blueNextGameVote: blueVote,
      redNextGameVote: redVote,
      nextGameLockedAt: lockedAt ? lockedAt.getTime() : null,
      nextGameDraftId,
      canStartNextGame: pre.canStartNextGame,
    };
  });
}

export interface CreateSocketServerOptions {
  controller: DraftController;
}

export function createSocketServer(options: CreateSocketServerOptions): {
  http: HttpServer;
  io: DraftIO;
} {
  const http = createServer((req, res) => {
    void handleHttp(req, res, options.controller);
  });

  const io: DraftIO = new IOServer(http, {
    cors: { origin: env.webOrigin, methods: ['GET', 'POST'], credentials: true },
    serveClient: false,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) return next(new Error('UNAUTHORIZED'));
    try {
      const claims = await verifyDraftToken(token);
      socket.data.user = claims;
      next();
    } catch (error) {
      logger.warn({ err: error }, 'socket auth rejected');
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: DraftSocket) => bindHandlers(socket, options.controller, io));

  return { http, io };
}

function bindHandlers(socket: DraftSocket, controller: DraftController, io: DraftIO) {
  const user = socket.data.user;
  if (!user) {
    socket.disconnect();
    return;
  }

  socket.on('draft:join', async ({ draftId }, ack) => {
    if (draftId !== user.draftId) {
      ack(errAck('FORBIDDEN', 'Token does not grant access to this draft.', draftId));
      return;
    }
    try {
      socket.join(room(draftId));
      const current = await getState(draftId);
      if (!current) {
        ack(errAck('NOT_FOUND', 'Draft not found.', draftId));
        return;
      }
      socket.emit('draft:state', { state: current });

      const coinflip = await readCoinflipState(draftId);
      if (coinflip) socket.emit('draft:coinflip_state', coinflip);

      const result = await readResultState(draftId);
      if (result) socket.emit('draft:result_state', result);

      const nextGame = await readNextGamePayload(draftId);
      if (nextGame) socket.emit('draft:next_game_state', nextGame);

      const presence = upsertPresence({
        draftId,
        userId: user.sub,
        role: user.role,
        side: sideFromRole(user.role),
        ready: false,
      });
      for (const entry of listPresence(draftId)) {
        if (entry.userId !== user.sub) {
          socket.emit('draft:participant', entry);
        }
      }
      io.to(room(draftId)).emit('draft:participant', presence);
      ack({ ok: true });
    } catch (error) {
      logger.warn({ err: error, draftId }, 'join failed');
      ack(errAck('CONFLICT', (error as Error).message, draftId));
    }
  });

  socket.on('draft:leave', ({ draftId }) => {
    socket.leave(room(draftId));
    if (removePresence(draftId, user.sub)) {
      io.to(room(draftId)).emit('draft:participant_left', { draftId, userId: user.sub });
    }
  });

  socket.on('draft:ready', async ({ draftId }, ack) => {
    if (draftId !== user.draftId) {
      ack(errAck('FORBIDDEN', 'Wrong draft.', draftId));
      return;
    }
    const current = await getState(draftId);
    if (!current) {
      ack(errAck('NOT_FOUND', 'Draft not found.', draftId));
      return;
    }
    if (current.status !== 'LOBBY') {
      ack(errAck('CONFLICT', 'Lobby is already closed.', draftId));
      return;
    }

    const presence = markPresenceReady({
      draftId,
      userId: user.sub,
      role: user.role,
      side: sideFromRole(user.role),
      ready: true,
    });
    io.to(room(draftId)).emit('draft:participant', presence);
    ack({ ok: true });

    void maybeTriggerCoinflip(draftId, io);
  });

  socket.on('draft:action', async ({ draftId, championId, expectedStep, expectedVersion }, ack) => {
    if (draftId !== user.draftId) {
      ack(errAck('FORBIDDEN', 'Wrong draft.', draftId));
      return;
    }

    let side: DraftSide | null;
    if (user.role === 'DEV_DUAL_CAPTAIN') {
      const snapshot = await getState(draftId);
      side = snapshot ? getCurrentSide(snapshot) : null;
    } else {
      const draft = await prisma.draft.findUnique({
        where: { id: draftId },
        select: { blueTeamId: true, redTeamId: true },
      });
      side = draft ? resolveTeamSide(user, draft) : null;
    }
    if (!side) {
      ack(errAck('FORBIDDEN', 'Spectators cannot lock actions.', draftId));
      return;
    }

    try {
      await controller.applyPlayerAction({
        draftId,
        actorSide: side,
        championId,
        expectedStep,
        expectedVersion,
      });
      ack({ ok: true });
    } catch (error) {
      if (error instanceof ControllerError) {
        const map: Record<string, AckResponse['error']> = {
          NOT_FOUND: { draftId, code: 'NOT_FOUND', message: error.message },
          CONFLICT: { draftId, code: 'CONFLICT', message: error.message },
          STALE_VERSION: { draftId, code: 'CONFLICT', message: error.message },
          WRONG_SIDE: { draftId, code: 'FORBIDDEN', message: error.message },
          CHAMPION_UNAVAILABLE: { draftId, code: 'INVALID_ACTION', message: error.message },
          INVALID_ACTION: { draftId, code: 'INVALID_ACTION', message: error.message },
        };
        const err = map[error.code];
        ack({ ok: false, ...(err ? { error: err } : {}) });
        return;
      }
      logger.error({ err: error, draftId }, 'action handler failed');
      ack(errAck('CONFLICT', 'Internal error.', draftId));
    }
  });

  socket.on('draft:tentative', async ({ draftId, championId }) => {
    if (draftId !== user.draftId) return;
    const snapshot = await getState(draftId);
    if (!snapshot || snapshot.status !== 'IN_PROGRESS') return;

    let side: DraftSide | null;
    if (user.role === 'DEV_DUAL_CAPTAIN') {
      side = getCurrentSide(snapshot);
    } else {
      const draft = await prisma.draft.findUnique({
        where: { id: draftId },
        select: { blueTeamId: true, redTeamId: true },
      });
      side = draft ? resolveTeamSide(user, draft) : null;
    }
    if (!side || side !== getCurrentSide(snapshot)) return;

    socket.to(room(draftId)).emit('draft:tentative', {
      draftId,
      side,
      step: snapshot.currentStep,
      championId,
    });
  });

  socket.on('draft:vote_result', async ({ draftId, winnerSide }, ack) => {
    if (draftId !== user.draftId) {
      ack(errAck('FORBIDDEN', 'Wrong draft.', draftId));
      return;
    }
    if (winnerSide !== 'BLUE' && winnerSide !== 'RED') {
      ack(errAck('INVALID_ACTION', 'winnerSide must be BLUE or RED.', draftId));
      return;
    }
    try {
      const updated = await castResultVote({
        draftId,
        role: user.role,
        teamId: user.teamId,
        winnerSide,
      });
      io.to(room(draftId)).emit('draft:result_state', updated);
      ack({ ok: true });
    } catch (error) {
      if (error instanceof ControllerError) {
        const code =
          error.code === 'NOT_FOUND'
            ? 'NOT_FOUND'
            : error.code === 'WRONG_SIDE'
              ? 'FORBIDDEN'
              : 'CONFLICT';
        ack(errAck(code, error.message, draftId));
        return;
      }
      logger.warn({ err: error, draftId }, 'vote_result failed');
      ack(errAck('CONFLICT', (error as Error).message, draftId));
    }
  });

  socket.on('draft:vote_next_game', async ({ draftId }, ack) => {
    if (draftId !== user.draftId) {
      ack(errAck('FORBIDDEN', 'Wrong draft.', draftId));
      return;
    }
    try {
      const updated = await castNextGameVote({
        draftId,
        role: user.role,
        teamId: user.teamId,
      });
      io.to(room(draftId)).emit('draft:next_game_state', updated);
      ack({ ok: true });
    } catch (error) {
      if (error instanceof ControllerError) {
        const code =
          error.code === 'NOT_FOUND'
            ? 'NOT_FOUND'
            : error.code === 'WRONG_SIDE'
              ? 'FORBIDDEN'
              : 'CONFLICT';
        ack(errAck(code, error.message, draftId));
        return;
      }
      logger.warn({ err: error, draftId }, 'vote_next_game failed');
      ack(errAck('CONFLICT', (error as Error).message, draftId));
    }
  });

  socket.on('draft:coinflip_choice', async ({ draftId, decision }, ack) => {
    if (draftId !== user.draftId) {
      ack(errAck('FORBIDDEN', 'Wrong draft.', draftId));
      return;
    }
    if (!isCoinflipDecision(decision)) {
      ack(errAck('INVALID_ACTION', 'Invalid coin flip decision.', draftId));
      return;
    }
    try {
      const updated = await resolveCoinflipChoice({
        draftId,
        role: user.role,
        teamId: user.teamId,
        decision,
      });
      io.to(room(draftId)).emit('draft:coinflip_state', updated);
      await controller.start(draftId);
      ack({ ok: true });
    } catch (error) {
      if (error instanceof ControllerError) {
        const code =
          error.code === 'NOT_FOUND'
            ? 'NOT_FOUND'
            : error.code === 'WRONG_SIDE'
              ? 'FORBIDDEN'
              : 'CONFLICT';
        ack(errAck(code, error.message, draftId));
        return;
      }
      logger.warn({ err: error, draftId }, 'coinflip_choice failed');
      ack(errAck('CONFLICT', (error as Error).message, draftId));
    }
  });

  // Clock sync: reply with the server's current time so the client can compute
  // its offset and render the countdown against server time (fixes skewed
  // client clocks showing wrong values, e.g. 100s for a 30s step).
  socket.on('draft:ping', ({ ts }) => {
    socket.emit('draft:pong', { clientTs: ts, serverTs: Date.now() });
  });

  socket.on('disconnect', () => {
    if (removePresence(user.draftId, user.sub)) {
      io.to(room(user.draftId)).emit('draft:participant_left', {
        draftId: user.draftId,
        userId: user.sub,
      });
    }
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((n, c) => n + c.length, 0) > 16_384) {
      throw new Error('Body too large');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: DraftController,
): Promise<void> {
  const url = req.url ?? '';

  if (url === '/healthz') {
    res.statusCode = 200;
    res.end('ok');
    return;
  }

  const controlMatch = /^\/control\/([^/]+)\/(start|pause|resume|cancel)$/.exec(url);
  if (controlMatch && req.method === 'POST') {
    const secret = req.headers['x-internal-secret'];
    if (secret !== env.internalSecret) {
      sendJson(res, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    const draftId = controlMatch[1]!;
    const action = controlMatch[2]!;
    if (!CONTROL_ACTIONS.has(action)) {
      sendJson(res, 400, { error: 'INVALID_ACTION' });
      return;
    }

    try {
      await readJsonBody(req);
      const state =
        action === 'start'
          ? await controller.start(draftId)
          : action === 'pause'
            ? await controller.pause(draftId)
            : action === 'resume'
              ? await controller.resume(draftId)
              : await controller.cancel(draftId);
      sendJson(res, 200, { ok: true, state });
    } catch (error) {
      if (error instanceof ControllerError) {
        const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400;
        sendJson(res, status, { ok: false, code: error.code, message: error.message });
        return;
      }
      logger.error({ err: error, draftId, action }, 'control endpoint failed');
      sendJson(res, 500, { ok: false, code: 'INTERNAL_ERROR' });
    }
    return;
  }

  res.statusCode = 404;
  res.end('not found');
}
