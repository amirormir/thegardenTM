import { Users } from 'lucide-react';
import type { PlayerRole } from '@nexus/db';
import { Badge } from '@/components/ui/badge';
import { PlayerLink } from '@/components/ui/player-link';
import { TeamAvatar } from '@/components/ui/team-avatar';
import { cn } from '@/lib/utils/cn';
import { formatCurrency } from '@/lib/utils/format';
import { getPlayerInitials } from '@/lib/utils/player-display';

const ROLE_ORDER: PlayerRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

interface RosterPlayer {
  id: string;
  displayName: string;
  role: PlayerRole;
  imageUrl: string | null;
  marketValue: number;
}

interface RosterTeam {
  id: string;
  name: string;
  shortCode: string;
  logoUrl: string | null;
  players: RosterPlayer[];
}

interface MatchRostersProps {
  homeTeam: RosterTeam;
  awayTeam: RosterTeam;
}

function sortRoster(players: RosterPlayer[]) {
  return [...players].sort((left, right) => {
    const leftIndex = ROLE_ORDER.indexOf(left.role);
    const rightIndex = ROLE_ORDER.indexOf(right.role);
    if (leftIndex !== rightIndex) {
      return (leftIndex === -1 ? ROLE_ORDER.length : leftIndex) -
        (rightIndex === -1 ? ROLE_ORDER.length : rightIndex);
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

function RosterColumn({ team }: { team: RosterTeam }) {
  const players = sortRoster(team.players);

  return (
    <div className="flex flex-col bg-surface">
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
        <TeamAvatar
          name={team.name}
          shortCode={team.shortCode}
          logoUrl={team.logoUrl}
          size="sm"
        />
        <div className="min-w-0">
          <p className="truncate font-display text-sm text-foreground">{team.name}</p>
          <p className="label-mono">{team.shortCode}</p>
        </div>
      </div>

      {players.length > 0 ? (
        <ul className="flex flex-col">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-3 border-b border-hairline px-5 py-3 last:border-b-0"
            >
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-background">
                {player.imageUrl ? (
                  <img
                    src={player.imageUrl}
                    alt={player.displayName}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-display text-xs text-foreground-dim">
                    {getPlayerInitials(player.displayName)}
                  </span>
                )}
              </span>

              <div className="min-w-0 flex-1">
                <PlayerLink
                  playerId={player.id}
                  className="block truncate text-sm text-foreground"
                >
                  {player.displayName}
                </PlayerLink>
                <span className="font-mono tabular-nums text-xs text-foreground-muted">
                  {formatCurrency(player.marketValue)}
                </span>
              </div>

              <Badge variant={player.role}>{player.role}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-foreground-dim">Roster non renseigné.</p>
      )}
    </div>
  );
}

export function MatchRosters({ homeTeam, awayTeam }: MatchRostersProps) {
  const hasAnyPlayer = homeTeam.players.length > 0 || awayTeam.players.length > 0;
  if (!hasAnyPlayer) return null;

  return (
    <section className="border border-hairline bg-surface">
      <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <p className="label-mono inline-flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-accent" /> Rosters
        </p>
      </header>

      <div className={cn('grid gap-px bg-hairline', 'sm:grid-cols-2')}>
        <RosterColumn team={homeTeam} />
        <RosterColumn team={awayTeam} />
      </div>
    </section>
  );
}
