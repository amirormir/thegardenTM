import { Badge } from '@/components/ui/badge';
import { PlayerLink } from '@/components/ui/player-link';
import { RatingBadge } from './rating-badge';

export interface SeriesMvpCardProps {
  player: {
    id: string;
    displayName: string;
    role: 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT';
  };
  /** Moyenne des notes /100 du joueur sur l'ensemble du BO. */
  avgNote: number;
  /** Nombre de games notées prises en compte. */
  games: number;
  /** Équipe gagnante (short code). */
  teamShortCode: string;
}

/** MVP de la série (BO) : meilleur joueur de l'équipe gagnante à la moyenne de note. */
export function SeriesMvpCard({ player, avgNote, games, teamShortCode }: SeriesMvpCardProps) {
  return (
    <aside className="flex flex-wrap items-center gap-5 border border-hairline border-l-2 border-l-[color:var(--accent-gold)] bg-background px-5 py-4">
      <div className="flex flex-col gap-1">
        <p className="label-mono text-[color:var(--accent-gold)]">§ MVP du BO · {teamShortCode}</p>
        <div className="flex items-center gap-2">
          <PlayerLink playerId={player.id} className="font-display text-xl text-foreground">
            {player.displayName}
          </PlayerLink>
          <Badge variant={player.role}>{player.role}</Badge>
        </div>
        <p className="text-sm text-foreground-dim tabular-nums">
          Meilleure moyenne sur {games} game{games > 1 ? 's' : ''} de la série.
        </p>
      </div>
      <div className="ml-auto flex flex-col items-end gap-1">
        <RatingBadge note={avgNote} size="lg" />
        <p className="label-mono text-foreground-muted">§ Moyenne BO</p>
      </div>
    </aside>
  );
}
