import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketValueChart } from '@/components/features/charts/market-value-chart';
import { ChampionPoolGrid } from '@/components/features/transfermarket/champion-pool-grid';
import { PlayerPublicActions } from '@/components/features/transfermarket/player-public-actions';
import { TeamLeagueSnapshotCard } from '@/components/features/transfermarket/team-league-snapshot-card';
import { Badge } from '@/components/ui/badge';
import { PlayerValue } from '@/components/ui/player-value';
import { TeamInline } from '@/components/ui/team-inline';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { getOptimizedRemoteImageUrl } from '@/lib/utils/optimized-image';
import { buildPlayerRiotId, getPlayerInitials } from '@/lib/utils/player-display';
import { formatCompactDate, formatCurrency, formatDateTime } from '@/lib/utils/format';
import { getPublicCaller } from '@/server/public/caller';

export const revalidate = 60;

interface PlayerDetailPageProps {
  params: Promise<{
    playerId: string;
  }>;
}

function isNotFoundError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'NOT_FOUND'
  );
}

function getContractStatusLabel(status: string) {
  if (status === 'ACTIVE') return 'Actif';
  if (status === 'EXPIRED') return 'Expire';
  if (status === 'TERMINATED') return 'Rompu';
  if (status === 'LOAN') return 'Pret';
  return status;
}

function KpiBlock({
  helper,
  label,
  value,
}: {
  helper: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border-t border-hairline pt-5">
      <p className="label-mono">{label}</p>
      <div className="mt-3 display-md text-foreground tabular-nums">{value}</div>
      <div className="mt-2 text-sm leading-6 text-foreground-dim">{helper}</div>
    </div>
  );
}

function SidebarFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-hairline py-3 first:border-t-0 first:pt-0">
      <span className="label-mono">{label}</span>
      <span className="text-right font-display text-lg tracking-tight tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

export default async function PlayerDetailPage({ params }: PlayerDetailPageProps) {
  const { playerId } = await params;
  const caller = await getPublicCaller();

  const [player, contractHistory, standings, playerStats] = await Promise.all([
    caller.player.getById({ id: playerId }).catch((error: unknown) => {
      if (isNotFoundError(error)) {
        notFound();
      }

      throw error;
    }),
    caller.contract.getByPlayer({ playerId }),
    caller.league.getStandings(),
    caller.stats.getPlayerStats({ playerId }),
  ]);

  if (!player) {
    notFound();
  }

  const activeContract = player.contracts[0] ?? null;
  const marketDelta =
    player.marketValueHistory[0]?.newValue !== undefined
      ? player.marketValueHistory[0].newValue - player.marketValueHistory[0].previousValue
      : 0;
  const teamName = player.team?.name ?? 'Free Agent';
  const teamShortCode = player.team?.shortCode ?? 'FA';
  const teamStanding = player.teamId ? standings.find((team) => team.id === player.teamId) : null;
  const teamStandingPlace = teamStanding
    ? standings.findIndex((team) => team.id === teamStanding.id) + 1
    : null;
  const recentStats = player.playerMatchStats;
  const recentTotals = recentStats.reduce(
    (accumulator, stat) => ({
      kills: accumulator.kills + stat.kills,
      deaths: accumulator.deaths + stat.deaths,
      assists: accumulator.assists + stat.assists,
      cs: accumulator.cs + stat.cs,
      damage: accumulator.damage + stat.damage,
      wins: accumulator.wins + (stat.result === 'WIN' ? 1 : 0),
    }),
    {
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
      damage: 0,
      wins: 0,
    },
  );
  const recentGamesCount = recentStats.length;
  const recentWinRate =
    recentGamesCount > 0 ? Math.round((recentTotals.wins / recentGamesCount) * 100) : 0;
  const recentKda =
    recentGamesCount > 0
      ? ((recentTotals.kills + recentTotals.assists) / Math.max(recentTotals.deaths, 1)).toFixed(2)
      : '0.00';
  const averageCs = recentGamesCount > 0 ? Math.round(recentTotals.cs / recentGamesCount) : 0;
  const averageDamage = recentGamesCount > 0 ? Math.round(recentTotals.damage / recentGamesCount) : 0;
  const championPool = playerStats.championPool;
  const championPoolCount = championPool.length;
  const riotId = buildPlayerRiotId(player);

  return (
    <div className="flex flex-col gap-16 md:gap-20">
      <header className="border-b border-hairline pb-10">
        <p className="breadcrumb-mono">
          §{' · '}
          <Link href="/transfermarket" className="transition-colors hover:text-foreground">
            Joueurs
          </Link>
          {' · '}
          {teamShortCode}
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-10">
          <div className="placeholder-diag relative aspect-[4/5] w-full max-w-[15rem] shrink-0 overflow-hidden border border-hairline bg-surface lg:max-w-[17rem]">
            {player.imageUrl ? (
              <Image
                src={getOptimizedRemoteImageUrl(player.imageUrl, { width: 720 }) ?? player.imageUrl}
                alt={player.displayName}
                fill
                priority
                sizes="(min-width: 1024px) 17rem, 15rem"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-display text-4xl text-foreground-dim">
                {getPlayerInitials(player.displayName)}
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background via-background/55 to-transparent" />
            <div className="pointer-events-none absolute bottom-4 left-4">
              <span className="font-display text-4xl tracking-tight text-foreground md:text-5xl">
                {teamShortCode}
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={player.role}>{player.role}</Badge>
              {player.secondaryRoles.map((secondaryRole) => (
                <Badge key={secondaryRole} variant={secondaryRole}>
                  {secondaryRole}
                </Badge>
              ))}
              <Badge variant={player.isActive ? 'actif' : 'expiré'}>
                {player.isActive ? 'actif' : 'inactif'}
              </Badge>
            </div>

            <h1 className="mt-4 display-xl text-foreground">{player.displayName}</h1>

            <div className="mt-5 flex flex-wrap items-center gap-2 label-mono text-foreground-dim">
              <TeamInline
                name={teamName}
                shortCode={teamShortCode}
                logoUrl={player.team?.logoUrl ?? null}
                size="xs"
                text={`${teamName} · ${teamShortCode}`}
                textClassName="text-foreground-dim"
              />
              <span>·</span>
              <span>{riotId}</span>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-5 label-mono">
              <Link
                href={`/transfermarket/comparison?playerA=${player.id}`}
                className="text-foreground-dim transition-colors duration-150 hover:text-accent"
              >
                Comparer ce joueur â†’
              </Link>
            </div>

            <PlayerPublicActions
              playerId={player.id}
              playerTeamId={player.teamId}
              hasActiveContract={Boolean(activeContract)}
            />
          </div>
        </div>
      </header>

      <div className="grid gap-16 md:gap-20 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-x-12 lg:gap-y-16">
        <section className="lg:col-start-1 grid gap-8 sm:grid-cols-2 xl:grid-cols-4 xl:gap-10">
          <KpiBlock
            label="KDA récent"
            value={recentKda}
            helper={`${recentGamesCount} game${recentGamesCount > 1 ? 's' : ''} prises en compte.`}
          />
          <KpiBlock
            label="Win rate"
            value={`${recentWinRate}%`}
            helper={`${recentTotals.wins} victoire${recentTotals.wins > 1 ? 's' : ''} récente${recentTotals.wins > 1 ? 's' : ''}.`}
          />
          <KpiBlock label="CS moyen" value={averageCs} helper="Moyenne sur les games stockées." />
          <KpiBlock
            label="Damage moyen"
            value={formatCurrency(averageDamage)}
            helper="Dégâts moyens par game récente."
          />
        </section>

        <aside className="space-y-5 border-t border-hairline pt-8 lg:col-start-2 lg:row-start-1 lg:row-span-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <PlayerValue value={player.marketValue} delta={marketDelta} />

          <div className="border border-hairline bg-surface p-5">
            <p className="label-mono">Contrat actif</p>
            <div className="mt-4 space-y-0">
              <SidebarFact
                label="Statut"
                value={activeContract ? getContractStatusLabel(activeContract.status) : 'Aucun'}
              />
              <SidebarFact
                label="Clause"
                value={
                  activeContract?.releaseClause
                    ? formatCurrency(activeContract.releaseClause)
                    : 'N/A'
                }
              />
              <SidebarFact
                label="Indemnité"
                value={activeContract?.transferFee ? formatCurrency(activeContract.transferFee) : 'N/A'}
              />
              <SidebarFact label="Salaire" value={formatCurrency(player.salary)} />
              <SidebarFact
                label="Durée"
                value={activeContract ? `${activeContract.durationBo3} BO3` : 'N/A'}
              />
              <SidebarFact
                label="Profil"
                value={
                  [player.nationality, player.age ? `${player.age} ans` : null]
                    .filter(Boolean)
                    .join(' / ') || '—'
                }
              />
            </div>
          </div>

          {player.team && teamStanding && teamStandingPlace ? (
            <TeamLeagueSnapshotCard
              team={player.team}
              place={teamStandingPlace}
              points={teamStanding.points}
              wins={teamStanding.wins}
              losses={teamStanding.losses}
              mapWins={teamStanding.mapWins}
              mapLosses={teamStanding.mapLosses}
            />
          ) : null}
        </aside>

        <section>
          <p className="label-mono">§ 01 · Trajectoire de valeur</p>
          <h2 className="mt-3 display-md text-foreground">Évolution de la cote.</h2>
          <div className="mt-6 border-t border-hairline pt-6">
            <MarketValueChart history={player.marketValueHistory} />
          </div>
        </section>

        <section>
          <p className="label-mono">§ 02 · Pool de champions</p>
          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-baseline lg:justify-between">
            <h2 className="display-md text-foreground">Pool de champions.</h2>
            <p className="label-mono text-foreground-muted">
              {championPoolCount.toString().padStart(2, '0')} champion
              {championPoolCount > 1 ? 's' : ''} joué{championPoolCount > 1 ? 's' : ''} ·{' '}
              {playerStats.summary.games} game{playerStats.summary.games > 1 ? 's' : ''} stockée
              {playerStats.summary.games > 1 ? 's' : ''}
            </p>
          </div>
          <div className="mt-6">
            <ChampionPoolGrid champions={championPool} />
          </div>
        </section>
      </div>

      {player.playerTrophies.length > 0 ? (
        <section>
          <p className="label-mono">§ 03 · Palmarès</p>
          <h2 className="mt-3 display-md text-foreground">Distinctions du joueur.</h2>
          <div className="mt-6 grid gap-px border-t border-hairline bg-hairline md:grid-cols-2 xl:grid-cols-3">
            {player.playerTrophies.map((trophy) => {
              const seasonName = trophy.seasonLabel ?? trophy.season?.name ?? '—';
              const teamName = trophy.teamLabel ?? trophy.team?.name ?? null;
              return (
                <article key={trophy.id} className="flex flex-col bg-background px-5 py-5 md:px-6">
                  <p className="label-mono">{seasonName}</p>
                  <h3 className="mt-3 font-display text-2xl tracking-tight text-foreground">
                    {trophy.name}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-foreground-dim">
                    {trophy.description ?? 'Distinction officielle enregistrée dans Garden.'}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6 label-mono">
                    {trophy.team ? (
                      <TeamInline
                        name={trophy.team.name}
                        shortCode={trophy.team.shortCode}
                        logoUrl={trophy.team.logoUrl ?? null}
                        size="xs"
                        text={trophy.team.shortCode}
                        textClassName="label-mono"
                      />
                    ) : teamName ? (
                      <span>{teamName}</span>
                    ) : (
                      <span>Individuel</span>
                    )}
                    <span className="tabular-nums">{formatCompactDate(trophy.awardedAt)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <p className="label-mono">§ 04 · Historique contractuel</p>
        <h2 className="mt-3 display-md text-foreground">
          {contractHistory.length.toString().padStart(2, '0')} contrat
          {contractHistory.length > 1 ? 's' : ''} consigné{contractHistory.length > 1 ? 's' : ''}.
        </h2>
        <div className="mt-6 border-t border-hairline pt-6">
          {contractHistory.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Équipe</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Salaire</TableHead>
                  <TableHead>Durée</TableHead>
                  <TableHead>Clause</TableHead>
                  <TableHead>Frais</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractHistory.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-display text-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{contract.team.name}</span>
                        <TeamInline
                          name={contract.team.name}
                          shortCode={contract.team.shortCode}
                          logoUrl={contract.team.logoUrl ?? null}
                          size="xs"
                          text={contract.team.shortCode}
                          textClassName="label-mono"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          contract.status === 'ACTIVE' || contract.status === 'LOAN'
                            ? 'actif'
                            : 'expiré'
                        }
                      >
                        {getContractStatusLabel(contract.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatCurrency(contract.salary)}</TableCell>
                    <TableCell className="tabular-nums">{contract.durationBo3} BO3</TableCell>
                    <TableCell className="tabular-nums">
                      {formatCurrency(contract.releaseClause)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {contract.transferFee ? formatCurrency(contract.transferFee) : 'N/A'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm leading-7 text-foreground-dim">
              Aucun historique contractuel n&apos;est disponible pour ce joueur.
            </p>
          )}
        </div>
      </section>

      <section>
        <p className="label-mono">§ 05 · Dernières stats</p>
        <h2 className="mt-3 display-md text-foreground">
          {player.playerMatchStats.length.toString().padStart(2, '0')} game
          {player.playerMatchStats.length > 1 ? 's' : ''} stockée
          {player.playerMatchStats.length > 1 ? 's' : ''}.
        </h2>
        <div className="mt-6 border-t border-hairline pt-6">
          {player.playerMatchStats.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Match</TableHead>
                  <TableHead>Champion</TableHead>
                  <TableHead>K / D / A</TableHead>
                  <TableHead>CS</TableHead>
                  <TableHead>Gold</TableHead>
                  <TableHead>Damage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {player.playerMatchStats.map((stat) => (
                  <TableRow key={stat.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2 font-display text-foreground">
                        <TeamInline
                          name={stat.matchGame.match.homeTeam.name}
                          shortCode={stat.matchGame.match.homeTeam.shortCode}
                          logoUrl={stat.matchGame.match.homeTeam.logoUrl ?? null}
                          size="xs"
                          text={stat.matchGame.match.homeTeam.shortCode}
                          textClassName="label-mono text-foreground"
                        />
                        <span className="text-foreground-muted">·</span>
                        <TeamInline
                          name={stat.matchGame.match.awayTeam.name}
                          shortCode={stat.matchGame.match.awayTeam.shortCode}
                          logoUrl={stat.matchGame.match.awayTeam.logoUrl ?? null}
                          size="xs"
                          text={stat.matchGame.match.awayTeam.shortCode}
                          textClassName="label-mono text-foreground"
                        />
                      </div>
                      <div className="mt-1 label-mono tabular-nums">
                        Game {stat.matchGame.gameNumber} ·{' '}
                        {formatCompactDate(
                          stat.matchGame.playedAt ?? stat.matchGame.match.scheduledAt,
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{stat.champion}</TableCell>
                    <TableCell className="tabular-nums">
                      {stat.kills} / {stat.deaths} / {stat.assists}
                    </TableCell>
                    <TableCell className="tabular-nums">{stat.cs.toLocaleString('fr-FR')}</TableCell>
                    <TableCell className="tabular-nums">
                      {stat.gold.toLocaleString('fr-FR')}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {stat.damage.toLocaleString('fr-FR')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm leading-7 text-foreground-dim">
              Aucune statistique locale n&apos;est encore stockée pour ce joueur.
            </p>
          )}
        </div>
      </section>

      <section>
        <p className="label-mono">§ 06 · Historique de valorisation</p>
        <h2 className="mt-3 display-md text-foreground">
          {player.marketValueHistory.length.toString().padStart(2, '0')} entrée
          {player.marketValueHistory.length > 1 ? 's' : ''} consignée
          {player.marketValueHistory.length > 1 ? 's' : ''}.
        </h2>
        <div className="mt-6 border-t border-hairline pt-6">
          {player.marketValueHistory.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Valeur</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead>Par</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {player.marketValueHistory.map((entry) => {
                  const delta = entry.newValue - entry.previousValue;
                  const positive = delta >= 0;

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="tabular-nums">{formatDateTime(entry.changedAt)}</TableCell>
                      <TableCell className="font-display tabular-nums text-foreground">
                        {formatCurrency(entry.newValue)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'tabular-nums',
                          positive ? 'text-[color:var(--win)]' : 'text-[color:var(--loss)]',
                        )}
                      >
                        {positive ? '+' : ''}
                        {formatCurrency(delta)}
                      </TableCell>
                      <TableCell>{entry.reason ?? 'Ajustement manuel'}</TableCell>
                      <TableCell>{entry.changedBy?.name ?? 'System'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm leading-7 text-foreground-dim">
              Aucun historique de valorisation n&apos;est encore disponible pour ce joueur.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
