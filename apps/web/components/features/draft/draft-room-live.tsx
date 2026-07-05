'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Check, Circle, CircleDot, Lock, X } from 'lucide-react';
import {
  DRAFT_SEQUENCE,
  type CoinflipDecision,
  getCurrentSide,
  getUnavailableChampionIds,
  type DraftSide,
} from '@nexus/draft-engine';
import { api } from '@/lib/trpc/react';
import {
  useDraftSocket,
  type CoinflipResult,
  type CoinflipState,
  type NextGameVoteState,
  type ResultVoteState,
} from '@/hooks/use-draft-socket';
import { ChampionIcon } from '@/components/ui/champion-icon';
import { cn } from '@/lib/utils/cn';
import { DraftChampionGrid } from './draft-champion-grid';
import { DraftControlBar } from './draft-control-bar';
import { DraftSidePanel, type TeamRosterPlayer } from './draft-slot-strip';
import { DraftTimer } from './draft-timer';

interface TeamLite {
  id: string;
  name: string;
  shortCode: string | null;
  logoUrl?: string | null;
  players?: TeamRosterPlayer[];
}

interface SiblingDraft {
  id: string;
  gameNumber: number;
  status: 'LOBBY' | 'COINFLIP' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  blueTeam: TeamLite;
  redTeam: TeamLite;
  winnerSide: DraftSide | null;
  winnerTeamId: string | null;
}

interface DraftRoomLiveProps {
  draftId: string;
  blueTeam: TeamLite;
  redTeam: TeamLite;
  siblings: SiblingDraft[];
  initialResultState: ResultVoteState | null;
  initialCoinflipState: CoinflipState | null;
}

export function DraftRoomLive({
  draftId,
  blueTeam,
  redTeam,
  siblings,
  initialResultState,
  initialCoinflipState,
}: DraftRoomLiveProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeDraftId, setActiveDraftId] = useState(draftId);
  const [siblingsState, setSiblingsState] = useState(siblings);
  const socket = useDraftSocket(activeDraftId);
  const [pendingChampion, setPendingChampion] = useState<string | null>(null);
  const [selectedChampion, setSelectedChampion] = useState<string | null>(null);
  const championsQuery = api.champion.list.useQuery({ onlyEnabled: true });

  useEffect(() => {
    setSiblingsState(siblings);
  }, [siblings]);

  const activeSibling = siblingsState.find((s) => s.id === activeDraftId);
  const activeBlue = activeSibling?.blueTeam ?? blueTeam;
  const activeRed = activeSibling?.redTeam ?? redTeam;
  const effectiveResultState = socket.resultState ?? initialResultState;
  const effectiveCoinflipState = socket.coinflipState ?? initialCoinflipState;

  useEffect(() => {
    const status = socket.state?.status;
    if (!status) return;
    setSiblingsState((prev) =>
      prev.map((s) => (s.id === activeDraftId && s.status !== status ? { ...s, status } : s)),
    );
  }, [activeDraftId, socket.state?.status]);

  useEffect(() => {
    const winnerSide = socket.resultState?.winnerSide ?? null;
    const winnerTeamId = socket.resultState?.winnerTeamId ?? null;
    setSiblingsState((prev) =>
      prev.map((s) =>
        s.id === activeDraftId &&
        (s.winnerSide !== winnerSide || s.winnerTeamId !== winnerTeamId)
          ? { ...s, winnerSide, winnerTeamId }
          : s,
      ),
    );
  }, [activeDraftId, socket.resultState?.winnerSide, socket.resultState?.winnerTeamId]);

  useEffect(() => {
    const nextId = socket.nextGameState?.nextGameDraftId ?? null;
    if (!nextId) return;
    setSiblingsState((prev) => {
      if (prev.some((s) => s.id === nextId)) return prev;
      const current = prev.find((s) => s.id === activeDraftId);
      if (!current) return prev;
      return [
        ...prev,
        {
          id: nextId,
          gameNumber: current.gameNumber + 1,
          status: 'COINFLIP',
          blueTeam: current.blueTeam,
          redTeam: current.redTeam,
          winnerSide: null,
          winnerTeamId: null,
        },
      ];
    });
    router.refresh();
  }, [activeDraftId, router, socket.nextGameState?.nextGameDraftId]);

  useEffect(() => {
    const coinflip = socket.coinflipState;
    if (!coinflip) return;
    setSiblingsState((prev) =>
      prev.map((s) => {
        if (s.id !== activeDraftId) return s;
        if (s.blueTeam.id === coinflip.blueTeamId && s.redTeam.id === coinflip.redTeamId) {
          return s;
        }
        return {
          ...s,
          blueTeam: s.blueTeam.id === coinflip.blueTeamId ? s.blueTeam : s.redTeam,
          redTeam: s.redTeam.id === coinflip.redTeamId ? s.redTeam : s.blueTeam,
        };
      }),
    );
  }, [activeDraftId, socket.coinflipState]);

  function isUnlocked(target: SiblingDraft, list: SiblingDraft[]): boolean {
    if (target.gameNumber === 1) return true;
    const prev = list.find((s) => s.gameNumber === target.gameNumber - 1);
    if (!prev) return false;
    return prev.status === 'COMPLETED' && prev.winnerSide !== null;
  }

  function switchTo(nextId: string) {
    if (nextId === activeDraftId) return;
    const target = siblingsState.find((s) => s.id === nextId);
    if (!target || !isUnlocked(target, siblingsState)) return;
    setActiveDraftId(nextId);
    setPendingChampion(null);
    setSelectedChampion(null);
    if (pathname) {
      router.replace(pathname.replace(/\/draft\/[^/]+/, `/draft/${nextId}`), { scroll: false });
    }
  }

  const state = socket.state;
  const status = state?.status ?? 'LOBBY';
  const currentSide = state ? getCurrentSide(state) : null;
  const userSide =
    socket.role === 'DEV_DUAL_CAPTAIN'
      ? currentSide
      : socket.teamId === activeBlue.id
        ? 'BLUE'
        : socket.teamId === activeRed.id
          ? 'RED'
          : null;
  const canPick =
    status === 'IN_PROGRESS' &&
    userSide !== null &&
    currentSide === userSide &&
    pendingChampion === null;

  const unavailableIds = useMemo(() => {
    if (!state) return new Set<string>();
    return new Set(getUnavailableChampionIds(state));
  }, [state]);

  const currentStepDef = state ? DRAFT_SEQUENCE[state.currentStep - 1] : undefined;
  const currentActionType = currentStepDef?.type ?? null;

  const selectedChampionName = useMemo(() => {
    if (!selectedChampion) return null;
    const found = championsQuery.data?.find((c) => c.id === selectedChampion);
    return found?.name ?? selectedChampion;
  }, [selectedChampion, championsQuery.data]);

  function onSelect(championId: string) {
    if (!canPick || unavailableIds.has(championId)) return;
    setSelectedChampion((prev) => {
      const next = prev === championId ? null : championId;
      socket.setTentative(next);
      return next;
    });
  }

  async function onConfirm() {
    if (!selectedChampion) return;
    const championId = selectedChampion;
    setPendingChampion(championId);
    setSelectedChampion(null);
    socket.setTentative(null);
    const ack = await socket.submitAction(championId);
    if (!ack.ok) {
      setPendingChampion(null);
    }
  }

  if (pendingChampion && state && state.actions.some((action) => action.championId === pendingChampion)) {
    setPendingChampion(null);
  }

  const setTentative = socket.setTentative;
  useEffect(() => {
    if (selectedChampion && (!canPick || unavailableIds.has(selectedChampion))) {
      setSelectedChampion(null);
      setTentative(null);
    }
  }, [selectedChampion, canPick, unavailableIds, setTentative]);

  const blueTentative =
    userSide === 'BLUE' && currentSide === 'BLUE'
      ? selectedChampion
      : socket.remoteTentative?.side === 'BLUE' && socket.remoteTentative.step === state?.currentStep
        ? socket.remoteTentative.championId
        : null;
  const redTentative =
    userSide === 'RED' && currentSide === 'RED'
      ? selectedChampion
      : socket.remoteTentative?.side === 'RED' && socket.remoteTentative.step === state?.currentStep
        ? socket.remoteTentative.championId
        : null;

  return (
    <section className="flex flex-col gap-6">
      {siblingsState.length > 1 ? (
        <GameTabs
          siblings={siblingsState}
          activeId={activeDraftId}
          onSelect={switchTo}
          isUnlocked={(s) => isUnlocked(s, siblingsState)}
        />
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-4 border border-hairline bg-surface px-5 py-4">
        <ConnectionPill status={socket.status} />
        <StepBreadcrumb currentStep={state?.currentStep ?? 0} status={status} />
        <DraftTimer deadline={socket.timerDeadline} offset={socket.serverOffset} />
      </header>

      <DraftControlBar draftId={activeDraftId} status={status} role={socket.role} />

      {socket.error ? (
        <div className="flex items-center gap-3 border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm text-[color:var(--loss)]">
          <AlertTriangle className="h-4 w-4" />
          <span className="label-mono">{socket.error.code}</span>
          <span>{socket.error.message}</span>
        </div>
      ) : null}

      {state ? (
        <div className="flex min-w-0 flex-col gap-4">
          {status === 'LOBBY' ? (
            <LobbyPanel
              role={socket.role}
              ready={socket.ready}
              participants={socket.participants}
            />
          ) : status === 'COINFLIP' ? (
            <CoinflipPanel
              role={socket.role}
              teamId={socket.teamId}
              blueTeam={activeBlue}
              redTeam={activeRed}
              coinflipState={effectiveCoinflipState}
              coinflipResult={socket.coinflipResult}
              submitCoinflipChoice={socket.submitCoinflipChoice}
            />
          ) : status === 'CANCELLED' ? (
            <Banner tone="danger">Cette draft a ete annulee.</Banner>
          ) : status === 'COMPLETED' ? (
            <div className="flex flex-col gap-3">
              <ResultPanel
                resultState={effectiveResultState}
                role={socket.role}
                blueTeam={activeBlue}
                redTeam={activeRed}
                voteResult={socket.voteResult}
              />
              {effectiveResultState?.winnerSide && socket.nextGameState?.canStartNextGame ? (
                <NextGamePanel
                  nextGameState={socket.nextGameState}
                  role={socket.role}
                  teamId={socket.teamId}
                  blueTeam={activeBlue}
                  redTeam={activeRed}
                  voteNextGame={socket.voteNextGame}
                  onNavigate={(id) => switchTo(id)}
                />
              ) : null}
            </div>
          ) : (
            <CurrentStepBanner
              currentSide={currentSide}
              stepIndex={state.currentStep}
              blueName={activeBlue.name}
              redName={activeRed.name}
              userSide={userSide}
              status={status}
            />
          )}

          <FearlessRecap championIds={state.fearlessLockedChampionIds} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_18rem]">
            <DraftSidePanel
              state={state}
              team={activeBlue}
              side="BLUE"
              lastAction={socket.lastAction}
              lastChampionStats={socket.lastChampionStats}
              tentativeChampionId={blueTentative}
            />

            <div className="flex min-w-0 flex-col gap-4">
              {status === 'IN_PROGRESS' || status === 'PAUSED' ? (
                <DraftChampionGrid
                  unavailableIds={unavailableIds}
                  canPick={canPick}
                  selectedChampionId={selectedChampion}
                  onSelect={onSelect}
                  pendingChampionId={pendingChampion}
                />
              ) : null}

              <ConfirmBar
                actionType={currentActionType}
                side={currentSide}
                championName={selectedChampionName}
                disabled={!selectedChampion || pendingChampion !== null}
                submitting={pendingChampion !== null}
                onConfirm={onConfirm}
                onCancel={() => {
                  setSelectedChampion(null);
                  socket.setTentative(null);
                }}
              />
            </div>

            <DraftSidePanel
              state={state}
              team={activeRed}
              side="RED"
              lastAction={socket.lastAction}
              lastChampionStats={socket.lastChampionStats}
              tentativeChampionId={redTentative}
            />
          </div>
        </div>
      ) : (
        <div className="border border-hairline bg-surface px-5 py-8 text-sm text-foreground-dim">
          Connexion a la salle...
        </div>
      )}
    </section>
  );
}

function ConfirmBar({
  actionType,
  side,
  championName,
  disabled,
  submitting,
  onConfirm,
  onCancel,
}: {
  actionType: 'PICK' | 'BAN' | null;
  side: 'BLUE' | 'RED' | null;
  championName: string | null;
  disabled: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!championName && !submitting) return null;
  const accent = side === 'BLUE' ? 'var(--accent)' : side === 'RED' ? 'var(--loss)' : 'var(--accent)';
  const verb = actionType === 'BAN' ? 'le ban' : 'le pick';
  const verbTitle = actionType === 'BAN' ? 'Ban' : 'Pick';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border bg-surface px-5 py-3"
      style={{ borderColor: accent }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="label-mono" style={{ color: accent }}>
          {verbTitle}
        </span>
        <span className="truncate font-display text-lg text-foreground" title={championName ?? ''}>
          {championName ?? '...'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 border border-hairline bg-bg px-3 py-1.5 text-sm text-foreground-muted transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 15%, transparent)` }}
        >
          <Check className="h-3.5 w-3.5" />
          Confirmer {verb}
        </button>
      </div>
    </div>
  );
}

function FearlessRecap({ championIds }: { championIds: readonly string[] }) {
  if (championIds.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 border border-hairline bg-surface px-4 py-3">
      <header className="flex items-center justify-between">
        <span className="label-mono inline-flex items-center gap-2 text-foreground-muted">
          <Lock className="h-3 w-3" />
          Fearless - verrouilles
        </span>
        <span className="label-mono tabular-nums text-foreground-muted">{championIds.length}</span>
      </header>
      <ul className="flex flex-wrap gap-1.5">
        {championIds.map((id) => (
          <li key={id}>
            <span title={id} className="block h-8 w-8 overflow-hidden border border-hairline bg-bg opacity-70 grayscale">
              <ChampionIcon championId={id} size="lg" className="h-full w-full rounded-none" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TAB_STATUS_LABEL: Record<SiblingDraft['status'], string> = {
  LOBBY: 'Lobby',
  COINFLIP: 'Coin flip',
  IN_PROGRESS: 'En cours',
  PAUSED: 'Pause',
  COMPLETED: 'Termine',
  CANCELLED: 'Annule',
};

function GameTabs({
  siblings,
  activeId,
  onSelect,
  isUnlocked,
}: {
  siblings: SiblingDraft[];
  activeId: string;
  onSelect: (id: string) => void;
  isUnlocked: (sibling: SiblingDraft) => boolean;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 border border-hairline bg-surface px-3 py-3">
      <span className="label-mono px-2 text-foreground-muted">§ Games</span>
      {siblings.map((sibling) => {
        const isActive = sibling.id === activeId;
        const unlocked = isUnlocked(sibling);
        return (
          <button
            key={sibling.id}
            type="button"
            onClick={() => onSelect(sibling.id)}
            disabled={!unlocked}
            title={unlocked ? undefined : `Termine la game ${sibling.gameNumber - 1} d'abord.`}
            className={cn(
              'flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors duration-150',
              !unlocked
                ? 'cursor-not-allowed border-hairline/40 text-foreground-muted/40'
                : isActive
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-hairline text-foreground-muted hover:border-accent/40 hover:text-foreground',
            )}
          >
            <span className="font-display tabular-nums">G{sibling.gameNumber}</span>
            <span className="label-mono text-[10px] opacity-70">
              {unlocked ? TAB_STATUS_LABEL[sibling.status] : 'Verrouille'}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function ConnectionPill({ status }: { status: ReturnType<typeof useDraftSocket>['status'] }) {
  const label =
    status === 'connected'
      ? 'En ligne'
      : status === 'connecting' || status === 'fetching-token'
        ? 'Connexion...'
        : status === 'disconnected'
          ? 'Deconnecte'
          : status === 'error'
            ? 'Erreur'
            : 'Inactif';
  const color =
    status === 'connected'
      ? 'text-[color:var(--win)] border-emerald-500/40'
      : status === 'error' || status === 'disconnected'
        ? 'text-[color:var(--loss)] border-rose-500/40'
        : 'text-foreground-muted border-hairline';

  return (
    <span className={cn('inline-flex items-center gap-2 border px-2 py-1 label-mono', color)}>
      {status === 'connected' ? (
        <CircleDot className="h-3 w-3 animate-pulse" />
      ) : (
        <Circle className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}

function StepBreadcrumb({ currentStep, status }: { currentStep: number; status: string }) {
  if (status === 'LOBBY') {
    return <span className="label-mono text-foreground-muted">Lobby</span>;
  }
  if (status === 'COINFLIP') {
    return <span className="label-mono text-foreground-muted">Coin flip</span>;
  }
  return (
    <div className="flex items-center gap-4">
      <span className="label-mono text-foreground-muted">Etape</span>
      <span className="font-display text-2xl text-foreground tabular-nums">
        {currentStep} / {DRAFT_SEQUENCE.length}
      </span>
    </div>
  );
}

function CurrentStepBanner({
  currentSide,
  stepIndex,
  blueName,
  redName,
  userSide,
  status,
}: {
  currentSide: 'BLUE' | 'RED' | null;
  stepIndex: number;
  blueName: string;
  redName: string;
  userSide: 'BLUE' | 'RED' | null;
  status: string;
}) {
  if (status === 'PAUSED') {
    return <Banner tone="warning">Draft en pause par un admin.</Banner>;
  }
  if (!currentSide) return null;
  const stepDef = DRAFT_SEQUENCE[stepIndex - 1];
  const sideName = currentSide === 'BLUE' ? blueName : redName;
  const sideColor = currentSide === 'BLUE' ? 'var(--accent)' : 'var(--loss)';
  const yourTurn = userSide === currentSide;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border bg-surface px-5 py-3"
      style={{ borderColor: sideColor }}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full" style={{ background: sideColor }} />
        <span className="label-mono" style={{ color: sideColor }}>
          {stepDef?.type === 'BAN' ? 'Ban' : 'Pick'}
        </span>
        <span className="font-display text-lg text-foreground">{sideName}</span>
      </div>
      <span className="label-mono text-foreground-muted">
        {yourTurn ? 'A toi de jouer' : 'En attente...'}
      </span>
    </div>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: 'danger' | 'success' | 'warning' }) {
  const cls =
    tone === 'danger'
      ? 'border-rose-500/40 bg-rose-500/5 text-[color:var(--loss)]'
      : tone === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/5 text-[color:var(--win)]'
        : 'border-amber-400/40 bg-amber-400/5 text-amber-200';
  return <div className={cn('border px-5 py-3 text-sm', cls)}>{children}</div>;
}

function LobbyPanel({
  role,
  ready,
  participants,
}: {
  role: ReturnType<typeof useDraftSocket>['role'];
  ready: ReturnType<typeof useDraftSocket>['ready'];
  participants: ReturnType<typeof useDraftSocket>['participants'];
}) {
  const [pending, setPending] = useState(false);
  const isCaptain =
    role === 'BLUE_CAPTAIN' || role === 'RED_CAPTAIN' || role === 'DEV_DUAL_CAPTAIN';
  const me = participants.find((p) => p.role === role);
  const meReady = me?.ready === true;
  const devReady = participants.some((p) => p.role === 'DEV_DUAL_CAPTAIN' && p.ready);
  const blueReady = devReady || participants.some((p) => p.role === 'BLUE_CAPTAIN' && p.ready);
  const redReady = devReady || participants.some((p) => p.role === 'RED_CAPTAIN' && p.ready);

  async function onReady() {
    setPending(true);
    await ready();
    setPending(false);
  }

  return (
    <section className="flex flex-col gap-4 border border-hairline bg-surface px-5 py-5">
      <header className="flex items-center justify-between">
        <p className="label-mono">§ Lobby</p>
        <span className="label-mono text-foreground-muted">{participants.length} connectes</span>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <ReadyTile label="Blue" color="var(--accent)" ready={blueReady} />
        <ReadyTile label="Red" color="var(--loss)" ready={redReady} />
      </div>

      <p className="text-sm text-foreground-muted">
        Le coin flip part automatiquement des que les deux capitaines sont prets.
      </p>

      {isCaptain ? (
        <button
          type="button"
          onClick={onReady}
          disabled={pending || meReady}
          className={cn(
            'self-start border px-4 py-2 text-sm transition-colors duration-150',
            meReady
              ? 'cursor-not-allowed border-emerald-500/40 bg-emerald-500/10 text-[color:var(--win)]'
              : 'border-accent bg-accent/10 text-foreground hover:bg-accent/20',
            pending && 'opacity-70',
          )}
        >
          {meReady ? 'Pret' : 'Je suis pret'}
        </button>
      ) : null}
    </section>
  );
}

function CoinflipPanel({
  role,
  teamId,
  blueTeam,
  redTeam,
  coinflipState,
  coinflipResult,
  submitCoinflipChoice,
}: {
  role: ReturnType<typeof useDraftSocket>['role'];
  teamId: string | null;
  blueTeam: TeamLite;
  redTeam: TeamLite;
  coinflipState: CoinflipState | null;
  coinflipResult: CoinflipResult | null;
  submitCoinflipChoice: ReturnType<typeof useDraftSocket>['submitCoinflipChoice'];
}) {
  const [phase, setPhase] = useState<'idle' | 'flipping' | 'resolved'>('idle');
  const [choiceStep, setChoiceStep] = useState<'SIDE' | 'ORDER' | null>(null);
  const [pending, setPending] = useState<CoinflipDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coinflipResult) return;
    setPhase('flipping');
    const timeout = window.setTimeout(() => setPhase('resolved'), 1400);
    return () => window.clearTimeout(timeout);
  }, [coinflipResult?.winnerTeamId, coinflipResult?.blueTeamId, coinflipResult?.redTeamId]);

  const winnerTeamId = coinflipState?.winnerTeamId ?? coinflipResult?.winnerTeamId ?? null;
  const loserTeamId =
    coinflipState?.loserTeamId ??
    (winnerTeamId ? (winnerTeamId === blueTeam.id ? redTeam.id : blueTeam.id) : null);
  const decision = coinflipState?.decision ?? null;
  const loserDecision = coinflipState?.loserDecision ?? null;
  const firstPickSide = coinflipState?.firstPickSide ?? null;
  const resolved = coinflipState?.resolvedAt != null;

  const nameOf = (id: string | null) =>
    id === blueTeam.id ? blueTeam.name : id === redTeam.id ? redTeam.name : 'Equipe inconnue';
  const winnerName = nameOf(winnerTeamId);
  const loserName = nameOf(loserTeamId);

  const isDev = role === 'DEV_DUAL_CAPTAIN';
  const isWinner = isDev || (teamId !== null && winnerTeamId !== null && teamId === winnerTeamId);
  const isLoser = isDev || (teamId !== null && loserTeamId !== null && teamId === loserTeamId);

  // Which category the loser must pick = the one the winner did NOT take.
  const winnerChoseSide = decision === 'SIDE_BLUE' || decision === 'SIDE_RED';
  const loserCategory: 'SIDE' | 'ORDER' | null =
    decision === null ? null : winnerChoseSide ? 'ORDER' : 'SIDE';

  async function submit(decisionValue: CoinflipDecision) {
    setError(null);
    setPending(decisionValue);
    const ack = await submitCoinflipChoice(decisionValue);
    setPending(null);
    if (!ack.ok && ack.error) {
      setError(ack.error.message);
      return;
    }
    setChoiceStep(null);
  }

  const statusLabel = resolved
    ? 'Decision prise'
    : decision
      ? `En attente de ${loserName}`
      : phase === 'flipping'
        ? 'Tirage...'
        : 'Choix du gagnant';

  return (
    <section className="flex flex-col gap-4 border border-sky-400/30 bg-surface px-5 py-5">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="label-mono text-sky-300">§ Coin flip</p>
          <p className="mt-2 text-sm text-foreground-muted">
            Le gagnant choisit le side <span className="text-foreground">ou</span> l'ordre de pick ;
            le perdant récupère le choix restant.
          </p>
        </div>
        <span className="label-mono text-foreground-muted">{statusLabel}</span>
      </header>

      {phase === 'flipping' ? (
        <div className="flex items-center justify-between border border-sky-400/30 bg-sky-400/5 px-5 py-4">
          <span className="font-display text-xl text-foreground">Pile ou face en cours...</span>
          <span className="label-mono animate-pulse text-sky-300">RNG</span>
        </div>
      ) : winnerTeamId ? (
        <div className="flex flex-col gap-2 border border-sky-400/30 bg-sky-400/5 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2 w-2 rounded-full bg-sky-300" />
              <span className="label-mono text-sky-300">Gagnant</span>
              <span className="font-display text-lg text-foreground">{winnerName}</span>
            </div>
            {decision ? (
              <span className="label-mono text-foreground-muted">
                {formatCoinflipDecision(decision)}
              </span>
            ) : null}
          </div>
          {loserDecision ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-2 w-2 rounded-full bg-foreground-muted" />
                <span className="label-mono text-foreground-muted">Perdant</span>
                <span className="font-display text-lg text-foreground">{loserName}</span>
              </div>
              <span className="label-mono text-foreground-muted">
                {formatCoinflipDecision(loserDecision)}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <Banner tone="warning">En attente du tirage cote serveur.</Banner>
      )}

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {resolved ? (
        <Banner tone="success">
          {blueTeam.name} côté bleu · {redTeam.name} côté rouge —{' '}
          {firstPickSide ? `${firstPickSide === 'BLUE' ? blueTeam.name : redTeam.name} a le premier pick` : ''}.
          La draft démarre...
        </Banner>
      ) : decision === null ? (
        // ── Step 1: winner chooses a dimension ──
        isWinner ? (
          <ChoiceButtons
            category={choiceStep}
            pending={pending}
            onPickCategory={setChoiceStep}
            onSubmit={submit}
            allowBoth
          />
        ) : (
          <p className="text-sm text-foreground-muted">
            En attente de la décision de {winnerName}.
          </p>
        )
      ) : // ── Step 2: loser picks the remaining category ──
      isLoser ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground-muted">
            {winnerName} a choisi {formatCoinflipDecision(decision).toLowerCase()}. À toi de choisir{' '}
            {loserCategory === 'SIDE' ? 'ton side' : "l'ordre de pick"}.
          </p>
          <ChoiceButtons
            category={loserCategory}
            pending={pending}
            onPickCategory={() => undefined}
            onSubmit={submit}
          />
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">
          En attente du choix restant de {loserName}.
        </p>
      )}
    </section>
  );
}

/**
 * Renders side/order value buttons. When `allowBoth`, the actor first picks a
 * category (side vs order); otherwise `category` is fixed (loser's remaining one).
 */
function ChoiceButtons({
  category,
  pending,
  onPickCategory,
  onSubmit,
  allowBoth = false,
}: {
  category: 'SIDE' | 'ORDER' | null;
  pending: CoinflipDecision | null;
  onPickCategory: (c: 'SIDE' | 'ORDER' | null) => void;
  onSubmit: (d: CoinflipDecision) => void;
  allowBoth?: boolean;
}) {
  const busy = pending !== null;
  if (allowBoth && category === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onPickCategory('SIDE')}
          disabled={busy}
          className="border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-accent/20 disabled:opacity-50"
        >
          Choisir le side
        </button>
        <button
          type="button"
          onClick={() => onPickCategory('ORDER')}
          disabled={busy}
          className="border border-sky-400/40 bg-sky-400/10 px-4 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-sky-400/20 disabled:opacity-50"
        >
          Choisir l'ordre de pick
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {category === 'SIDE' ? (
        <>
          <button
            type="button"
            onClick={() => onSubmit('SIDE_BLUE')}
            disabled={busy}
            className="border border-accent bg-accent/10 px-4 py-2 text-sm text-foreground disabled:opacity-50"
          >
            Blue side
          </button>
          <button
            type="button"
            onClick={() => onSubmit('SIDE_RED')}
            disabled={busy}
            className="border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-foreground disabled:opacity-50"
          >
            Red side
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSubmit('FIRST_PICK')}
            disabled={busy}
            className="border border-sky-400/40 bg-sky-400/10 px-4 py-2 text-sm text-foreground disabled:opacity-50"
          >
            Premier pick
          </button>
          <button
            type="button"
            onClick={() => onSubmit('SECOND_PICK')}
            disabled={busy}
            className="border border-hairline bg-bg px-4 py-2 text-sm text-foreground disabled:opacity-50"
          >
            Second pick
          </button>
        </>
      )}
      {allowBoth ? (
        <button
          type="button"
          onClick={() => onPickCategory(null)}
          disabled={busy}
          className="border border-hairline px-4 py-2 text-sm text-foreground-muted"
        >
          Retour
        </button>
      ) : null}
    </div>
  );
}

function formatCoinflipDecision(decision: CoinflipDecision): string {
  switch (decision) {
    case 'SIDE_BLUE':
      return 'Choix: Blue side';
    case 'SIDE_RED':
      return 'Choix: Red side';
    case 'FIRST_PICK':
      return 'Choix: Premier pick';
    case 'SECOND_PICK':
      return 'Choix: Second pick';
  }
}

function ResultPanel({
  resultState,
  role,
  blueTeam,
  redTeam,
  voteResult,
}: {
  resultState: ResultVoteState | null;
  role: ReturnType<typeof useDraftSocket>['role'];
  blueTeam: TeamLite;
  redTeam: TeamLite;
  voteResult: ReturnType<typeof useDraftSocket>['voteResult'];
}) {
  const [pending, setPending] = useState<DraftSide | null>(null);
  const [error, setError] = useState<string | null>(null);

  const winnerSide = resultState?.winnerSide ?? null;
  const blueVote = resultState?.blueResultVote ?? null;
  const redVote = resultState?.redResultVote ?? null;

  if (winnerSide) {
    const winnerName = winnerSide === 'BLUE' ? blueTeam.name : redTeam.name;
    const winnerColor = winnerSide === 'BLUE' ? 'var(--accent)' : 'var(--loss)';
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 border bg-surface px-5 py-4"
        style={{ borderColor: winnerColor }}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2 w-2 rounded-full" style={{ background: winnerColor }} />
          <span className="label-mono" style={{ color: winnerColor }}>
            Vainqueur
          </span>
          <span className="font-display text-lg text-foreground">{winnerName}</span>
        </div>
        <span className="label-mono text-foreground-muted">Resultat verrouille</span>
      </div>
    );
  }

  const isCaptain =
    role === 'BLUE_CAPTAIN' || role === 'RED_CAPTAIN' || role === 'DEV_DUAL_CAPTAIN';

  async function cast(side: DraftSide) {
    setError(null);
    setPending(side);
    const ack = await voteResult(side);
    setPending(null);
    if (!ack.ok && ack.error) {
      setError(ack.error.message);
    }
  }

  const myVote = role === 'BLUE_CAPTAIN' ? blueVote : role === 'RED_CAPTAIN' ? redVote : null;
  const disagree = blueVote !== null && redVote !== null && blueVote !== redVote;

  return (
    <section className="flex flex-col gap-4 border border-hairline bg-surface px-5 py-5">
      <header className="flex items-center justify-between">
        <p className="label-mono">§ Vote du resultat</p>
        <span className="label-mono text-foreground-muted">
          Draft terminee - confirmez le vainqueur
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <VoteTile label={blueTeam.name} color="var(--accent)" captainVote={blueVote} opponentLabel="Blue" />
        <VoteTile label={redTeam.name} color="var(--loss)" captainVote={redVote} opponentLabel="Red" />
      </div>

      {disagree ? (
        <Banner tone="warning">Les capitaines ne sont pas d'accord sur le resultat.</Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {isCaptain ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => cast('BLUE')}
            disabled={pending !== null}
            className={cn(
              'inline-flex items-center gap-2 border px-4 py-2 text-sm transition-colors duration-150',
              myVote === 'BLUE'
                ? 'border-accent bg-accent/20 text-foreground'
                : 'border-accent/40 bg-accent/5 text-foreground hover:bg-accent/15',
              pending !== null && 'cursor-wait opacity-60',
            )}
            style={{ borderColor: 'var(--accent)' }}
          >
            <span className="label-mono" style={{ color: 'var(--accent)' }}>
              Blue
            </span>
            <span>{blueTeam.name} a gagne</span>
          </button>
          <button
            type="button"
            onClick={() => cast('RED')}
            disabled={pending !== null}
            className={cn(
              'inline-flex items-center gap-2 border px-4 py-2 text-sm transition-colors duration-150',
              myVote === 'RED'
                ? 'border-rose-500 bg-rose-500/20 text-foreground'
                : 'border-rose-500/40 bg-rose-500/5 text-foreground hover:bg-rose-500/15',
              pending !== null && 'cursor-wait opacity-60',
            )}
            style={{ borderColor: 'var(--loss)' }}
          >
            <span className="label-mono" style={{ color: 'var(--loss)' }}>
              Red
            </span>
            <span>{redTeam.name} a gagne</span>
          </button>
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">En attente du vote des capitaines.</p>
      )}
    </section>
  );
}

function NextGamePanel({
  nextGameState,
  role,
  teamId,
  blueTeam,
  redTeam,
  voteNextGame,
  onNavigate,
}: {
  nextGameState: NextGameVoteState;
  role: ReturnType<typeof useDraftSocket>['role'];
  teamId: ReturnType<typeof useDraftSocket>['teamId'];
  blueTeam: TeamLite;
  redTeam: TeamLite;
  voteNextGame: ReturnType<typeof useDraftSocket>['voteNextGame'];
  onNavigate: (draftId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { blueNextGameVote, redNextGameVote, nextGameDraftId } = nextGameState;
  const isCaptain =
    role === 'BLUE_CAPTAIN' || role === 'RED_CAPTAIN' || role === 'DEV_DUAL_CAPTAIN';
  const userSide: 'BLUE' | 'RED' | null =
    role === 'DEV_DUAL_CAPTAIN'
      ? null
      : teamId === blueTeam.id
        ? 'BLUE'
        : teamId === redTeam.id
          ? 'RED'
          : role === 'BLUE_CAPTAIN'
            ? 'BLUE'
            : role === 'RED_CAPTAIN'
              ? 'RED'
              : null;
  const hasVoted =
    role === 'DEV_DUAL_CAPTAIN'
      ? blueNextGameVote && redNextGameVote
      : userSide === 'BLUE'
        ? blueNextGameVote
        : userSide === 'RED'
          ? redNextGameVote
          : false;

  async function cast() {
    setError(null);
    setPending(true);
    const ack = await voteNextGame();
    setPending(false);
    if (!ack.ok && ack.error) {
      setError(ack.error.message);
    }
  }

  if (nextGameDraftId) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 border bg-surface px-5 py-4"
        style={{ borderColor: 'var(--accent)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-2 w-2 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
          <span className="label-mono" style={{ color: 'var(--accent)' }}>
            Game suivante prete
          </span>
          <span className="text-sm text-foreground-muted">
            L'equipe perdante choisit son cote (coin flip).
          </span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(nextGameDraftId)}
          className="inline-flex items-center gap-2 border border-accent/60 bg-accent/10 px-4 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-accent/20"
          style={{ borderColor: 'var(--accent)' }}
        >
          Aller a la game suivante
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 border border-hairline bg-surface px-5 py-5">
      <header className="flex items-center justify-between">
        <p className="label-mono">§ Lancer la game suivante</p>
        <span className="label-mono text-foreground-muted">
          Les deux capitaines doivent confirmer
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <ReadyTile label={blueTeam.name} color="var(--accent)" ready={blueNextGameVote} />
        <ReadyTile label={redTeam.name} color="var(--loss)" ready={redNextGameVote} />
      </div>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {isCaptain ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cast}
            disabled={pending || hasVoted}
            className={cn(
              'inline-flex items-center gap-2 border px-4 py-2 text-sm transition-colors duration-150',
              hasVoted
                ? 'border-accent bg-accent/20 text-foreground'
                : 'border-accent/40 bg-accent/5 text-foreground hover:bg-accent/15',
              (pending || hasVoted) && 'cursor-default opacity-80',
            )}
            style={{ borderColor: 'var(--accent)' }}
          >
            <span className="label-mono" style={{ color: 'var(--accent)' }}>
              {hasVoted ? 'Pret' : 'Confirmer'}
            </span>
            <span>Passer a la game suivante</span>
          </button>
        </div>
      ) : (
        <p className="text-sm text-foreground-muted">
          En attente de la confirmation des capitaines.
        </p>
      )}
    </section>
  );
}

function VoteTile({
  label,
  color,
  captainVote,
  opponentLabel,
}: {
  label: string;
  color: string;
  captainVote: DraftSide | null;
  opponentLabel: string;
}) {
  const status =
    captainVote === null ? 'En attente' : captainVote === 'BLUE' ? 'A vote Blue' : 'A vote Red';
  const voteColor = captainVote === null ? 'text-foreground-muted' : 'text-[color:var(--win)]';
  return (
    <div className="flex flex-col gap-1 border bg-bg px-4 py-3" style={{ borderColor: color }}>
      <span className="label-mono" style={{ color }}>
        {opponentLabel}
      </span>
      <span className="truncate font-display text-sm text-foreground" title={label}>
        {label}
      </span>
      <span className={cn('label-mono text-[10px]', voteColor)}>{status}</span>
    </div>
  );
}

function ReadyTile({ label, color, ready }: { label: string; color: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between border bg-bg px-4 py-3" style={{ borderColor: color }}>
      <span className="label-mono" style={{ color }}>
        {label}
      </span>
      <span className={cn('label-mono', ready ? 'text-[color:var(--win)]' : 'text-foreground-muted')}>
        {ready ? 'Ready' : 'En attente'}
      </span>
    </div>
  );
}
