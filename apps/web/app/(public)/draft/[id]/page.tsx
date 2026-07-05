import { TRPCError } from '@trpc/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { DraftRoomLive } from '@/components/features/draft/draft-room-live';
import { TeamAvatar } from '@/components/ui/team-avatar';
import { getServerCaller } from '@/server/caller';
import { formatDateTime } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: 'En cours',
  COINFLIP: 'Coin flip',
  PAUSED: 'En pause',
  LOBBY: 'Lobby',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

export default async function DraftRoomPage({ params }: PageProps) {
  const { id } = await params;
  const caller = await getServerCaller();

  let draft;
  try {
    draft = await caller.draft.byId({ id });
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-12 md:gap-16">
      <div>
        <Link
          href="/draft"
          className="inline-flex items-center gap-2 label-mono text-foreground-muted transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour aux drafts
        </Link>
      </div>

      <header className="border-b border-hairline pb-8">
        <p className="breadcrumb-mono">§ · Draft · {draft.season.name}</p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <TeamAvatar
                name={draft.blueTeam.name}
                shortCode={draft.blueTeam.shortCode}
                logoUrl={draft.blueTeam.logoUrl}
                size="lg"
              />
              <div>
                <p className="label-mono text-[color:var(--accent)]">Blue side</p>
                <p className="font-display text-2xl text-foreground">{draft.blueTeam.name}</p>
              </div>
            </div>
            <span className="font-display text-3xl text-foreground-muted">vs</span>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="label-mono text-[color:var(--loss)]">Red side</p>
                <p className="font-display text-2xl text-foreground">{draft.redTeam.name}</p>
              </div>
              <TeamAvatar
                name={draft.redTeam.name}
                shortCode={draft.redTeam.shortCode}
                logoUrl={draft.redTeam.logoUrl}
                size="lg"
              />
            </div>
          </div>

          <div className="text-right">
            <p className="label-mono text-foreground-muted">Statut</p>
            <p className="mt-1 font-display text-xl text-foreground">
              {STATUS_LABEL[draft.status] ?? draft.status}
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Format" value={draft.format} />
        <Stat label="Game" value={`G${draft.gameNumber}`} />
        <Stat label="Patch" value={draft.patchVersion} />
        <Stat label="Fearless" value={draft.fearless ? 'Activé' : 'Désactivé'} />
      </section>

      <DraftRoomLive
        draftId={draft.id}
        blueTeam={{
          id: draft.blueTeam.id,
          name: draft.blueTeam.name,
          shortCode: draft.blueTeam.shortCode,
          logoUrl: draft.blueTeam.logoUrl,
          players: draft.blueTeam.players.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            role: p.role,
            teamRole: p.teamRole,
          })),
        }}
        redTeam={{
          id: draft.redTeam.id,
          name: draft.redTeam.name,
          shortCode: draft.redTeam.shortCode,
          logoUrl: draft.redTeam.logoUrl,
          players: draft.redTeam.players.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            role: p.role,
            teamRole: p.teamRole,
          })),
        }}
        siblings={draft.match.drafts.map((sibling) => ({
          id: sibling.id,
          gameNumber: sibling.gameNumber,
          status: sibling.status,
          winnerSide: sibling.winnerSide,
          winnerTeamId: sibling.winnerTeamId,
          blueTeam: {
            id: sibling.blueTeam.id,
            name: sibling.blueTeam.name,
            shortCode: sibling.blueTeam.shortCode,
            logoUrl: sibling.blueTeam.logoUrl,
            players: sibling.blueTeam.players.map((p) => ({
              id: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              role: p.role,
              teamRole: p.teamRole,
            })),
          },
          redTeam: {
            id: sibling.redTeam.id,
            name: sibling.redTeam.name,
            shortCode: sibling.redTeam.shortCode,
            logoUrl: sibling.redTeam.logoUrl,
            players: sibling.redTeam.players.map((p) => ({
              id: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              role: p.role,
              teamRole: p.teamRole,
            })),
          },
        }))}
        initialResultState={{
          blueResultVote: draft.blueResultVote,
          redResultVote: draft.redResultVote,
          winnerSide: draft.winnerSide,
          winnerTeamId: draft.winnerTeamId,
          resultLockedAt: draft.resultLockedAt ? draft.resultLockedAt.getTime() : null,
        }}
        initialCoinflipState={
          draft.coinflipWinnerTeamId
            ? {
                winnerTeamId: draft.coinflipWinnerTeamId,
                loserTeamId:
                  draft.coinflipWinnerTeamId === draft.blueTeam.id
                    ? draft.redTeam.id
                    : draft.blueTeam.id,
                blueTeamId: draft.blueTeam.id,
                redTeamId: draft.redTeam.id,
                decision: draft.coinflipDecision,
                loserDecision: draft.coinflipLoserDecision,
                firstPickSide: draft.firstPickSide,
                resolvedAt: draft.coinflipResolvedAt
                  ? draft.coinflipResolvedAt.getTime()
                  : null,
              }
            : null
        }
      />

      <section className="border border-hairline bg-surface px-6 py-6">
        <p className="label-mono">§ Métadonnées</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="border-t border-hairline pt-3">
            <dt className="label-mono text-foreground-muted">Créé le</dt>
            <dd className="mt-1 text-sm text-foreground tabular-nums">
              {formatDateTime(draft.createdAt)}
            </dd>
          </div>
          {draft.startedAt ? (
            <div className="border-t border-hairline pt-3">
              <dt className="label-mono text-foreground-muted">Démarré le</dt>
              <dd className="mt-1 text-sm text-foreground tabular-nums">
                {formatDateTime(draft.startedAt)}
              </dd>
            </div>
          ) : null}
          {draft.completedAt ? (
            <div className="border-t border-hairline pt-3">
              <dt className="label-mono text-foreground-muted">Terminé le</dt>
              <dd className="mt-1 text-sm text-foreground tabular-nums">
                {formatDateTime(draft.completedAt)}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-hairline bg-surface px-5 py-5">
      <p className="label-mono text-foreground-muted">{label}</p>
      <p className="mt-2 font-display text-2xl text-foreground tabular-nums">{value}</p>
    </div>
  );
}
