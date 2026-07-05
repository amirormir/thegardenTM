import type { DraftActionType, DraftSide } from './sequence';

export type { DraftActionType, DraftSide } from './sequence';

export type DraftStatus =
  | 'LOBBY'
  | 'COINFLIP'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type CoinflipDecision = 'SIDE_BLUE' | 'SIDE_RED' | 'FIRST_PICK' | 'SECOND_PICK';

export interface LockedAction {
  step: number;
  type: DraftActionType;
  side: DraftSide;
  championId: string | null;
  wasAutoPicked: boolean;
  lockedAt: number;
}

export interface DraftState {
  draftId: string;
  status: DraftStatus;
  currentStep: number;
  actions: LockedAction[];
  /** Champions that cannot be picked in this draft due to fearless lock across BO games. */
  fearlessLockedChampionIds: string[];
  /**
   * Which SIDE takes the first pick/ban of the sequence. Decoupled from side
   * selection: the coin-flip loser may hold first pick from red side. 'BLUE' is
   * the standard LCK/LEC default (blue side starts).
   */
  firstPickSide: DraftSide;
  /** Epoch ms when the current step's timer expires. null if no active step. */
  timerDeadline: number | null;
  /** Optimistic concurrency token. Increments on every state change. */
  version: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface CreateInitialStateOptions {
  draftId: string;
  fearlessLockedChampionIds?: readonly string[];
  /** Side that takes first pick. Defaults to 'BLUE' (standard). */
  firstPickSide?: DraftSide;
}

export interface ActionInput {
  championId: string;
  actorSide: DraftSide;
  /** Epoch ms when the action was received (used to set lockedAt). */
  now: number;
}

export interface ApplyActionSuccess {
  ok: true;
  state: DraftState;
  locked: LockedAction;
}

export interface ApplyActionFailure {
  ok: false;
  reason:
    | 'NOT_IN_PROGRESS'
    | 'NO_CURRENT_STEP'
    | 'WRONG_SIDE'
    | 'CHAMPION_ALREADY_PICKED_OR_BANNED'
    | 'CHAMPION_FEARLESS_LOCKED';
}

export type ApplyActionResult = ApplyActionSuccess | ApplyActionFailure;

export interface AutoActionResolution {
  championId: string | null;
  wasAutoPicked: true;
}
