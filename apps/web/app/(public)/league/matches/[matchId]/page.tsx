import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { ChampionIcon } from '@/components/ui/champion-icon';
import { ItemRow } from '@/components/ui/item-icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlayerLink } from '@/components/ui/player-link';
import { TeamAvatar } from '@/components/ui/team-avatar';
import { GameStatBars } from '@/components/features/league/game-stat-bars';
import { GamePlayerBars } from '@/components/features/league/game-player-bars';
import { GameMvpCard } from '@/components/features/league/game-mvp-card';
import { SeriesMvpCard } from '@/components/features/league/series-mvp-card';
import { RatingBadge } from '@/components/features/league/rating-badge';
import { MatchBetSlip } from '@/components/features/betting/match-bet-slip';
import { cn } from '@/lib/utils/cn';
import { formatDateTime } from '@/lib/utils/format';
import { getPublicCaller } from '@/server/public/caller';

interface MatchDetailPageProps {
  params: Promise<{
    matchId: string;
  }>;
  searchParams: Promise<{
    game?: string | string[];
  }>;
}

export const revalidate = 60;

function parseSelectedGameNumber(value: string | string[] | undefined) {
  const raw = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default async function MatchDetailPage({
  params,
  searchParams,
}: MatchDetailPageProps) {
  const { matchId } = await params;
  const search = await searchParams;
  const caller = await getPublicCaller();

  let match: Awaited<ReturnType<typeof caller.match.getById>>;
  try {
    match = await caller.match.getById({ id: matchId });
  } catch {
    notFound();
  }

  const homeWon = match.homeScore > match.awayScore;
  const awayWon = match.awayScore > match.homeScore;

  // MVP du BO : joueur de l'équipe gagnante avec la meilleure moyenne de note
  // sur l'ensemble de la série.
  const winningTeamId = !match.isCompleted
    ? null
    : homeWon
      ? match.homeTeam.id
      : awayWon
        ? match.awayTeam.id
        : null;
  const winningShort =
    winningTeamId === match.homeTeam.id
      ? match.homeTeam.shortCode
      : winningTeamId === match.awayTeam.id
        ? match.awayTeam.shortCode
        : '';
  const seriesMvp = (() => {
    if (!winningTeamId) return null;
    const agg = new Map<
      string,
      {
        player: (typeof match.games)[number]['playerStats'][number]['player'];
        sum: number;
        count: number;
      }
    >();
    for (const game of match.games) {
      for (const stat of game.playerStats) {
        const statTeamId = stat.side === 'BLUE' ? game.blueTeamId : game.redTeamId;
        if (statTeamId !== winningTeamId) continue;
        if (stat.note === null || stat.note === undefined) continue;
        const cur = agg.get(stat.player.id) ?? { player: stat.player, sum: 0, count: 0 };
        cur.sum += stat.note;
        cur.count += 1;
        agg.set(stat.player.id, cur);
      }
    }
    const ranked = [...agg.values()]
      .filter((a) => a.count > 0)
      .map((a) => ({ player: a.player, avgNote: a.sum / a.count, games: a.count }))
      .sort((a, b) => b.avgNote - a.avgNote);
    return ranked[0] ?? null;
  })();

  const requestedGame = parseSelectedGameNumber(search.game);
  const selectedGame =
    match.games.find((game) => game.gameNumber === requestedGame) ??
    match.games[0] ??
    null;

  return (
    <div className="flex flex-col gap-20 md:gap-24">
      <header className="border-b border-hairline pb-10">
        <p className="breadcrumb-mono">
          §{' · '}
          <Link href="/league/matches" className="transition-colors hover:text-foreground">
            Matchs
          </Link>
          {' · '}
          {match.homeTeam.shortCode}–{match.awayTeam.shortCode}
        </p>

        <p className="mt-6 label-mono tabular-nums">
          {match.format} · {match.season.name} · {formatDateTime(match.scheduledAt)}
        </p>

        <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-end gap-6 md:gap-10">
          <div className="flex flex-col gap-4">
            <TeamAvatar
              name={match.homeTeam.name}
              shortCode={match.homeTeam.shortCode}
              logoUrl={match.homeTeam.logoUrl}
              size="lg"
              className="h-16 w-16 md:h-20 md:w-20"
            />
            <div>
              <p
                className={cn(
                  'font-display text-3xl tracking-tight md:text-4xl',
                  homeWon ? 'text-foreground' : 'text-foreground-dim',
                )}
              >
                {match.homeTeam.name}
              </p>
              <p className="mt-1 label-mono">{match.homeTeam.shortCode}</p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 px-4">
            <p className="font-display text-6xl tracking-tight tabular-nums text-foreground md:text-7xl">
              <span className={homeWon ? 'text-accent' : 'text-foreground-muted'}>
                {match.homeScore}
              </span>
              <span className="mx-3 text-foreground-muted">–</span>
              <span className={awayWon ? 'text-accent' : 'text-foreground-muted'}>
                {match.awayScore}
              </span>
            </p>
            <p className="label-mono">{match.isCompleted ? 'Final' : 'Programmé'}</p>
          </div>

          <div className="flex flex-col gap-4 items-end text-right">
            <TeamAvatar
              name={match.awayTeam.name}
              shortCode={match.awayTeam.shortCode}
              logoUrl={match.awayTeam.logoUrl}
              size="lg"
              className="h-16 w-16 md:h-20 md:w-20"
            />
            <div>
              <p
                className={cn(
                  'font-display text-3xl tracking-tight md:text-4xl',
                  awayWon ? 'text-foreground' : 'text-foreground-dim',
                )}
              >
                {match.awayTeam.name}
              </p>
              <p className="mt-1 label-mono">{match.awayTeam.shortCode}</p>
            </div>
          </div>
        </div>

        {match.notes ? (
          <p className="mt-8 max-w-2xl text-base leading-7 text-foreground-dim">{match.notes}</p>
        ) : null}

        <div className="mt-10 max-w-md">
          <MatchBetSlip matchId={match.id} />
        </div>
      </header>

      {seriesMvp ? (
        <section>
          <SeriesMvpCard
            player={{
              id: seriesMvp.player.id,
              displayName: seriesMvp.player.displayName,
              role: seriesMvp.player.role,
            }}
            avgNote={seriesMvp.avgNote}
            games={seriesMvp.games}
            teamShortCode={winningShort}
          />
        </section>
      ) : null}

      {selectedGame ? (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-mono">§ Scoreboard</p>
              <h2 className="mt-3 display-md text-foreground">
                Game {selectedGame.gameNumber} sur {match.games.length}.
              </h2>
            </div>
            <div className="flex items-center gap-4 label-mono">
              {selectedGame.durationSeconds ? (
                <span className="tabular-nums">
                  {Math.floor(selectedGame.durationSeconds / 60)}m{' '}
                  {selectedGame.durationSeconds % 60}s
                </span>
              ) : null}
              {selectedGame.winnerTeamId ? (
                <span className="border border-hairline border-l-2 border-l-accent px-3 py-1 text-foreground">
                  Win ·{' '}
                  {selectedGame.winnerTeamId === match.homeTeam.id
                    ? match.homeTeam.shortCode
                    : match.awayTeam.shortCode}
                </span>
              ) : null}
            </div>
          </div>

          {match.games.length > 1 ? (
            <nav
              aria-label="Sélecteur de game"
              className="mt-6 flex flex-wrap items-center gap-px border-y border-hairline bg-hairline"
            >
              {match.games.map((game) => {
                const isActive = game.gameNumber === selectedGame.gameNumber;
                const gameWinnerShort =
                  game.winnerTeamId === match.homeTeam.id
                    ? match.homeTeam.shortCode
                    : game.winnerTeamId === match.awayTeam.id
                      ? match.awayTeam.shortCode
                      : null;
                return (
                  <Link
                    key={game.id}
                    href={`?game=${game.gameNumber}`}
                    scroll={false}
                    className={cn(
                      'flex min-w-[8rem] flex-col gap-1 bg-background px-4 py-3 transition',
                      isActive
                        ? 'border-l-2 border-l-accent text-foreground'
                        : 'text-foreground-dim hover:text-foreground',
                    )}
                  >
                    <span className="label-mono">Game {game.gameNumber}</span>
                    <span className="font-display text-foreground tabular-nums">
                      {gameWinnerShort ?? '—'}
                    </span>
                  </Link>
                );
              })}
            </nav>
          ) : null}

          <div className="mt-8 flex flex-col gap-8">
            {selectedGame.playerStats.length > 0 ? (
              (['BLUE', 'RED'] as const).map((side) => {
                const sideStats = selectedGame.playerStats.filter((s) => s.side === side);
                if (sideStats.length === 0) return null;
                const sideTeamId =
                  side === 'BLUE' ? selectedGame.blueTeamId : selectedGame.redTeamId;
                const sideTeamName =
                  sideTeamId === match.homeTeam.id
                    ? match.homeTeam.shortCode
                    : match.awayTeam.shortCode;
                const sideWon = sideTeamId === selectedGame.winnerTeamId;
                return (
                  <div key={side}>
                    <div
                      className={cn(
                        'flex items-center justify-between gap-4 border-l-2 pl-4 py-1',
                        sideWon ? 'border-l-accent' : 'border-l-hairline',
                      )}
                    >
                      <p className="label-mono tabular-nums">
                        {side} side · {sideTeamName}
                      </p>
                      {sideWon ? (
                        <span className="label-mono text-accent">Victoire</span>
                      ) : (
                        <span className="label-mono text-foreground-muted">Défaite</span>
                      )}
                    </div>
                    <div className="mt-4 overflow-x-auto border-t border-hairline">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Joueur</TableHead>
                            <TableHead>Champion</TableHead>
                            <TableHead>Items</TableHead>
                            <TableHead>K / D / A</TableHead>
                            <TableHead>CS</TableHead>
                            <TableHead>Gold</TableHead>
                            <TableHead>Damage</TableHead>
                            <TableHead>Vision</TableHead>
                            <TableHead>Note</TableHead>
                            <TableHead>Résultat</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sideStats.map((stat) => (
                            <TableRow key={stat.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <PlayerLink
                                    playerId={stat.player.id}
                                    className="font-display text-foreground"
                                  >
                                    {stat.player.displayName}
                                  </PlayerLink>
                                  <Badge variant={stat.player.role}>{stat.player.role}</Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="flex items-center gap-2">
                                  <ChampionIcon championId={stat.champion} size="sm" />
                                  {stat.champion}
                                </span>
                              </TableCell>
                              <TableCell>
                                <ItemRow items={stat.items} size="sm" />
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {stat.kills} / {stat.deaths} / {stat.assists}
                              </TableCell>
                              <TableCell className="tabular-nums">{stat.cs}</TableCell>
                              <TableCell className="tabular-nums">
                                {stat.gold.toLocaleString('fr-FR')}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {stat.damage.toLocaleString('fr-FR')}
                              </TableCell>
                              <TableCell className="tabular-nums">{stat.visionScore}</TableCell>
                              <TableCell>
                                <RatingBadge note={stat.note} />
                              </TableCell>
                              <TableCell>
                                <span
                                  className={cn(
                                    'label-mono',
                                    stat.result === 'WIN'
                                      ? 'text-[color:var(--win)]'
                                      : 'text-[color:var(--loss)]',
                                  )}
                                >
                                  {stat.result}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-foreground-dim">
                Aucune statistique joueur pour cette game.
              </p>
            )}
          </div>

          {selectedGame.playerStats.length > 0 ? (
            <div className="mt-12 flex flex-col gap-10">
              <GameMvpCard playerStats={selectedGame.playerStats} />
              <GameStatBars
                playerStats={selectedGame.playerStats}
                blueTeamShortCode={
                  selectedGame.blueTeamId === match.homeTeam.id
                    ? match.homeTeam.shortCode
                    : match.awayTeam.shortCode
                }
                redTeamShortCode={
                  selectedGame.redTeamId === match.homeTeam.id
                    ? match.homeTeam.shortCode
                    : match.awayTeam.shortCode
                }
                winningSide={
                  selectedGame.winnerTeamId === selectedGame.blueTeamId
                    ? 'BLUE'
                    : selectedGame.winnerTeamId === selectedGame.redTeamId
                      ? 'RED'
                      : null
                }
              />
              <GamePlayerBars
                playerStats={selectedGame.playerStats}
                metric="damage"
                title="Dégâts par joueur"
                helper="Bleu vs Rouge"
              />
              <GamePlayerBars
                playerStats={selectedGame.playerStats}
                metric="gold"
                title="Gold par joueur"
                helper="Bleu vs Rouge"
              />
            </div>
          ) : null}
        </section>
      ) : (
        <section className="border-y border-hairline py-12">
          <p className="label-mono">Aucune game</p>
          <h2 className="mt-3 display-md text-foreground">Pas de détail enregistré.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground-dim">
            Les game logs apparaîtront ici dès que les stats seront importées via la Riot API.
          </p>
        </section>
      )}
    </div>
  );
}
