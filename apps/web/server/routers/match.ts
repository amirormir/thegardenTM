import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { ContractStatus } from '@nexus/db';
import {
  matchByTeamSchema,
  matchCreateSchema,
  matchIdSchema,
  matchUpdateSchema,
  recordResultSchema,
} from '@/lib/validators/match';
import { resolveStoredPlayerDisplayName } from '@/lib/utils/player-display';
import { buildStatsCacheKey, invalidateStatsCache } from '@/lib/cache/stats-cache';
import { buildAuditLogInput } from '@/server/utils/audit';
import { computeGameNotes, type GameRatingStat } from '@/server/utils/rating';
import { applyNote } from '@/lib/rating/value-engine';
import { resolveBettingConfig } from '@/server/utils/betting/config';
import { updateElo, winProbability } from '@/server/utils/betting/odds-engine';
import { recomputeOdds, recomputeOddsForTeams } from '@/server/utils/betting/recompute';
import { creditWallet } from '@/server/utils/wallet';
import { adminProcedure, createTRPCRouter, publicProcedure } from '@/server/trpc';

const matchRosterPlayerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  gameName: true,
  tagLine: true,
  imageUrl: true,
  role: true,
  marketValue: true,
} as const;

const matchListSelect = {
  id: true,
  format: true,
  scheduledAt: true,
  playedAt: true,
  isCompleted: true,
  homeScore: true,
  awayScore: true,
  homeTeam: {
    select: {
      id: true,
      name: true,
      shortCode: true,
      logoUrl: true,
    },
  },
  awayTeam: {
    select: {
      id: true,
      name: true,
      shortCode: true,
      logoUrl: true,
    },
  },
  season: {
    select: {
      id: true,
      name: true,
      isCurrent: true,
    },
  },
} as const;

export const matchRouter = createTRPCRouter({
  getAll: publicProcedure.query(({ ctx }) =>
    ctx.prisma.match.findMany({
      orderBy: { scheduledAt: 'desc' },
      select: matchListSelect,
    }),
  ),

  getRecent: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(({ ctx, input }) =>
      ctx.prisma.match.findMany({
        orderBy: { scheduledAt: 'desc' },
        take: input.limit,
        select: matchListSelect,
      }),
    ),

  getCompletedCount: publicProcedure.query(({ ctx }) =>
    ctx.prisma.match.count({ where: { isCompleted: true } }),
  ),

  getById: publicProcedure.input(matchIdSchema).query(async ({ ctx, input }) => {
    const match = await ctx.prisma.match.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        format: true,
        scheduledAt: true,
        playedAt: true,
        isCompleted: true,
        homeScore: true,
        awayScore: true,
        notes: true,
        homeTeam: {
          select: {
            id: true,
            name: true,
            shortCode: true,
            logoUrl: true,
            players: {
              where: { isActive: true },
              select: matchRosterPlayerSelect,
            },
          },
        },
        awayTeam: {
          select: {
            id: true,
            name: true,
            shortCode: true,
            logoUrl: true,
            players: {
              where: { isActive: true },
              select: matchRosterPlayerSelect,
            },
          },
        },
        season: {
          select: {
            id: true,
            name: true,
          },
        },
        games: {
          orderBy: { gameNumber: 'asc' },
          select: {
            id: true,
            gameNumber: true,
            riotMatchId: true,
            durationSeconds: true,
            playedAt: true,
            blueTeamId: true,
            redTeamId: true,
            winnerTeamId: true,
            playerStats: {
              select: {
                id: true,
                champion: true,
                kills: true,
                deaths: true,
                assists: true,
                cs: true,
                gold: true,
                damage: true,
                visionScore: true,
                side: true,
                result: true,
                items: true,
                note: true,
                player: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    gameName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!match) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Match not found.' });
    }

    return {
      ...match,
      homeTeam: {
        ...match.homeTeam,
        players: match.homeTeam.players.map((player) => ({
          ...player,
          displayName: resolveStoredPlayerDisplayName(player),
        })),
      },
      awayTeam: {
        ...match.awayTeam,
        players: match.awayTeam.players.map((player) => ({
          ...player,
          displayName: resolveStoredPlayerDisplayName(player),
        })),
      },
      games: match.games.map((game) => ({
        ...game,
        playerStats: game.playerStats.map((stat) => ({
          ...stat,
          player: {
            ...stat.player,
            displayName: resolveStoredPlayerDisplayName(stat.player),
          },
        })),
      })),
    };
  }),

  getByTeam: publicProcedure.input(matchByTeamSchema).query(({ ctx, input }) =>
    ctx.prisma.match.findMany({
      where: {
        OR: [{ homeTeamId: input.teamId }, { awayTeamId: input.teamId }],
      },
      orderBy: { scheduledAt: 'desc' },
      select: {
        id: true,
        format: true,
        scheduledAt: true,
        playedAt: true,
        isCompleted: true,
        homeScore: true,
        awayScore: true,
        homeTeam: {
          select: {
            id: true,
            name: true,
          },
        },
        awayTeam: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ),

  create: adminProcedure.input(matchCreateSchema).mutation(async ({ ctx, input }) => {
    const match = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.match.create({
        data: {
          seasonId: input.seasonId,
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          format: input.format,
          scheduledAt: input.scheduledAt,
          ...(input.notes ? { notes: input.notes } : {}),
        },
        select: {
          id: true,
          seasonId: true,
          homeTeamId: true,
          awayTeamId: true,
          format: true,
          scheduledAt: true,
        },
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'CREATE',
          entity: 'Match',
          entityId: created.id,
          details: {
            seasonId: created.seasonId,
            format: created.format,
          },
        }),
      });

      // Calcule les cotes si les deux equipes ont un rating sur la saison.
      await recomputeOdds(tx, created.id);

      return created;
    });

    return match;
  }),

  update: adminProcedure.input(matchUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    const existing = await ctx.prisma.match.findUnique({
      where: { id },
      select: {
        id: true,
        seasonId: true,
        homeTeamId: true,
        awayTeamId: true,
        format: true,
        scheduledAt: true,
        notes: true,
      },
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Match not found.' });
    }

    return ctx.prisma.$transaction(async (tx) => {
      const updated = await tx.match.update({
        where: { id },
        data: {
          ...(data.seasonId ? { seasonId: data.seasonId } : {}),
          ...(data.homeTeamId ? { homeTeamId: data.homeTeamId } : {}),
          ...(data.awayTeamId ? { awayTeamId: data.awayTeamId } : {}),
          ...(data.format ? { format: data.format } : {}),
          ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        },
        select: {
          id: true,
          seasonId: true,
          homeTeamId: true,
          awayTeamId: true,
          format: true,
          scheduledAt: true,
        },
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'UPDATE',
          entity: 'Match',
          entityId: id,
          details: {
            before: existing,
            after: updated,
          },
        }),
      });

      // Les equipes ou l'horaire ont pu changer -> recalcul des cotes (self-skip si verrouille).
      await recomputeOdds(tx, id);

      return updated;
    });
  }),

  recordResult: adminProcedure.input(recordResultSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        seasonId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        winnerTeamId: true,
        isCompleted: true,
      },
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Match not found.' });
    }

    const allowedTeamIds = new Set([existing.homeTeamId, existing.awayTeamId]);

    if (input.winnerTeamId && !allowedTeamIds.has(input.winnerTeamId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The selected series winner does not belong to this match.',
      });
    }

    for (const game of input.games) {
      if (!allowedTeamIds.has(game.blueTeamId) || !allowedTeamIds.has(game.redTeamId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A recorded game references a team outside of the match.',
        });
      }

      if (game.winnerTeamId && ![game.blueTeamId, game.redTeamId].includes(game.winnerTeamId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A recorded game winner must be one of the teams playing that game.',
        });
      }
    }

    const playerIds = [...new Set(input.games.flatMap((game) => game.playerStats.map((stat) => stat.playerId)))];
    const playersById = new Map<
      string,
      {
        id: string;
        teamId: string | null;
        marketValue: number;
        baseline: number;
        volatility: number;
      }
    >();

    if (playerIds.length > 0) {
      const players = await ctx.prisma.player.findMany({
        where: {
          id: { in: playerIds },
        },
        select: {
          id: true,
          teamId: true,
          marketValue: true,
          baseline: true,
          volatility: true,
        },
      });

      for (const player of players) {
        playersById.set(player.id, player);
      }

      if (players.length !== playerIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more selected players could not be found.',
        });
      }
    }

    // Le moteur de valeur ne s'applique qu'à la 1re complétion du match
    // (transition not-completed -> completed), comme les salaires/paris, pour
    // rester idempotent : ré-enregistrer un résultat ne re-déplace pas la valeur.
    const isFirstCompletion = !existing.isCompleted;
    const engineStates = new Map<
      string,
      { value: number; baseline: number; volatility: number }
    >();
    for (const [id, player] of playersById) {
      engineStates.set(id, {
        value: player.marketValue,
        baseline: player.baseline,
        volatility: player.volatility,
      });
    }
    // playerId -> ligne d'audit finale, écrasée par la dernière game notée (la
    // valeur/baseline/volatility persistée reflète l'état APRÈS toutes les games).
    const valueApplications = new Map<
      string,
      { valueBefore: number; valueAfter: number; note: number }
    >();

    const result = await ctx.prisma.$transaction(async (tx) => {
      await tx.matchGame.deleteMany({
        where: { matchId: input.matchId },
      });

      // Ordre chronologique : le moteur de valeur enchaîne les games d'un BO.
      const orderedGames = [...input.games].sort((a, b) => a.gameNumber - b.gameNumber);

      for (const game of orderedGames) {
        const createdGame = await tx.matchGame.create({
          data: {
            matchId: input.matchId,
            gameNumber: game.gameNumber,
            ...(game.riotMatchId ? { riotMatchId: game.riotMatchId } : {}),
            blueTeamId: game.blueTeamId,
            redTeamId: game.redTeamId,
            ...(game.winnerTeamId ? { winnerTeamId: game.winnerTeamId } : {}),
            ...(game.playedAt ? { playedAt: game.playedAt } : {}),
            ...(game.durationSeconds ? { durationSeconds: game.durationSeconds } : {}),
            ...(game.teamStats
              ? {
                  blueTotalGold: game.teamStats.blue.totalGold,
                  redTotalGold: game.teamStats.red.totalGold,
                  blueDragonKills: game.teamStats.blue.dragonKills,
                  blueBaronKills: game.teamStats.blue.baronKills,
                  blueTurretKills: game.teamStats.blue.turretKills,
                  blueInhibitorKills: game.teamStats.blue.inhibitorKills,
                  redDragonKills: game.teamStats.red.dragonKills,
                  redBaronKills: game.teamStats.red.baronKills,
                  redTurretKills: game.teamStats.red.turretKills,
                  redInhibitorKills: game.teamStats.red.inhibitorKills,
                }
              : {}),
          },
          select: {
            id: true,
          },
        });

        if (game.playerStats.length > 0) {
          const rows = game.playerStats.map((stat) => {
            const teamId = stat.side === 'BLUE' ? game.blueTeamId : game.redTeamId;
            const player = playersById.get(stat.playerId);

            if (!player || player.teamId !== teamId) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'A selected player is not assigned to the expected team roster.',
              });
            }

            if (!game.winnerTeamId) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'A game winner is required before saving player stats.',
              });
            }

            const playerResult =
              game.winnerTeamId === teamId ? ('WIN' as const) : ('LOSS' as const);

            return {
              playerId: stat.playerId,
              matchGameId: createdGame.id,
              teamId,
              role: stat.role,
              champion: stat.champion,
              kills: stat.kills,
              deaths: stat.deaths,
              assists: stat.assists,
              cs: stat.cs,
              gold: stat.gold,
              damage: stat.damage,
              visionScore: stat.visionScore,
              side: stat.side,
              result: playerResult,
              kda: stat.kda,
              csPerMin: stat.csPerMin,
              goldPerMin: stat.goldPerMin,
              damagePerMin: stat.damagePerMin,
              killParticipation: stat.killParticipation,
              damageShare: stat.damageShare,
              goldShare: stat.goldShare,
              damageTakenPerMin: stat.damageTakenPerMin,
              rawDamageTaken: stat.rawDamageTaken,
              rawSelfMitigated: stat.rawSelfMitigated,
              items: stat.items,
            };
          });

          // Notes /100 (mode STRICT : nécessite les totaux d'équipe + durée).
          const ratingStats: GameRatingStat[] = rows.map((row) => ({
            playerId: row.playerId,
            side: row.side,
            role: row.role,
            kills: row.kills,
            deaths: row.deaths,
            assists: row.assists,
            killParticipation: row.killParticipation,
            damageShare: row.damageShare,
            goldShare: row.goldShare,
            damagePerMin: row.damagePerMin,
            goldPerMin: row.goldPerMin,
            csPerMin: row.csPerMin,
            visionScore: row.visionScore,
            rawDamageTaken: row.rawDamageTaken,
            rawSelfMitigated: row.rawSelfMitigated,
            result: row.result,
          }));
          const notes = computeGameNotes({
            stats: ratingStats,
            teamStats: game.teamStats,
            durationMinutes: game.durationSeconds ? game.durationSeconds / 60 : 0,
          });

          const playerStatsData = rows.map((row) => {
            const note = notes.get(row.playerId);
            let valueBefore: number | null = null;
            let valueAfter: number | null = null;
            let baselineAfter: number | null = null;
            let volatilityAfter: number | null = null;

            if (note !== undefined && isFirstCompletion) {
              const state = engineStates.get(row.playerId)!;
              const applied = applyNote(state, note);
              valueBefore = Math.round(state.value);
              valueAfter = Math.round(applied.value);
              baselineAfter = applied.baseline;
              volatilityAfter = applied.volatility;
              engineStates.set(row.playerId, {
                value: applied.value,
                baseline: applied.baseline,
                volatility: applied.volatility,
              });
              const first = valueApplications.get(row.playerId);
              valueApplications.set(row.playerId, {
                valueBefore: first?.valueBefore ?? valueBefore,
                valueAfter,
                note,
              });
            }

            return {
              ...row,
              note: note ?? null,
              valueBefore,
              valueAfter,
              baselineAfter,
              volatilityAfter,
            };
          });

          await tx.playerMatchStats.createMany({
            data: playerStatsData,
          });
        }
      }

      // Persiste l'état final du moteur + historique de valeur (1re complétion).
      if (isFirstCompletion) {
        for (const [playerId, state] of engineStates) {
          if (!valueApplications.has(playerId)) continue; // joueur non noté
          const application = valueApplications.get(playerId)!;
          const finalValue = Math.round(state.value);

          await tx.player.update({
            where: { id: playerId },
            data: {
              marketValue: finalValue,
              baseline: state.baseline,
              volatility: state.volatility,
            },
          });

          if (finalValue !== application.valueBefore) {
            await tx.marketValueHistory.create({
              data: {
                playerId,
                previousValue: application.valueBefore,
                newValue: finalValue,
                reason: 'Évolution automatique (performance)',
                changedById: ctx.session.user.id,
              },
            });
          }
        }
      }

      const match = await tx.match.update({
        where: { id: input.matchId },
        data: {
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          winnerTeamId: input.winnerTeamId ?? null,
          playedAt: input.playedAt ?? new Date(),
          isCompleted: true,
        },
        select: {
          id: true,
          homeScore: true,
          awayScore: true,
          winnerTeamId: true,
          isCompleted: true,
        },
      });

      // Decrement bosRemaining for both teams' active contracts only on the
      // transition from not-completed -> completed. Re-recording an already
      // completed match must NOT double-decrement.
      const teamIdsToTick = !existing.isCompleted
        ? [existing.homeTeamId, existing.awayTeamId]
        : [];

      const expiredContractIds: string[] = [];
      const walletCredits: { userId: string; amount: number; playerId: string }[] = [];

      if (teamIdsToTick.length > 0) {
        const activeContracts = await tx.contract.findMany({
          where: {
            teamId: { in: teamIdsToTick },
            status: { in: [ContractStatus.ACTIVE, ContractStatus.LOAN] },
            bosRemaining: { not: null },
          },
          select: {
            id: true,
            playerId: true,
            teamId: true,
            salary: true,
            bosRemaining: true,
            player: {
              select: {
                firstName: true,
                lastName: true,
                gameName: true,
                linkedAccount: { select: { id: true, walletBalance: true } },
              },
            },
            team: {
              select: { name: true, captains: { select: { id: true } } },
            },
          },
        });

        for (const contract of activeContracts) {
          // Versement du salaire/BO sur le wallet du compte relie a la carte.
          // Gardé par teamIdsToTick (transition not-completed -> completed),
          // donc idempotent : ré-enregistrer un BO ne re-paie pas.
          const linkedAccount = contract.player.linkedAccount;
          if (linkedAccount && contract.salary > 0) {
            const balanceAfter = linkedAccount.walletBalance + contract.salary;

            await tx.user.update({
              where: { id: linkedAccount.id },
              data: { walletBalance: { increment: contract.salary } },
            });

            await tx.walletTransaction.create({
              data: {
                userId: linkedAccount.id,
                amount: contract.salary,
                balanceAfter,
                type: 'SALARY_BO',
                reason: 'Salaire BO',
                matchId: input.matchId,
                playerId: contract.playerId,
              },
            });

            walletCredits.push({
              userId: linkedAccount.id,
              amount: contract.salary,
              playerId: contract.playerId,
            });
          }

          const next = Math.max(0, (contract.bosRemaining ?? 0) - 1);

          if (next === 0) {
            await tx.contract.update({
              where: { id: contract.id },
              data: {
                status: ContractStatus.EXPIRED,
                bosRemaining: 0,
                terminatedAt: new Date(),
              },
            });
            await tx.player.update({
              where: { id: contract.playerId },
              data: { teamId: null, salary: 0 },
            });
            expiredContractIds.push(contract.id);

            const displayName = resolveStoredPlayerDisplayName(contract.player);
            for (const cap of contract.team.captains) {
              await tx.notification.create({
                data: {
                  userId: cap.id,
                  type: 'CONTRACT_EXPIRED',
                  title: 'Contrat arrive a echeance',
                  message: `Le contrat de ${displayName} a atteint son terme (BO restants epuises). Le joueur est desormais free agent.`,
                  link: '/team/contracts',
                  metadata: { contractId: contract.id, playerId: contract.playerId },
                },
              });
            }
          } else {
            await tx.contract.update({
              where: { id: contract.id },
              data: { bosRemaining: next },
            });
          }
        }
      }

      // --- Paris : reglement + evolution des ratings + recalcul des cotes ---
      // Uniquement sur la transition not-completed -> completed (idempotent) et
      // si le vainqueur du BO est connu.
      const winnerTeamId = input.winnerTeamId ?? null;
      let betsSettled = 0;
      const ratingUpdates: { teamId: string; before: number; after: number }[] = [];

      if (!existing.isCompleted && winnerTeamId) {
        const pendingBets = await tx.bet.findMany({
          where: { matchId: input.matchId, status: 'PENDING' },
          select: { id: true, userId: true, selectedTeamId: true, potentialPayout: true },
        });

        for (const bet of pendingBets) {
          const won = bet.selectedTeamId === winnerTeamId;
          if (won) {
            await creditWallet(tx, {
              userId: bet.userId,
              amount: bet.potentialPayout,
              type: 'BET_WON',
              reason: 'Gain pari',
              matchId: input.matchId,
              betId: bet.id,
            });
          }
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: won ? 'WON' : 'LOST', settledAt: new Date() },
          });
          betsSettled += 1;
        }

        // Evolution Elo des deux equipes (E = proba pre-match, depuis les ratings courants).
        const config = await resolveBettingConfig(tx, existing.seasonId);
        const teamRatings = await tx.teamRating.findMany({
          where: {
            seasonId: existing.seasonId,
            teamId: { in: [existing.homeTeamId, existing.awayTeamId] },
          },
          select: { id: true, teamId: true, rating: true, gamesPlayed: true },
        });
        const homeRating = teamRatings.find((r) => r.teamId === existing.homeTeamId);
        const awayRating = teamRatings.find((r) => r.teamId === existing.awayTeamId);

        if (homeRating && awayRating) {
          const expectedHome = winProbability(homeRating.rating, awayRating.rating);
          const homeScored = winnerTeamId === existing.homeTeamId ? 1 : 0;

          const newHome = updateElo({
            rating: homeRating.rating,
            expected: expectedHome,
            score: homeScored === 1 ? 1 : 0,
            k: config.k,
            gamesPlayed: homeRating.gamesPlayed,
            warmupGames: config.warmupGames,
          });
          const newAway = updateElo({
            rating: awayRating.rating,
            expected: 1 - expectedHome,
            score: homeScored === 1 ? 0 : 1,
            k: config.k,
            gamesPlayed: awayRating.gamesPlayed,
            warmupGames: config.warmupGames,
          });

          await tx.teamRating.update({
            where: { id: homeRating.id },
            data: { rating: newHome, gamesPlayed: { increment: 1 } },
          });
          await tx.teamRating.update({
            where: { id: awayRating.id },
            data: { rating: newAway, gamesPlayed: { increment: 1 } },
          });

          ratingUpdates.push(
            { teamId: homeRating.teamId, before: homeRating.rating, after: newHome },
            { teamId: awayRating.teamId, before: awayRating.rating, after: newAway },
          );

          // Les cotes des matchs a venir des deux equipes evoluent.
          await recomputeOddsForTeams(tx, existing.seasonId, [
            existing.homeTeamId,
            existing.awayTeamId,
          ]);
        }
      }

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'RECORD_RESULT',
          entity: 'Match',
          entityId: input.matchId,
          details: {
            before: existing,
            after: match,
            gameCount: input.games.length,
            playerStatCount: input.games.reduce(
              (total, game) => total + game.playerStats.length,
              0,
            ),
            contractsTicked: teamIdsToTick.length > 0,
            expiredContractIds,
            walletCredits,
            betsSettled,
            ratingUpdates,
            valueUpdates: isFirstCompletion
              ? [...valueApplications.entries()].map(([playerId, a]) => ({
                  playerId,
                  valueBefore: a.valueBefore,
                  valueAfter: Math.round(engineStates.get(playerId)!.value),
                }))
              : [],
          },
        }),
      });

      return { match, expiredContractIds, ticked: teamIdsToTick };
    },
    // Cette transaction enchaine beaucoup d'ecritures (games, stats, valeurs,
    // contrats, wallets, paris, Elo). Le defaut Prisma de 5s est trop court des
    // qu'il y a de la latence reseau -> on laisse 30s.
    { timeout: 30_000, maxWait: 15_000 });

    await invalidateStatsCache(
      buildStatsCacheKey('league', 'standings'),
      ...result.ticked.map((teamId) => buildStatsCacheKey('team', 'payroll', teamId)),
    );

    return result.match;
  }),
});
