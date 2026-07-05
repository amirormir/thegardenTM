import type { DraftSide } from './sequence';
import type { CoinflipDecision, DraftState, LockedAction } from './types';

/**
 * Socket.IO event contracts between web client and realtime server.
 * Versioned so we can rev the protocol later.
 */
export const SOCKET_PROTOCOL_VERSION = 1;

// ───── Client → Server ────────────────────────────────────────────────

export interface ClientJoinPayload {
  draftId: string;
  token: string;
}

export interface ClientReadyPayload {
  draftId: string;
}

export interface ClientActionPayload {
  draftId: string;
  championId: string;
  expectedStep: number;
  expectedVersion: number;
}

export interface ClientLeavePayload {
  draftId: string;
}

export interface ClientPingPayload {
  draftId: string;
  ts: number;
}

/** Captain broadcasts their hovering champion before confirmation. */
export interface ClientTentativePayload {
  draftId: string;
  championId: string | null;
}

/** Captain votes which side won the played game (cast after draft completes). */
export interface ClientVoteResultPayload {
  draftId: string;
  winnerSide: DraftSide;
}

/** Captain confirms they want to spawn the next game in the series. */
export interface ClientVoteNextGamePayload {
  draftId: string;
}

export interface ClientCoinflipChoicePayload {
  draftId: string;
  decision: CoinflipDecision;
}

export interface ClientToServerEvents {
  'draft:join': (payload: ClientJoinPayload, ack: (response: AckResponse) => void) => void;
  'draft:leave': (payload: ClientLeavePayload) => void;
  'draft:ready': (payload: ClientReadyPayload, ack: (response: AckResponse) => void) => void;
  'draft:action': (payload: ClientActionPayload, ack: (response: AckResponse) => void) => void;
  'draft:tentative': (payload: ClientTentativePayload) => void;
  'draft:vote_result': (
    payload: ClientVoteResultPayload,
    ack: (response: AckResponse) => void,
  ) => void;
  'draft:vote_next_game': (
    payload: ClientVoteNextGamePayload,
    ack: (response: AckResponse) => void,
  ) => void;
  'draft:coinflip_choice': (
    payload: ClientCoinflipChoicePayload,
    ack: (response: AckResponse) => void,
  ) => void;
  'draft:ping': (payload: ClientPingPayload) => void;
}

// ───── Server → Client ────────────────────────────────────────────────

export interface ServerStatePayload {
  state: DraftState;
}

/**
 * Aggregate usage of a champion within the current split (Season).
 * Sent alongside `draft:action_locked` for PICK events so the UI can show a
 * tournament-style "pick rate / presence" overlay on the splash reveal.
 */
export interface ChampionStats {
  championId: string;
  pickCount: number;
  banCount: number;
  totalDrafts: number;
  /** (pickCount + banCount) / totalDrafts. Null when no eligible drafts exist yet. */
  presenceRate: number | null;
  /** Count of picks of this champion on the winning side of a recorded draft. */
  winCount: number;
  /** Count of picks of this champion on the losing side of a recorded draft. */
  lossCount: number;
  /** winCount / (winCount + lossCount). Null until at least one recorded result. */
  winRate: number | null;
}

export interface ServerActionLockedPayload {
  draftId: string;
  action: LockedAction;
  state: DraftState;
  /** Present on PICK only — used to animate the splash + stats overlay. */
  championStats?: ChampionStats;
}

export interface ServerTimerUpdatePayload {
  draftId: string;
  step: number;
  deadline: number;
}

export interface ServerParticipantPayload {
  draftId: string;
  userId: string;
  role: 'BLUE_CAPTAIN' | 'RED_CAPTAIN' | 'SPECTATOR' | 'ADMIN' | 'DEV_DUAL_CAPTAIN';
  side: DraftSide | null;
  /** True when the captain has signalled ready in the lobby. */
  ready: boolean;
}

export interface ServerErrorPayload {
  draftId: string;
  code:
    | 'UNAUTHORIZED'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'CONFLICT'
    | 'INVALID_ACTION'
    | 'RATE_LIMITED';
  message: string;
}

export interface ServerCompletedPayload {
  draftId: string;
  state: DraftState;
}

/** Live preview of the active captain's current selection (before confirmation). */
export interface ServerTentativePayload {
  draftId: string;
  side: DraftSide;
  step: number;
  championId: string | null;
}

/** Current state of the post-draft result vote. Emitted on join and on every vote change. */
export interface ServerResultStatePayload {
  draftId: string;
  blueResultVote: DraftSide | null;
  redResultVote: DraftSide | null;
  /** Set once both captains agree on the same side. */
  winnerSide: DraftSide | null;
  winnerTeamId: string | null;
  /** Epoch ms when consensus was reached. */
  resultLockedAt: number | null;
}

/**
 * Current state of the next-game vote. Only meaningful once `winnerSide` is
 * locked and the series isn't decided yet. `nextGameDraftId` is populated once
 * both captains have voted and the server has created the next Draft row.
 */
export interface ServerNextGameStatePayload {
  draftId: string;
  blueNextGameVote: boolean;
  redNextGameVote: boolean;
  /** Epoch ms when both captains agreed. */
  nextGameLockedAt: number | null;
  /** Set once the next Draft has been created. Clients should navigate to it. */
  nextGameDraftId: string | null;
  /** Convenience flag for the UI: true iff a next game is possible (gameNumber < format max and series not decided). */
  canStartNextGame: boolean;
}

export interface ServerCoinflipResultPayload {
  draftId: string;
  winnerTeamId: string;
  blueTeamId: string;
  redTeamId: string;
}

export interface ServerCoinflipStatePayload {
  draftId: string;
  winnerTeamId: string | null;
  /** The coin-flip loser — holds the second (remaining) choice. */
  loserTeamId: string | null;
  blueTeamId: string;
  redTeamId: string;
  /** First choice, made by the coin-flip winner (side OR pick order). */
  decision: CoinflipDecision | null;
  /** Second choice, made by the loser from the remaining category. */
  loserDecision: CoinflipDecision | null;
  /** Which side picks first once both choices are locked. Null until resolved. */
  firstPickSide: DraftSide | null;
  /** Set only once BOTH choices are locked. */
  resolvedAt: number | null;
}

/** Server → client clock-sync reply. `serverTs` is the server's epoch ms. */
export interface ServerPongPayload {
  clientTs: number;
  serverTs: number;
}

export interface ServerToClientEvents {
  'draft:state': (payload: ServerStatePayload) => void;
  'draft:action_locked': (payload: ServerActionLockedPayload) => void;
  'draft:timer': (payload: ServerTimerUpdatePayload) => void;
  'draft:tentative': (payload: ServerTentativePayload) => void;
  'draft:coinflip_result': (payload: ServerCoinflipResultPayload) => void;
  'draft:coinflip_state': (payload: ServerCoinflipStatePayload) => void;
  'draft:result_state': (payload: ServerResultStatePayload) => void;
  'draft:next_game_state': (payload: ServerNextGameStatePayload) => void;
  'draft:participant': (payload: ServerParticipantPayload) => void;
  'draft:participant_left': (payload: { draftId: string; userId: string }) => void;
  'draft:completed': (payload: ServerCompletedPayload) => void;
  'draft:pong': (payload: ServerPongPayload) => void;
  'draft:cancelled': (payload: { draftId: string }) => void;
  'draft:paused': (payload: { draftId: string }) => void;
  'draft:resumed': (payload: ServerStatePayload) => void;
  'draft:error': (payload: ServerErrorPayload) => void;
}

export interface AckResponse {
  ok: boolean;
  error?: ServerErrorPayload;
}
