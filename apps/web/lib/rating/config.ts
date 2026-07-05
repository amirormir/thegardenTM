/**
 * Config centralisée de l'algorithme de note (/100) et du moteur de valeur.
 *
 * Tous les leviers de tuning vivent ici, séparés de la logique (cf. §8 de la
 * spec « Algorithme de note & d'évolution de valeur »). Modifier une constante
 * ici suffit à retuner le comportement sans toucher au code métier.
 *
 * ⚠️ Ces valeurs sont VALIDÉES : elles reproduisent les sorties de référence
 * des sections « Validation » de la spec. Ne pas modifier sans rejouer les
 * tests de `rate-player.test.ts` / `value-engine.test.ts`.
 */

export const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;
export type RatingRole = (typeof ROLES)[number];

/** Ordre canonique des 10 sous-scores. */
export const SUBSCORE_KEYS = [
  'kda',
  'kp',
  'dmg_share',
  'dpm_vs_opp',
  'gold_diff',
  'gold_share',
  'cs',
  'vision',
  'tank',
  'obj',
] as const;
export type SubscoreKey = (typeof SUBSCORE_KEYS)[number];

// --- Note : éligibilité ------------------------------------------------------

/** Durée minimale (minutes) pour qu'une game soit notée. En dessous = bruit. */
export const MIN_GAME_MINUTES = 10;

// --- Note : baselines par rôle ----------------------------------------------

export const EXP_DMG_SHARE: Record<RatingRole, number> = {
  TOP: 0.22,
  JUNGLE: 0.18,
  MID: 0.26,
  ADC: 0.28,
  SUPPORT: 0.1,
};

export const EXP_GOLD_SHARE: Record<RatingRole, number> = {
  TOP: 0.2,
  JUNGLE: 0.19,
  MID: 0.21,
  ADC: 0.23,
  SUPPORT: 0.14,
};

export const EXP_CS_PM: Record<RatingRole, number> = {
  TOP: 7.5,
  JUNGLE: 5.5,
  MID: 8.0,
  ADC: 8.5,
  SUPPORT: 1.5,
};

export const EXP_VIS_PM: Record<RatingRole, number> = {
  TOP: 0.5,
  JUNGLE: 1.0,
  MID: 0.5,
  ADC: 0.45,
  SUPPORT: 1.6,
};

export const BASE_DEATHS: Record<RatingRole, number> = {
  TOP: 4.0,
  JUNGLE: 3.5,
  MID: 3.5,
  ADC: 3.5,
  SUPPORT: 5.0,
};

// --- Note : poids par rôle ---------------------------------------------------
// Ordre = SUBSCORE_KEYS : [kda, kp, dmg_share, dpm_vs_opp, gold_diff,
//                          gold_share, cs, vision, tank, obj]. Somme = 1.00.

export const WEIGHTS: Record<RatingRole, number[]> = {
  TOP: [0.16, 0.12, 0.11, 0.1, 0.1, 0.04, 0.09, 0.04, 0.12, 0.12],
  JUNGLE: [0.16, 0.15, 0.1, 0.08, 0.07, 0.04, 0.08, 0.08, 0.08, 0.16],
  MID: [0.15, 0.13, 0.16, 0.12, 0.1, 0.05, 0.09, 0.04, 0.02, 0.14],
  ADC: [0.15, 0.11, 0.18, 0.12, 0.1, 0.05, 0.11, 0.02, 0.02, 0.14],
  SUPPORT: [0.14, 0.18, 0.06, 0.04, 0.03, 0.03, 0.02, 0.22, 0.08, 0.2],
};

// --- Note : pénalités & contexte --------------------------------------------

export const DEATH_PEN_PER = 2.0;
export const DEATH_TOLERANCE = 1.3;
export const PASSENGER_PEN = 8.0;

/** Pondération des objectifs d'équipe pour `team_obj_strength`. */
export const OBJ_WEIGHTS = {
  dragon: 1.0,
  baron: 1.4,
  turret: 0.5,
  inhib: 0.8,
} as const;
export const OBJ_NORM: readonly [number, number] = [2, 14];

export const DOM_SCALE = 15000;
export const WIN_BASE = 6.0;
export const WIN_ELITE = 14.0;
export const ELITE_LO = 0.6;
export const ELITE_HI = 0.3; // largeur de la rampe d'élite (0.60 -> 0.90)
export const LOSS_SCALE = 6.0;

// --- Moteur de valeur --------------------------------------------------------

export const FLOOR = 10_000_000;
export const CEIL = 150_000_000;
export const SPAN = CEIL - FLOOR; // 140_000_000

/**
 * Convexité du mapping note-moyenne (baseline 0..100) -> valeur cible :
 *   target = FLOOR + SPAN * (baseline/100) ** TARGET_GAMMA
 * γ > 1 « étire le haut » : un joueur moyen (baseline 50) reste ~32,5M comme
 * avant, seuls les joueurs d'élite montent vers le plafond de 150M.
 * γ = 2.64 est calibré pour que target(50) ≈ 32,5M (invariant historique).
 */
export const TARGET_GAMMA = 2.64;

/**
 * Amplitude de référence du mouvement « surprise » (kick) par game. Découplée
 * de SPAN : élargir le plafond à 150M ne doit PAS tripler les mouvements par
 * game. On la garde ≈ l'ancienne plage (45M) pour conserver l'échelle de
 * mouvement actuelle, la montée vers 150M se faisant via l'ancre (mean-reversion)
 * sur plusieurs games.
 */
export const MOVE_SPAN = 45_000_000;

export const ALPHA_BASELINE = 0.4;
export const ALPHA_VOL = 0.35;
export const W_ANCHOR = 0.15;
// Réduit (0.075 -> 0.06, ~-20%) : atténue légèrement le mouvement lié à la note.
export const W_KICK = 0.06;
export const ASYM = 0.8;
export const VOL_REF = 22.0;
export const DAMP = 0.55;
export const GUARD_EPS = 10.0;
export const MIN_MOVE_SCALE = 0.5e6;

/** Amorçage d'un nouveau joueur (= target(baseline 50), milieu convexe). */
export const SEED_VALUE = 32_500_000;
export const SEED_BASELINE = 50;
export const SEED_VOL = 8;

// --- Note de BO --------------------------------------------------------------

/** Bonus ajouté à la note de BO résumé si la série est gagnée. */
export const BO_WIN_BONUS = 3;
