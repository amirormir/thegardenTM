/**
 * PARTIE 2 — Moteur d'évolution de valeur.
 *
 * Port fidèle de l'implémentation de référence Python (§5.4). Chaque note de
 * game est un événement `update(note)` qui déplace la valeur via :
 *   1. ANCRE (mean-reversion) vers target(baseline)
 *   2. SURPRISE (momentum) proportionnelle à (note - baseline), gain asymétrique
 *   3. Amortisseur de régularité (volatilité faible -> bouge moins)
 *   4. Garde-fou : une surprise nette force toujours un petit mouvement du bon signe
 *
 * La valeur reste toujours bornée [FLOOR, CEIL].
 */

import {
  ALPHA_BASELINE,
  ALPHA_VOL,
  ASYM,
  CEIL,
  DAMP,
  FLOOR,
  GUARD_EPS,
  MIN_MOVE_SCALE,
  MOVE_SPAN,
  SEED_BASELINE,
  SEED_VOL,
  SPAN,
  TARGET_GAMMA,
  VOL_REF,
  W_ANCHOR,
  W_KICK,
} from './config';
import { clamp } from './math';

export interface ValueEngineState {
  value: number;
  baseline: number;
  volatility: number;
}

export interface ValueUpdateResult {
  value: number;
  delta: number;
  baseline: number;
  volatility: number;
}

export interface ValueEngineOptions {
  alphaBaseline?: number;
  alphaVol?: number;
  wAnchor?: number;
  wKick?: number;
  asym?: number;
  volRef?: number;
  damp?: number;
  guardEps?: number;
  minMoveScale?: number;
}

/**
 * Valeur cible (mean-reversion) pour une note-moyenne (baseline 0..100).
 * Mapping CONVEXE (`TARGET_GAMMA`) : la moyenne reste modérée et seuls les
 * joueurs d'élite s'approchent du plafond. target(50) ≈ 32,5M, target(100) = CEIL.
 */
export function target(baseline: number): number {
  const b = clamp(baseline, 0, 100) / 100.0;
  return FLOOR + SPAN * Math.pow(b, TARGET_GAMMA);
}

/**
 * Applique une note et renvoie le nouvel état complet.
 *
 * Fonction pure : ne mute pas `state`. Sortie destinée à être persistée
 * (value/baseline/volatility) puis auditée (§5.6).
 */
export function applyNote(
  state: ValueEngineState,
  rawNote: number,
  options: ValueEngineOptions = {},
): ValueUpdateResult {
  const wa = options.wAnchor ?? W_ANCHOR;
  const wk = options.wKick ?? W_KICK;
  const asym = options.asym ?? ASYM;
  const vref = options.volRef ?? VOL_REF;
  const damp = options.damp ?? DAMP;
  const eps = options.guardEps ?? GUARD_EPS;
  const ab = options.alphaBaseline ?? ALPHA_BASELINE;
  const av = options.alphaVol ?? ALPHA_VOL;
  const minMoveScale = options.minMoveScale ?? MIN_MOVE_SCALE;

  const note = clamp(rawNote, 0, 100);
  const { value, baseline, volatility } = state;

  const p = (value - FLOOR) / SPAN;
  const dev = note - baseline;
  const anchor = wa * (target(baseline) - value);
  const u = dev / 50.0;
  const gain = 1.0 + asym * (u >= 0 ? 1 - p : p);
  const stab = clamp(1 - volatility / vref, 0, 1);
  // Le kick (mouvement lié à la note) est calé sur MOVE_SPAN, pas sur SPAN, pour
  // que le plafond à 150M ne triple pas les mouvements par game.
  const kick = wk * u * gain * MOVE_SPAN * (1 - damp * stab);

  let delta = anchor + kick;
  const minMove = minMoveScale * (Math.abs(dev) / 50.0);
  if (dev >= eps && delta < minMove) delta = minMove;
  else if (dev <= -eps && delta > -minMove) delta = -minMove;

  const newValue = clamp(value + delta, FLOOR, CEIL);
  const newVolatility = volatility + av * (Math.abs(dev) - volatility);
  const newBaseline = baseline + ab * (note - baseline);

  return {
    value: newValue,
    delta,
    baseline: newBaseline,
    volatility: newVolatility,
  };
}

/**
 * Wrapper stateful pratique pour les simulations/tests. En production, préférer
 * `applyNote` avec l'état chargé/écrit dans la transaction Prisma.
 */
export class ValueEngine {
  value: number;
  baseline: number;
  volatility: number;
  private readonly options: ValueEngineOptions;

  constructor(
    value: number,
    baseline: number = SEED_BASELINE,
    volatility: number = SEED_VOL,
    options: ValueEngineOptions = {},
  ) {
    this.value = value;
    this.baseline = baseline;
    this.volatility = volatility;
    this.options = options;
  }

  update(note: number): ValueUpdateResult {
    const result = applyNote(
      { value: this.value, baseline: this.baseline, volatility: this.volatility },
      note,
      this.options,
    );
    this.value = result.value;
    this.baseline = result.baseline;
    this.volatility = result.volatility;
    return result;
  }
}
