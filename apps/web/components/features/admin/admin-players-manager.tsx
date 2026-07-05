'use client';

import type { SharedPlayerRole } from '@nexus/types';
import type { inferRouterOutputs } from '@trpc/server';
import { Loader2, PencilLine, Plus, Radio, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ImageInput } from '@/components/ui/image-input';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/trpc/react';
import { buildPlayerRiotId, getPlayerInitials } from '@/lib/utils/player-display';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';
import { getCostBaseValue } from '@/lib/utils/transfer-rules';
import type { AppRouter } from '@/server/routers/_app';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type AdminPlayerDetails = RouterOutputs['player']['getAdminDetails'];

const roleOptions: SharedPlayerRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

interface FeedbackState {
  type: 'success' | 'error';
  message: string;
}

interface PlayerDraftState {
  displayName: string;
  gameName: string;
  tagLine: string;
  imageUrl: string;
  role: SharedPlayerRole;
  secondaryRoles: SharedPlayerRole[];
  teamId: string;
  marketValue: string;
  salary: string;
  cost: string;
  age: string;
  nationality: string;
  isActive: boolean;
}

function createEmptyPlayerDraft(): PlayerDraftState {
  return {
    displayName: '',
    gameName: '',
    tagLine: '',
    imageUrl: '',
    role: 'TOP',
    secondaryRoles: [],
    teamId: '',
    marketValue: '0',
    salary: '0',
    cost: '1',
    age: '',
    nationality: '',
    isActive: true,
  };
}

function createPlayerDraft(player: AdminPlayerDetails): PlayerDraftState {
  return {
    displayName: player.displayName,
    gameName: player.gameName,
    tagLine: player.tagLine,
    imageUrl: player.imageUrl ?? '',
    role: player.role,
    secondaryRoles: player.secondaryRoles,
    teamId: player.teamId ?? '',
    marketValue: player.marketValue.toString(),
    salary: player.salary.toString(),
    cost: (player.cost ?? 1).toString(),
    age: player.age?.toString() ?? '',
    nationality: player.nationality ?? '',
    isActive: player.isActive,
  };
}

function toDateTimeLocalValue(value: Date | string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toDateValue(value: Date | string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getInitials(gameName: string) {
  return getPlayerInitials(gameName);
}

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseInteger(value: string, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function FeedbackBanner({ feedback }: { feedback: FeedbackState | null }) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3 text-sm',
        feedback.type === 'success'
          ? 'border-emerald-400/20 bg-emerald-500/10 text-[color:var(--win)]'
          : 'border-rose-400/20 bg-rose-500/10 text-[color:var(--loss)]',
      )}
    >
      {feedback.message}
    </div>
  );
}

export function AdminPlayersManager() {
  const utils = api.useUtils();
  const registryQuery = api.player.getAdminRegistry.useQuery();
  const optionsQuery = api.player.getAdminOptions.useQuery();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [draft, setDraft] = useState<PlayerDraftState>(createEmptyPlayerDraft);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    requireText?: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  async function runConfirm() {
    if (!confirmState) return;
    setConfirmPending(true);
    try {
      await confirmState.action();
      setConfirmState(null);
    } finally {
      setConfirmPending(false);
    }
  }
  const selectedPlayerQuery = api.player.getAdminDetails.useQuery(
    { id: selectedPlayerId ?? '' },
    {
      enabled: selectedPlayerId !== null,
    },
  );

  const createPlayer = api.player.create.useMutation();
  const updatePlayer = api.player.update.useMutation();
  const deletePlayer = api.player.delete.useMutation();
  const createHistoryEntry = api.player.createMarketValueHistory.useMutation();
  const updateHistoryEntry = api.player.updateMarketValueHistory.useMutation();
  const deleteHistoryEntry = api.player.deleteMarketValueHistory.useMutation();
  const createTrophy = api.player.createTrophy.useMutation();
  const updateTrophy = api.player.updateTrophy.useMutation();
  const deleteTrophy = api.player.deleteTrophy.useMutation();
  const fetchFromRiot = api.stats.fetchFromRiot.useMutation();

  useEffect(() => {
    if (selectedPlayerQuery.data) {
      setDraft(createPlayerDraft(selectedPlayerQuery.data));
    }
  }, [selectedPlayerQuery.data]);

  const players = registryQuery.data ?? [];
  const teams = optionsQuery.data?.teams ?? [];
  const selectedPlayer = selectedPlayerQuery.data ?? null;
  const filteredPlayers = players.filter((player) => {
    const needle = playerSearch.trim().toLowerCase();

    if (needle.length === 0) {
      return true;
    }

    return [player.displayName, player.gameName, player.teamName, player.tagLine]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  async function refreshAdminPlayerData(playerId?: string | null) {
    await Promise.all([
      utils.player.getAdminRegistry.invalidate(),
      utils.player.getAdminOptions.invalidate(),
      playerId
        ? utils.player.getAdminDetails.invalidate({ id: playerId })
        : utils.player.getAdminDetails.invalidate(),
    ]);
  }

  async function handlePlayerSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    try {
      const displayName = draft.displayName.trim() || draft.gameName.trim();
      const payload = {
        firstName: displayName,
        lastName: displayName,
        gameName: draft.gameName.trim(),
        tagLine: draft.tagLine.trim(),
        imageUrl: draft.imageUrl.trim().length > 0 ? draft.imageUrl.trim() : null,
        role: draft.role,
        secondaryRoles: draft.secondaryRoles,
        teamId: draft.teamId.length > 0 ? draft.teamId : null,
        marketValue: parseInteger(draft.marketValue),
        salary: parseInteger(draft.salary),
        cost: Math.min(5, Math.max(1, parseInteger(draft.cost, 1))),
        age: parseOptionalInteger(draft.age),
        nationality: draft.nationality.trim() || undefined,
        isActive: draft.isActive,
      } as const;

      if (selectedPlayerId) {
        await updatePlayer.mutateAsync({
          id: selectedPlayerId,
          ...payload,
        });
        await refreshAdminPlayerData(selectedPlayerId);
        setFeedback({ type: 'success', message: 'Le joueur a bien ete mis a jour.' });
        return;
      }

      const created = await createPlayer.mutateAsync(payload);
      setSelectedPlayerId(created.id);
      await refreshAdminPlayerData(created.id);
      setFeedback({ type: 'success', message: 'Le joueur a bien ete ajoute au transfermarket.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La sauvegarde du joueur a echoue.';
      setFeedback({ type: 'error', message });
    }
  }

  function handleDeletePlayer() {
    if (!selectedPlayerId) {
      return;
    }

    const playerLabel = selectedPlayer?.gameName ?? 'SUPPRIMER';

    setConfirmState({
      title: 'Supprimer ce joueur ?',
      description:
        'Cette action est irréversible et supprime toutes les données associées (contrats, historique, statistiques).',
      confirmLabel: 'Supprimer définitivement',
      requireText: playerLabel,
      action: async () => {
        setFeedback(null);
        try {
          await deletePlayer.mutateAsync({ id: selectedPlayerId });
          setSelectedPlayerId(null);
          setDraft(createEmptyPlayerDraft());
          await refreshAdminPlayerData();
          setFeedback({ type: 'success', message: 'Le joueur a bien ete supprime.' });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'La suppression du joueur a echoue.';
          setFeedback({ type: 'error', message });
        }
      },
    });
  }

  function handlePrimaryRoleChange(role: SharedPlayerRole) {
    setDraft((current) => ({
      ...current,
      role,
      secondaryRoles: current.secondaryRoles.filter((value) => value !== role),
    }));
  }

  function toggleSecondaryRole(role: SharedPlayerRole) {
    setDraft((current) => ({
      ...current,
      secondaryRoles: current.secondaryRoles.includes(role)
        ? current.secondaryRoles.filter((value) => value !== role)
        : [...current.secondaryRoles, role],
    }));
  }

  async function handleFetchRiot() {
    if (!selectedPlayerId) return;
    setFeedback(null);

    try {
      await fetchFromRiot.mutateAsync({ playerId: selectedPlayerId, count: 5 });
      await refreshAdminPlayerData(selectedPlayerId);
      setFeedback({ type: 'success', message: 'Les donnees Riot ont ete recuperees avec succes.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Le fetch Riot a echoue.';
      setFeedback({ type: 'error', message });
    }
  }

  async function handleCreateHistoryEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPlayerId) {
      return;
    }

    setFeedback(null);
    const form = event.currentTarget;

    try {
      const formData = new FormData(form);
      await createHistoryEntry.mutateAsync({
        playerId: selectedPlayerId,
        newValue: parseInteger(getFormValue(formData, 'newValue')),
        changedAt: new Date(getFormValue(formData, 'changedAt')),
        reason: getFormValue(formData, 'reason').trim() || undefined,
      });
      form.reset();
      await refreshAdminPlayerData(selectedPlayerId);
      setFeedback({ type: 'success', message: 'Une nouvelle entree de valorisation a ete ajoutee.' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "L'ajout de l'historique a echoue.";
      setFeedback({ type: 'error', message });
    }
  }

  async function handleUpdateHistoryEntry(
    event: React.FormEvent<HTMLFormElement>,
    entryId: string,
  ) {
    event.preventDefault();

    if (!selectedPlayerId) {
      return;
    }

    setFeedback(null);

    try {
      const formData = new FormData(event.currentTarget);
      await updateHistoryEntry.mutateAsync({
        id: entryId,
        newValue: parseInteger(getFormValue(formData, 'newValue')),
        changedAt: new Date(getFormValue(formData, 'changedAt')),
        reason: getFormValue(formData, 'reason').trim() || undefined,
      });
      await refreshAdminPlayerData(selectedPlayerId);
      setFeedback({ type: 'success', message: "L'entree d'historique a ete mise a jour." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "La mise a jour de l'historique a echoue.";
      setFeedback({ type: 'error', message });
    }
  }

  function handleDeleteHistoryEntry(entryId: string) {
    if (!selectedPlayerId) {
      return;
    }

    setConfirmState({
      title: "Supprimer cette entrée d'historique ?",
      description: "L'entrée sera retirée de l'historique de valeur marchande du joueur.",
      confirmLabel: 'Supprimer',
      action: async () => {
        setFeedback(null);
        try {
          await deleteHistoryEntry.mutateAsync({ id: entryId });
          await refreshAdminPlayerData(selectedPlayerId);
          setFeedback({ type: 'success', message: "L'entree d'historique a ete supprimee." });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "La suppression de l'historique a echoue.";
          setFeedback({ type: 'error', message });
        }
      },
    });
  }

  async function handleCreateTrophy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedPlayerId) {
      return;
    }

    setFeedback(null);
    const form = event.currentTarget;

    try {
      const formData = new FormData(form);
      await createTrophy.mutateAsync({
        playerId: selectedPlayerId,
        name: getFormValue(formData, 'name').trim(),
        seasonLabel: getFormValue(formData, 'seasonLabel').trim(),
        teamLabel: parseNullableText(getFormValue(formData, 'teamLabel')) ?? undefined,
        awardedAt: new Date(getFormValue(formData, 'awardedAt')),
        description: getFormValue(formData, 'description').trim() || undefined,
      });
      form.reset();
      await refreshAdminPlayerData(selectedPlayerId);
      setFeedback({ type: 'success', message: 'Le palmares du joueur a ete enrichi.' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "L'ajout du palmares a echoue.";
      setFeedback({ type: 'error', message });
    }
  }

  async function handleUpdateTrophy(event: React.FormEvent<HTMLFormElement>, trophyId: string) {
    event.preventDefault();

    if (!selectedPlayerId) {
      return;
    }

    setFeedback(null);

    try {
      const formData = new FormData(event.currentTarget);
      await updateTrophy.mutateAsync({
        id: trophyId,
        name: getFormValue(formData, 'name').trim(),
        seasonLabel: getFormValue(formData, 'seasonLabel').trim(),
        teamLabel: parseNullableText(getFormValue(formData, 'teamLabel')) ?? undefined,
        awardedAt: new Date(getFormValue(formData, 'awardedAt')),
        description: getFormValue(formData, 'description').trim() || undefined,
      });
      await refreshAdminPlayerData(selectedPlayerId);
      setFeedback({ type: 'success', message: 'Le palmares a ete mis a jour.' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'La mise a jour du palmares a echoue.';
      setFeedback({ type: 'error', message });
    }
  }

  function handleDeleteTrophy(trophyId: string) {
    if (!selectedPlayerId) {
      return;
    }

    setConfirmState({
      title: 'Supprimer cette ligne de palmarès ?',
      description: 'Le palmarès du joueur sera mis à jour immédiatement.',
      confirmLabel: 'Supprimer',
      action: async () => {
        setFeedback(null);
        try {
          await deleteTrophy.mutateAsync({ id: trophyId });
          await refreshAdminPlayerData(selectedPlayerId);
          setFeedback({ type: 'success', message: 'La ligne de palmares a ete supprimee.' });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'La suppression du palmares a echoue.';
          setFeedback({ type: 'error', message });
        }
      },
    });
  }

  const playerMutationPending =
    createPlayer.isPending || updatePlayer.isPending || deletePlayer.isPending;

  return (
    <div className="space-y-8">
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        {...(confirmState?.description ? { description: confirmState.description } : {})}
        {...(confirmState?.confirmLabel ? { confirmLabel: confirmState.confirmLabel } : {})}
        {...(confirmState?.requireText ? { requireText: confirmState.requireText } : {})}
        destructive
        pending={confirmPending}
        onConfirm={runConfirm}
        onCancel={() => {
          if (!confirmPending) setConfirmState(null);
        }}
      />
      <FeedbackBanner feedback={feedback} />

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="space-y-5 xl:sticky xl:top-8 xl:h-fit">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label-mono">Registry</p>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
                Joueurs transfermarket
              </h2>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<UserPlus className="h-4 w-4" />}
              onClick={() => {
                setSelectedPlayerId(null);
                setDraft(createEmptyPlayerDraft());
                setFeedback(null);
              }}
            >
              Nouveau
            </Button>
          </div>

          <Input
            placeholder="Rechercher un pseudo, une team, un tag"
            value={playerSearch}
            onChange={(event) => setPlayerSearch(event.target.value)}
          />

          <div className="space-y-3">
            {registryQuery.isLoading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-4 text-sm text-foreground-dim">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement du registre joueurs...
              </div>
            ) : filteredPlayers.length > 0 ? (
              filteredPlayers.map((player) => {
                const active = player.id === selectedPlayerId;

                return (
                  <button
                    key={player.id}
                    type="button"
                    className={cn(
                      'w-full rounded-3xl border p-4 text-left transition',
                      active
                        ? 'border-accent/40 bg-accent/12 shadow-[0_0_30px_rgba(124,58,237,0.12)]'
                        : 'border-white/[0.05] bg-white/[0.035] hover:border-accent/18 hover:bg-white/7',
                    )}
                    onClick={() => {
                      setSelectedPlayerId(player.id);
                      setFeedback(null);
                    }}
                  >
                    <div className="flex items-start gap-3">
                      {player.imageUrl ? (
                        <img
                          src={player.imageUrl}
                          alt={player.displayName}
                          loading="lazy"
                          decoding="async"
                          className="h-14 w-14 rounded-2xl object-cover ring-1 ring-white/[0.06]"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8 text-sm font-semibold text-white ring-1 ring-white/[0.06]">
                          {getInitials(player.displayName)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-white">{player.displayName}</p>
                          <Badge variant={player.role}>{player.role}</Badge>
                          {!player.isActive ? <Badge variant="actif">Inactif</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm text-foreground-dim">
                          {player.teamName} • {buildPlayerRiotId(player)}
                        </p>
                        <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.06em] text-foreground-dim">
                          <span>{formatCurrency(player.marketValue)}</span>
                          <span>{player.secondaryRoles.join(' / ') || 'Mono role'}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-4 text-sm text-foreground-dim">
                Aucun joueur ne correspond a la recherche.
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="label-mono">Player editor</p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
                  {selectedPlayerId ? 'Editer un joueur' : 'Ajouter un joueur'}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-foreground-dim">
                  Garde ici la fiche principale du joueur : photo, equipe ou free agent, role
                  principal, roles secondaires, valorisation, pseudo public et Riot ID.
                </p>
              </div>
              {selectedPlayer ? (
                <div className="rounded-3xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 text-sm text-foreground-dim">
                  Derniere sync joueur :{' '}
                  <span className="font-semibold text-white">
                    {formatCurrency(selectedPlayer.marketValue)}
                  </span>
                </div>
              ) : null}
            </div>

            <form className="space-y-6" onSubmit={handlePlayerSubmit}>
              <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-[28px] border border-white/[0.05] bg-white/[0.035]">
                    {draft.imageUrl ? (
                      <img
                        src={draft.imageUrl}
                        alt={draft.displayName || draft.gameName || 'Preview'}
                        loading="lazy"
                        decoding="async"
                        className="h-[220px] w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-[220px] items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.22),_transparent_58%)] text-2xl font-display font-bold text-white">
                        {getInitials(draft.displayName || draft.gameName || 'NL')}
                      </div>
                    )}
                  </div>
                  <ImageInput
                    label="Photo"
                    folder="players"
                    value={draft.imageUrl}
                    onChange={(url) => setDraft((current) => ({ ...current, imageUrl: url }))}
                    hidePreview
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Pseudo public
                    </label>
                    <Input
                      required
                      placeholder="Ex: Bat"
                      value={draft.displayName}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, displayName: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Pseudo in game
                    </label>
                    <Input
                      required
                      placeholder="Ex: dragonnet"
                      value={draft.gameName}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, gameName: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Tag in game
                    </label>
                    <Input
                      required
                      placeholder="Ex: glide"
                      value={draft.tagLine}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, tagLine: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Team assignment
                    </label>
                    <Select
                      value={draft.teamId || 'FREE_AGENT'}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          teamId: event.target.value === 'FREE_AGENT' ? '' : event.target.value,
                        }))
                      }
                    >
                      <option value="FREE_AGENT">Free agent</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name} ({team.shortCode})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Role principal
                    </label>
                    <Select
                      value={draft.role}
                      onChange={(event) => handlePrimaryRoleChange(event.target.value as SharedPlayerRole)}
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Market value
                    </label>
                    <Input
                      type="number"
                      min={0}
                      required
                      value={draft.marketValue}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, marketValue: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Salaire
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.salary}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, salary: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Cost (1-5)
                    </label>
                    <Select
                      value={draft.cost}
                      onChange={(event) => {
                        const nextCost = event.target.value;
                        // Le changement de cost prefille la valeur marchande avec la
                        // valeur de base du palier (reste modifiable ensuite).
                        setDraft((current) => ({
                          ...current,
                          cost: nextCost,
                          marketValue: getCostBaseValue(
                            Number.parseInt(nextCost, 10),
                          ).toString(),
                        }));
                      }}
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value.toString()}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Age
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.age}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, age: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                      Nationalite
                    </label>
                    <Input
                      value={draft.nationality}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, nationality: event.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs uppercase tracking-[0.06em] text-foreground-dim">
                  Roles secondaires
                </label>
                <div className="flex flex-wrap gap-3">
                  {roleOptions.map((role) => {
                    const checked = draft.secondaryRoles.includes(role);
                    const disabled = role === draft.role;

                    return (
                      <label
                        key={role}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm transition',
                          checked
                            ? 'border-accent/40 bg-accent/12 text-white'
                            : 'border-white/[0.05] bg-white/[0.035] text-foreground-dim hover:text-white',
                          disabled && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSecondaryRole(role)}
                        />
                        <span>{role}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 text-sm text-foreground-dim">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, isActive: event.target.checked }))
                    }
                  />
                  Joueur actif dans le transfermarket
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  disabled={playerMutationPending}
                  icon={
                    playerMutationPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )
                  }
                >
                  {selectedPlayerId ? 'Mettre a jour le joueur' : 'Creer le joueur'}
                </Button>
                {selectedPlayerId ? (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={playerMutationPending}
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={handleDeletePlayer}
                  >
                    Supprimer
                  </Button>
                ) : null}
                {selectedPlayerId ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={fetchFromRiot.isPending}
                    icon={fetchFromRiot.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                    onClick={handleFetchRiot}
                  >
                    Fetch Riot
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          {selectedPlayerId ? (
            <>
              <Card className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="label-mono">Market value history</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
                      Historique de valorisation
                    </h3>
                  </div>
                  <div className="rounded-full border border-white/[0.05] bg-white/[0.035] px-4 py-2 text-xs uppercase tracking-[0.06em] text-foreground-dim">
                    {selectedPlayer?.marketValueHistory.length ?? 0} entrees
                  </div>
                </div>

                <form
                  className="grid gap-3 rounded-3xl border border-white/[0.05] bg-white/[0.035] p-4 md:grid-cols-[1fr_220px_1fr_auto]"
                  onSubmit={handleCreateHistoryEntry}
                >
                  <Input name="newValue" type="number" min={0} required placeholder="Nouvelle valeur" />
                  <Input
                    name="changedAt"
                    type="datetime-local"
                    required
                    defaultValue={toDateTimeLocalValue(new Date())}
                  />
                  <Input name="reason" placeholder="Motif (optionnel)" />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={createHistoryEntry.isPending}
                    icon={
                      createHistoryEntry.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )
                    }
                  >
                    Ajouter
                  </Button>
                </form>

                <div className="space-y-3">
                  {selectedPlayerQuery.isLoading ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-4 text-sm text-foreground-dim">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Chargement de l'historique...
                    </div>
                  ) : selectedPlayer && selectedPlayer.marketValueHistory.length > 0 ? (
                    selectedPlayer.marketValueHistory.map((entry) => (
                      <form
                        key={entry.id}
                        className="grid gap-3 rounded-3xl border border-white/[0.05] bg-white/[0.035] p-4 md:grid-cols-[1fr_220px_1fr_auto_auto]"
                        onSubmit={(event) => handleUpdateHistoryEntry(event, entry.id)}
                      >
                        <Input
                          name="newValue"
                          type="number"
                          min={0}
                          required
                          defaultValue={entry.newValue.toString()}
                        />
                        <Input
                          name="changedAt"
                          type="datetime-local"
                          required
                          defaultValue={toDateTimeLocalValue(entry.changedAt)}
                        />
                        <Input name="reason" defaultValue={entry.reason ?? ''} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          disabled={updateHistoryEntry.isPending}
                          icon={<PencilLine className="h-4 w-4" />}
                        >
                          Sauver
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={deleteHistoryEntry.isPending}
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => handleDeleteHistoryEntry(entry.id)}
                        >
                          Supprimer
                        </Button>
                        <div className="md:col-span-5 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.06em] text-foreground-dim">
                          <span>
                            {entry.changedBy?.name ? `Par ${entry.changedBy.name}` : 'Par systeme'}
                          </span>
                          <span>
                            Delta {entry.newValue >= entry.previousValue ? '+' : ''}
                            {formatCurrency(entry.newValue - entry.previousValue)}
                          </span>
                        </div>
                      </form>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-4 text-sm text-foreground-dim">
                      Aucun historique disponible pour ce joueur.
                    </div>
                  )}
                </div>
              </Card>

              <Card className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="label-mono">Palmares</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
                      Editer le palmares du joueur
                    </h3>
                  </div>
                  <div className="rounded-full border border-white/[0.05] bg-white/[0.035] px-4 py-2 text-xs uppercase tracking-[0.06em] text-foreground-dim">
                    {selectedPlayer?.playerTrophies.length ?? 0} distinctions
                  </div>
                </div>

                <form
                  className="grid gap-3 rounded-3xl border border-white/[0.05] bg-white/[0.035] p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_220px_220px_1fr_auto]"
                  onSubmit={handleCreateTrophy}
                >
                  <Input name="name" required placeholder="Ex: Spring Split MVP" />
                  <Input name="seasonLabel" required placeholder="Saison (ex: Spring Split 2026)" />
                  <Input name="teamLabel" placeholder="Équipe (vide si individuel)" />
                  <Input
                    name="awardedAt"
                    type="date"
                    required
                    defaultValue={toDateValue(new Date())}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={createTrophy.isPending}
                    icon={
                      createTrophy.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )
                    }
                  >
                    Ajouter
                  </Button>
                  <div className="md:col-span-2 xl:col-span-5">
                    <textarea
                      name="description"
                      rows={3}
                      className="w-full rounded-3xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-foreground-muted focus:border-accent/50 focus:ring-2 focus:ring-accent-primary/24"
                      placeholder="Description du trophee ou contexte"
                    />
                  </div>
                </form>

                <div className="space-y-3">
                  {selectedPlayerQuery.isLoading ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-4 text-sm text-foreground-dim">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Chargement du palmares...
                    </div>
                  ) : selectedPlayer && selectedPlayer.playerTrophies.length > 0 ? (
                    selectedPlayer.playerTrophies.map((trophy) => (
                      <form
                        key={trophy.id}
                        className="grid gap-3 rounded-3xl border border-white/[0.05] bg-white/[0.035] p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_220px_220px_1fr_auto_auto]"
                        onSubmit={(event) => handleUpdateTrophy(event, trophy.id)}
                      >
                        <Input name="name" required defaultValue={trophy.name} />
                        <Input
                          name="seasonLabel"
                          required
                          placeholder="Saison"
                          defaultValue={trophy.seasonLabel ?? trophy.season?.name ?? ''}
                        />
                        <Input
                          name="teamLabel"
                          placeholder="Équipe (vide si individuel)"
                          defaultValue={trophy.teamLabel ?? trophy.team?.name ?? ''}
                        />
                        <Input
                          name="awardedAt"
                          type="date"
                          required
                          defaultValue={toDateValue(trophy.awardedAt)}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          disabled={updateTrophy.isPending}
                          icon={<PencilLine className="h-4 w-4" />}
                        >
                          Sauver
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={deleteTrophy.isPending}
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => handleDeleteTrophy(trophy.id)}
                        >
                          Supprimer
                        </Button>
                        <div className="md:col-span-2 xl:col-span-6">
                          <textarea
                            name="description"
                            rows={3}
                            defaultValue={trophy.description ?? ''}
                            className="w-full rounded-3xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 text-sm text-white outline-none transition placeholder:text-foreground-muted focus:border-accent/50 focus:ring-2 focus:ring-accent-primary/24"
                          />
                        </div>
                        <div className="md:col-span-2 xl:col-span-6 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.06em] text-foreground-dim">
                          <span>
                            {trophy.teamLabel ??
                              (trophy.team
                                ? `${trophy.team.name} (${trophy.team.shortCode})`
                                : 'Distinction individuelle')}
                          </span>
                          <span>{formatDateTime(trophy.awardedAt)}</span>
                        </div>
                      </form>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-4 text-sm text-foreground-dim">
                      Aucun palmares enregistre pour ce joueur.
                    </div>
                  )}
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
