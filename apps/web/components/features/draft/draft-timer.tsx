'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

interface DraftTimerProps {
  /** Unix ms deadline (server clock). Null = no active timer. */
  deadline: number | null;
  /** Estimated (serverClock − clientClock) in ms. Corrects skewed local clocks. */
  offset?: number;
  /** Total step duration (ms), used to draw the bar. */
  totalMs?: number;
  className?: string;
}

export function DraftTimer({ deadline, offset = 0, totalMs = 30_000, className }: DraftTimerProps) {
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now() + offset), 100);
    return () => window.clearInterval(id);
  }, [deadline, offset]);

  if (!deadline) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <p className="label-mono text-foreground-muted">Timer</p>
        <p className="font-display text-3xl text-foreground-muted tabular-nums">—</p>
      </div>
    );
  }

  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const pct = Math.min(1, remaining / totalMs);
  const isCritical = remaining < 5_000;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="label-mono text-foreground-muted">Temps restant</p>
      <p
        className={cn(
          'font-display text-4xl tabular-nums',
          isCritical ? 'text-[color:var(--loss)]' : 'text-foreground',
        )}
      >
        {seconds}s
      </p>
      <div className="h-1 w-full bg-surface-hover">
        <div
          className={cn(
            'h-full transition-[width] duration-100 ease-linear',
            isCritical ? 'bg-[color:var(--loss)]' : 'bg-accent',
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
