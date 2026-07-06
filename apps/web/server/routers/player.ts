import type { PlayerRole, Prisma } from '@nexus/db';
import { ContractStatus } from '@nexus/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getAccountByRiotId } from '@/lib/riot';
import {
  marketValueHistoryCreateSchema,
  marketValueHistoryDeleteSchema,
  marketValueHistoryUpdateSchema,
  PLAYER_LIST_DEFAULT_LIMIT,
  playerByTeamSchema,
  playerCreateSchema,
  playerDeleteSchema,
  playerIdSchema,
  playerListQuerySchema,
  playerPagedQuerySchema,
  playerTrophyCreateSchema,
  playerTrophyDeleteSchema,
  playerTrophyUpdateSchema,
  playerUpdateSchema,
  updateMarketValueSchema,
} from '@/lib/validators/player';
import { resolveStoredPlayerDisplayName } from '@/lib/utils/player-display';
import { getTransferFloor } from '@/lib/utils/transfer-rules';
import { buildAuditLogInput } from '@/server/utils/audit';
import { adminProcedure, createTRPCRouter, publicProcedure } from '@/server/trpc';

const FREE_AGENT_NAME = 'Free Agent';
const FREE_AGENT_SHORT_CODE = 'FA';

const PLAYER_LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  gameName: true,
  tagLine: true,
  imageUrl: true,
  role: true,
  secondaryRoles: true,
  marketValue: true,
  salary: true,
  cost: true,
  teamId: true,
  team: {
    select: {
      name: true,
      shortCode: true,
      logoUrl: true,
    },
  },
  marketValueHistory: {
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      previousValue: true,
      newValue: true,
    },
  },
} satisfies Prisma.PlayerSelect;

const PLAYER_SEARCH_LITE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  gameName: true,
  tagLine: true,
  role: true,
  team: {
    select: {
      name: true,
      shortCode: true,
    },
  },
} satisfies Prisma.PlayerSelect;

type PlayerListSort =
  | 'marketValue-desc'
  | 'marketValue-asc'
  | 'salary-desc'
  | 'salary-asc'
  | 'name-asc';

function buildPlayerListWhere(input: {
  search?: string | undefined;
  role?: PlayerRole | undefined;
}): Prisma.PlayerWhereInput {
  const search = input.search?.trim();
  return {
    isActive: true,
    AND: [
      ...(input.role
        ? [
            {
              OR: [{ role: input.role }, { secondaryRoles: { has: input.role } }],
            },
          ]
        : []),
      ...(search
        ? [
            {
              OR: [
                { gameName: { contains: search, mode: 'insensitive' as const } },
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
                { tagLine: { contains: search, mode: 'insensitive' as const } },
                {
                  team: {
                    name: { contains: search, mode: 'insensitive' as const },
                  },
                },
                {
                  team: {
                    shortCode: { contains: search, mode: 'insensitive' as const },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

function buildPlayerListOrderBy(
  sort: PlayerListSort | undefined,
): Prisma.PlayerOrderByWithRelationInput[] {
  const primary: Prisma.PlayerOrderByWithRelationInput[] =
    sort === 'marketValue-asc'
      ? [{ marketValue: 'asc' }]
      : sort === 'salary-desc'
        ? [{ salary: 'desc' }]
        : sort === 'salary-asc'
          ? [{ salary: 'asc' }]
          : sort === 'name-asc'
            ? [{ firstName: 'asc' }, { gameName: 'asc' }]
            : [{ marketValue: 'desc' }];

  return [...primary, { id: 'asc' }];
}

type RawListedPlayer = Prisma.PlayerGetPayload<{ select: typeof PLAYER_LIST_SELECT }>;

function mapListedPlayer(player: RawListedPlayer) {
  return {
    id: player.id,
    displayName: resolveStoredPlayerDisplayName(player),
    firstName: player.firstName,
    lastName: player.lastName,
    gameName: player.gameName,
    tagLine: player.tagLine,
    imageUrl: player.imageUrl,
    role: player.role,
    secondaryRoles: player.secondaryRoles,
    marketValue: player.marketValue,
    marketValueDelta:
      player.marketValueHistory[0]?.newValue !== undefined
        ? player.marketValueHistory[0].newValue - player.marketValueHistory[0].previousValue
        : 0,
    salary: player.salary,
    cost: player.cost,
    teamId: player.teamId,
    ...toTeamDisplay(player.team),
  };
}

function normalizeSecondaryRoles(
  roles: PlayerRole[] | undefined,
  primaryRole: PlayerRole,
): PlayerRole[] {
  return [...new Set((roles ?? []).filter((role) => role !== primaryRole))];
}

function toTeamDisplay(team: { name: string; shortCode: string; logoUrl?: string | null } | null) {
  return {
    teamName: team?.name ?? FREE_AGENT_NAME,
    teamShortCode: team?.shortCode ?? FREE_AGENT_SHORT_CODE,
    teamLogoUrl: team?.logoUrl ?? null,
  };
}

function slugifyPlayer(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function buildUniquePlayerSlug(
  client: {
    player: {
      count(args: Prisma.PlayerCountArgs): Promise<number>;
    };
  },
  source: string,
  currentId?: string,
) {
  const base = slugifyPlayer(source) || 'player';
  let candidate = base;
  let attempt = 1;

  while (true) {
    const count = await client.player.count({
      where: {
        slug: candidate,
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
    });

    if (count === 0) {
      return candidate;
    }

    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
}

async function resolvePuuid(gameName: string, tagLine: string, currentPuuid?: string | null) {
  if (currentPuuid) {
    return currentPuuid;
  }

  try {
    const account = await getAccountByRiotId(gameName, tagLine);
    return account.data;
  } catch {
    return null;
  }
}

async function rebuildPlayerMarketValueHistory(tx: Prisma.TransactionClient, playerId: string) {
  const entries = await tx.marketValueHistory.findMany({
    where: { playerId },
    orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      newValue: true,
      previousValue: true,
    },
  });

  let previousValue = 0;

  for (const entry of entries) {
    if (entry.previousValue !== previousValue) {
      await tx.marketValueHistory.update({
        where: { id: entry.id },
        data: {
          previousValue,
        },
      });
    }

    previousValue = entry.newValue;
  }

  await tx.player.update({
    where: { id: playerId },
    data: {
      marketValue: previousValue,
    },
  });

  // La clause liberatoire ne peut jamais etre inferieure a 50% de la valeur
  // marchande. A chaque changement de valeur, on releve les clauses sous le
  // plancher (jamais l'inverse : une baisse de valeur ne diminue pas une clause
  // deja superieure).
  const clauseFloor = getTransferFloor(previousValue);
  await tx.contract.updateMany({
    where: {
      playerId,
      status: { in: [ContractStatus.ACTIVE, ContractStatus.LOAN, ContractStatus.PENDING_APPROVAL] },
      releaseClause: { lt: clauseFloor },
    },
    data: { releaseClause: clauseFloor },
  });

  return {
    currentValue: previousValue,
    count: entries.length,
  };
}

export const playerRouter = createTRPCRouter({
  searchLite: publicProcedure
    .input(
      z
        .object({
          q: z.string().trim().min(1).max(50).optional(),
          limit: z.number().int().min(1).max(12).default(8),
        })
        .default({ limit: 8 }),
    )
    .query(async ({ ctx, input }) => {
      const players = await ctx.prisma.player.findMany({
        where: buildPlayerListWhere({
          search: input.q,
        }),
        orderBy: buildPlayerListOrderBy('marketValue-desc'),
        take: input.limit,
        select: PLAYER_SEARCH_LITE_SELECT,
      });

      return players.map((player) => ({
        id: player.id,
        displayName: resolveStoredPlayerDisplayName(player),
        gameName: player.gameName,
        tagLine: player.tagLine,
        role: player.role,
        teamName: player.team?.name ?? FREE_AGENT_NAME,
        teamShortCode: player.team?.shortCode ?? FREE_AGENT_SHORT_CODE,
      }));
    }),

  // Liste des cartes joueurs reliables a un compte. Sert au selecteur de carte
  // a l'inscription et a la gestion du lien depuis le back-office. Expose le
  // statut de liaison (linkedAccountId) pour desactiver les cartes deja prises.
  listLinkable: publicProcedure.query(async ({ ctx }) => {
    const players = await ctx.prisma.player.findMany({
      where: { isActive: true },
      orderBy: [{ firstName: 'asc' }, { gameName: 'asc' }],
      select: {
        ...PLAYER_SEARCH_LITE_SELECT,
        linkedAccount: { select: { id: true } },
      },
    });

    return players.map((player) => ({
      id: player.id,
      displayName: resolveStoredPlayerDisplayName(player),
      gameName: player.gameName,
      tagLine: player.tagLine,
      role: player.role,
      teamName: player.team?.name ?? FREE_AGENT_NAME,
      teamShortCode: player.team?.shortCode ?? FREE_AGENT_SHORT_CODE,
      linkedAccountId: player.linkedAccount?.id ?? null,
    }));
  }),

  getAll: publicProcedure.input(playerListQuerySchema.optional()).query(async ({ ctx, input }) => {
    const where = buildPlayerListWhere({
      search: input?.search,
      role: input?.role,
    });
    const orderBy = buildPlayerListOrderBy(input?.sort);
    const limit = input?.limit ?? PLAYER_LIST_DEFAULT_LIMIT;
    const cursor = input?.cursor;

    const players = await ctx.prisma.player.findMany({
      where,
      orderBy,
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: PLAYER_LIST_SELECT,
    });

    return players.map(mapListedPlayer);
  }),

  getListPaged: publicProcedure.input(playerPagedQuerySchema).query(async ({ ctx, input }) => {
    const where = buildPlayerListWhere({
      search: input.search,
      role: input.role,
    });
    const orderBy = buildPlayerListOrderBy(input.sort);

    const [total, players] = await ctx.prisma.$transaction([
      ctx.prisma.player.count({ where }),
      ctx.prisma.player.findMany({
        where,
        orderBy,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: PLAYER_LIST_SELECT,
      }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / input.pageSize));

    return {
      items: players.map(mapListedPlayer),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount,
    };
  }),

  getById: publicProcedure.input(playerIdSchema).query(async ({ ctx, input }) => {
    const player = await ctx.prisma.player.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        slug: true,
        gameName: true,
        tagLine: true,
        puuid: true,
        summonerId: true,
        imageUrl: true,
        role: true,
        secondaryRoles: true,
        age: true,
        nationality: true,
        marketValue: true,
        salary: true,
        isActive: true,
        teamId: true,
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            shortCode: true,
            logoUrl: true,
          },
        },
        contracts: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            salary: true,
            durationBo3: true,
            releaseClause: true,
            transferFee: true,
            status: true,
            approvedAt: true,
            createdAt: true,
          },
        },
        marketValueHistory: {
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          take: 20,
          select: {
            id: true,
            previousValue: true,
            newValue: true,
            reason: true,
            changedAt: true,
            changedBy: {
              select: {
                name: true,
              },
            },
          },
        },
        playerMatchStats: {
          orderBy: { createdAt: 'desc' },
          take: 8,
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
            result: true,
            createdAt: true,
            matchGame: {
              select: {
                gameNumber: true,
                playedAt: true,
                match: {
                  select: {
                    id: true,
                    format: true,
                    scheduledAt: true,
                    homeScore: true,
                    awayScore: true,
                    isCompleted: true,
                    homeTeam: {
                      select: {
                        name: true,
                        shortCode: true,
                        logoUrl: true,
                      },
                    },
                    awayTeam: {
                      select: {
                        name: true,
                        shortCode: true,
                        logoUrl: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        playerTrophies: {
          orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            name: true,
            description: true,
            awardedAt: true,
            seasonLabel: true,
            teamLabel: true,
            season: {
              select: {
                id: true,
                name: true,
                year: true,
              },
            },
            team: {
              select: {
                id: true,
                name: true,
                shortCode: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!player) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
    }

    return {
      ...player,
      displayName: resolveStoredPlayerDisplayName(player),
    };
  }),

  getByTeam: publicProcedure.input(playerByTeamSchema).query(async ({ ctx, input }) => {
    const players = await ctx.prisma.player.findMany({
      where: { teamId: input.teamId },
      orderBy: [{ role: 'asc' }, { marketValue: 'desc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        gameName: true,
        tagLine: true,
        imageUrl: true,
        role: true,
        secondaryRoles: true,
        marketValue: true,
        salary: true,
        isActive: true,
        teamId: true,
      },
    });

    return players.map((player) => ({
      ...player,
      displayName: resolveStoredPlayerDisplayName(player),
    }));
  }),

  getAdminRegistry: adminProcedure.query(async ({ ctx }) => {
    const players = await ctx.prisma.player.findMany({
      orderBy: [{ isActive: 'desc' }, { marketValue: 'desc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        gameName: true,
        tagLine: true,
        imageUrl: true,
        role: true,
        secondaryRoles: true,
        marketValue: true,
        salary: true,
        cost: true,
        isActive: true,
        teamId: true,
        team: {
          select: {
            name: true,
            shortCode: true,
            logoUrl: true,
          },
        },
      },
    });

    return players.map((player) => ({
      id: player.id,
      displayName: resolveStoredPlayerDisplayName(player),
      firstName: player.firstName,
      lastName: player.lastName,
      gameName: player.gameName,
      tagLine: player.tagLine,
      imageUrl: player.imageUrl,
      role: player.role,
      secondaryRoles: player.secondaryRoles,
      marketValue: player.marketValue,
      salary: player.salary,
      cost: player.cost,
      isActive: player.isActive,
      teamId: player.teamId,
      ...toTeamDisplay(player.team),
    }));
  }),

  getAdminOptions: adminProcedure.query(async ({ ctx }) => {
    const [teams, seasons] = await Promise.all([
      ctx.prisma.team.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          shortCode: true,
        },
      }),
      ctx.prisma.season.findMany({
        orderBy: [{ isCurrent: 'desc' }, { year: 'desc' }, { startDate: 'desc' }],
        select: {
          id: true,
          name: true,
          year: true,
          isCurrent: true,
        },
      }),
    ]);

    return {
      teams,
      seasons,
    };
  }),

  getAdminDetails: adminProcedure.input(playerIdSchema).query(async ({ ctx, input }) => {
    const player = await ctx.prisma.player.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        slug: true,
        gameName: true,
        tagLine: true,
        imageUrl: true,
        puuid: true,
        summonerId: true,
        role: true,
        secondaryRoles: true,
        age: true,
        nationality: true,
        marketValue: true,
        salary: true,
        cost: true,
        isActive: true,
        teamId: true,
        team: {
          select: {
            id: true,
            name: true,
            shortCode: true,
          },
        },
        marketValueHistory: {
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            previousValue: true,
            newValue: true,
            reason: true,
            changedAt: true,
            changedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        playerTrophies: {
          orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            name: true,
            description: true,
            awardedAt: true,
            seasonLabel: true,
            teamLabel: true,
            seasonId: true,
            season: {
              select: {
                id: true,
                name: true,
                year: true,
              },
            },
            teamId: true,
            team: {
              select: {
                id: true,
                name: true,
                shortCode: true,
              },
            },
          },
        },
      },
    });

    if (!player) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
    }

    return {
      ...player,
      displayName: resolveStoredPlayerDisplayName(player),
    };
  }),

  create: adminProcedure.input(playerCreateSchema).mutation(async ({ ctx, input }) => {
    const secondaryRoles = normalizeSecondaryRoles(input.secondaryRoles, input.role);
    const slug = await buildUniquePlayerSlug(
      ctx.prisma,
      input.slug ?? input.firstName ?? input.gameName ?? `${input.firstName}-${input.lastName}`,
    );
    const puuid = await resolvePuuid(input.gameName, input.tagLine, input.puuid ?? null);

    return ctx.prisma.$transaction(async (tx) => {
      const player = await tx.player.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          slug,
          gameName: input.gameName,
          tagLine: input.tagLine,
          role: input.role,
          // Le rôle d'équipe suit le rôle principal (admins pilotent les deux).
          teamRole: input.role,
          secondaryRoles,
          teamId: input.teamId ?? null,
          imageUrl: input.imageUrl ?? null,
          ...(input.age !== undefined ? { age: input.age } : {}),
          ...(input.nationality ? { nationality: input.nationality } : {}),
          marketValue: input.marketValue,
          salary: input.salary,
          cost: input.cost,
          ...(puuid ? { puuid } : {}),
          ...(input.summonerId ? { summonerId: input.summonerId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: {
          id: true,
          gameName: true,
          tagLine: true,
          role: true,
          secondaryRoles: true,
          marketValue: true,
          salary: true,
          cost: true,
          teamId: true,
          imageUrl: true,
        },
      });

      await tx.marketValueHistory.create({
        data: {
          playerId: player.id,
          previousValue: 0,
          newValue: input.marketValue,
          reason: 'Initial admin valuation',
          changedById: ctx.session.user.id,
        },
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'CREATE',
          entity: 'Player',
          entityId: player.id,
          details: {
            gameName: player.gameName,
            role: player.role,
            secondaryRoles: player.secondaryRoles,
            marketValue: player.marketValue,
            teamId: player.teamId,
          },
        }),
      });

      return player;
    });
  }),

  update: adminProcedure.input(playerUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    const existing = await ctx.prisma.player.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        slug: true,
        gameName: true,
        tagLine: true,
        puuid: true,
        imageUrl: true,
        role: true,
        secondaryRoles: true,
        teamId: true,
        marketValue: true,
        salary: true,
        cost: true,
        age: true,
        nationality: true,
        isActive: true,
      },
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
    }

    const nextRole = data.role ?? existing.role;
    const secondaryRoles = normalizeSecondaryRoles(
      data.secondaryRoles ?? existing.secondaryRoles,
      nextRole,
    );
    const puuid =
      data.gameName || data.tagLine || data.puuid !== undefined
        ? await resolvePuuid(
            data.gameName ?? existing.gameName,
            data.tagLine ?? existing.tagLine,
            data.puuid ?? existing.puuid,
          )
        : existing.puuid;
    const slug =
      data.slug !== undefined
        ? await buildUniquePlayerSlug(ctx.prisma, data.slug, existing.id)
        : undefined;

    return ctx.prisma.$transaction(async (tx) => {
      const updatedPlayer = await tx.player.update({
        where: { id },
        data: {
          ...(data.firstName ? { firstName: data.firstName } : {}),
          ...(data.lastName ? { lastName: data.lastName } : {}),
          ...(slug ? { slug } : {}),
          ...(data.gameName ? { gameName: data.gameName } : {}),
          ...(data.tagLine ? { tagLine: data.tagLine } : {}),
          ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
          role: nextRole,
          // Le rôle d'équipe suit le rôle principal (admins pilotent les deux).
          teamRole: nextRole,
          secondaryRoles,
          ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
          ...(data.age !== undefined ? { age: data.age } : {}),
          ...(data.nationality ? { nationality: data.nationality } : {}),
          ...(data.marketValue !== undefined ? { marketValue: data.marketValue } : {}),
          ...(data.salary !== undefined ? { salary: data.salary } : {}),
          ...(data.cost !== undefined ? { cost: data.cost } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(puuid ? { puuid } : {}),
          ...(data.summonerId ? { summonerId: data.summonerId } : {}),
        },
        select: {
          id: true,
          gameName: true,
          role: true,
          secondaryRoles: true,
          teamId: true,
          marketValue: true,
          imageUrl: true,
        },
      });

      if (data.marketValue !== undefined && data.marketValue !== existing.marketValue) {
        await tx.marketValueHistory.create({
          data: {
            playerId: id,
            previousValue: existing.marketValue,
            newValue: data.marketValue,
            reason: 'Admin update from player router',
            changedById: ctx.session.user.id,
          },
        });

        await rebuildPlayerMarketValueHistory(tx, id);
      }

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'UPDATE',
          entity: 'Player',
          entityId: id,
          details: {
            before: existing,
            after: updatedPlayer,
          },
        }),
      });

      return updatedPlayer;
    });
  }),

  delete: adminProcedure.input(playerDeleteSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.player.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        gameName: true,
      },
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
    }

    await ctx.prisma.$transaction(async (tx) => {
      await tx.player.delete({ where: { id: input.id } });
      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'DELETE',
          entity: 'Player',
          entityId: input.id,
          details: {
            gameName: existing.gameName,
          },
        }),
      });
    });

    return { success: true };
  }),

  updateMarketValue: adminProcedure
    .input(updateMarketValueSchema)
    .mutation(async ({ ctx, input }) => {
      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
        select: {
          id: true,
          marketValue: true,
        },
      });

      if (!player) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
      }

      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.player.update({
          where: { id: input.playerId },
          data: { marketValue: input.newValue },
          select: {
            id: true,
            marketValue: true,
          },
        });

        await tx.marketValueHistory.create({
          data: {
            playerId: input.playerId,
            previousValue: player.marketValue,
            newValue: input.newValue,
            reason: input.reason ?? 'Manual admin valuation update',
            changedById: ctx.session.user.id,
          },
        });

        await rebuildPlayerMarketValueHistory(tx, input.playerId);

        await tx.auditLog.create({
          data: buildAuditLogInput({
            userId: ctx.session.user.id,
            action: 'UPDATE_MARKET_VALUE',
            entity: 'Player',
            entityId: input.playerId,
            details: {
              previousValue: player.marketValue,
              newValue: input.newValue,
              reason: input.reason ?? null,
            },
          }),
        });

        return updated;
      });
    }),

  createMarketValueHistory: adminProcedure
    .input(marketValueHistoryCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
        select: {
          id: true,
          gameName: true,
        },
      });

      if (!player) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
      }

      return ctx.prisma.$transaction(async (tx) => {
        const entry = await tx.marketValueHistory.create({
          data: {
            playerId: input.playerId,
            previousValue: 0,
            newValue: input.newValue,
            changedAt: input.changedAt,
            changedById: ctx.session.user.id,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          },
          select: {
            id: true,
            playerId: true,
            newValue: true,
            changedAt: true,
          },
        });

        await rebuildPlayerMarketValueHistory(tx, input.playerId);

        await tx.auditLog.create({
          data: buildAuditLogInput({
            userId: ctx.session.user.id,
            action: 'CREATE',
            entity: 'MarketValueHistory',
            entityId: entry.id,
            details: {
              playerId: input.playerId,
              gameName: player.gameName,
              newValue: input.newValue,
              changedAt: input.changedAt,
            },
          }),
        });

        return entry;
      });
    }),

  updateMarketValueHistory: adminProcedure
    .input(marketValueHistoryUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.marketValueHistory.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          playerId: true,
          previousValue: true,
          newValue: true,
          reason: true,
          changedAt: true,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Market value entry not found.' });
      }

      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.marketValueHistory.update({
          where: { id: input.id },
          data: {
            newValue: input.newValue,
            changedAt: input.changedAt,
            changedById: ctx.session.user.id,
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          },
          select: {
            id: true,
            playerId: true,
            newValue: true,
            changedAt: true,
          },
        });

        await rebuildPlayerMarketValueHistory(tx, existing.playerId);

        await tx.auditLog.create({
          data: buildAuditLogInput({
            userId: ctx.session.user.id,
            action: 'UPDATE',
            entity: 'MarketValueHistory',
            entityId: input.id,
            details: {
              before: existing,
              after: updated,
            },
          }),
        });

        return updated;
      });
    }),

  deleteMarketValueHistory: adminProcedure
    .input(marketValueHistoryDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.marketValueHistory.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          playerId: true,
          newValue: true,
          changedAt: true,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Market value entry not found.' });
      }

      return ctx.prisma.$transaction(async (tx) => {
        await tx.marketValueHistory.delete({
          where: { id: input.id },
        });

        await rebuildPlayerMarketValueHistory(tx, existing.playerId);

        await tx.auditLog.create({
          data: buildAuditLogInput({
            userId: ctx.session.user.id,
            action: 'DELETE',
            entity: 'MarketValueHistory',
            entityId: input.id,
            details: existing,
          }),
        });

        return { success: true };
      });
    }),

  createTrophy: adminProcedure.input(playerTrophyCreateSchema).mutation(async ({ ctx, input }) => {
    const player = await ctx.prisma.player.findUnique({
      where: { id: input.playerId },
      select: {
        id: true,
        gameName: true,
      },
    });

    if (!player) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not found.' });
    }

    return ctx.prisma.$transaction(async (tx) => {
      const trophy = await tx.trophy.create({
        data: {
          playerId: input.playerId,
          seasonLabel: input.seasonLabel,
          teamLabel: input.teamLabel ?? null,
          seasonId: null,
          teamId: null,
          name: input.name,
          awardedAt: input.awardedAt,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        select: {
          id: true,
          name: true,
          seasonLabel: true,
          teamLabel: true,
        },
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'CREATE',
          entity: 'Trophy',
          entityId: trophy.id,
          details: {
            playerId: input.playerId,
            gameName: player.gameName,
            name: input.name,
            seasonLabel: input.seasonLabel,
            teamLabel: input.teamLabel ?? null,
          },
        }),
      });

      return trophy;
    });
  }),

  updateTrophy: adminProcedure.input(playerTrophyUpdateSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.trophy.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        playerId: true,
        seasonLabel: true,
        teamLabel: true,
        seasonId: true,
        teamId: true,
        name: true,
        description: true,
        awardedAt: true,
      },
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Trophy not found.' });
    }

    return ctx.prisma.$transaction(async (tx) => {
      const updated = await tx.trophy.update({
        where: { id: input.id },
        data: {
          seasonLabel: input.seasonLabel,
          teamLabel: input.teamLabel ?? null,
          // Migrate legacy FK-based rows to free-text on edit.
          seasonId: null,
          teamId: null,
          name: input.name,
          awardedAt: input.awardedAt,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        select: {
          id: true,
          playerId: true,
          seasonLabel: true,
          teamLabel: true,
          name: true,
        },
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'UPDATE',
          entity: 'Trophy',
          entityId: input.id,
          details: {
            before: existing,
            after: updated,
          },
        }),
      });

      return updated;
    });
  }),

  deleteTrophy: adminProcedure.input(playerTrophyDeleteSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.trophy.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        playerId: true,
        name: true,
        seasonId: true,
      },
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Trophy not found.' });
    }

    return ctx.prisma.$transaction(async (tx) => {
      await tx.trophy.delete({
        where: { id: input.id },
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'DELETE',
          entity: 'Trophy',
          entityId: input.id,
          details: existing,
        }),
      });

      return { success: true };
    });
  }),
});
