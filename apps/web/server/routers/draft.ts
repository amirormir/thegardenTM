import { TRPCError } from '@trpc/server';
import {
  draftCreateSchema,
  draftEligibleMatchesSchema,
  draftIdSchema,
  draftListInputSchema,
} from '@/lib/validators/draft';
import { fetchLatestPatchVersion } from '@/lib/riot/data-dragon';
import { callRealtimeControl, type RealtimeControlAction } from '@/lib/realtime-client';
import type { TRPCContext } from '@/server/context';
import { buildAuditLogInput } from '@/server/utils/audit';
import {
  adminProcedure,
  captainProcedure,
  createTRPCRouter,
  publicProcedure,
} from '@/server/trpc';

const draftListSelect = {
  id: true,
  matchId: true,
  seasonId: true,
  format: true,
  fearless: true,
  gameNumber: true,
  patchVersion: true,
  status: true,
  currentStep: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  coinflipWinnerTeamId: true,
  coinflipDecision: true,
  coinflipLoserDecision: true,
  coinflipResolvedAt: true,
  firstPickSide: true,
  blueResultVote: true,
  redResultVote: true,
  winnerSide: true,
  winnerTeamId: true,
  resultLockedAt: true,
  blueTeam: { select: { id: true, name: true, shortCode: true, slug: true, logoUrl: true } },
  redTeam: { select: { id: true, name: true, shortCode: true, slug: true, logoUrl: true } },
  season: { select: { id: true, name: true, slug: true, year: true } },
  match: { select: { id: true, scheduledAt: true } },
} as const;

const teamRosterSelect = {
  id: true,
  name: true,
  shortCode: true,
  slug: true,
  logoUrl: true,
  players: {
    where: { isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      slug: true,
      role: true,
      teamRole: true,
      imageUrl: true,
    },
    orderBy: { role: 'asc' as const },
  },
} as const;

const draftDetailSelect = {
  ...draftListSelect,
  blueTeam: { select: teamRosterSelect },
  redTeam: { select: teamRosterSelect },
  match: {
    select: {
      id: true,
      scheduledAt: true,
      format: true,
      drafts: {
        select: {
          id: true,
          gameNumber: true,
          status: true,
          coinflipWinnerTeamId: true,
          coinflipDecision: true,
          coinflipResolvedAt: true,
          winnerSide: true,
          winnerTeamId: true,
          blueTeam: { select: teamRosterSelect },
          redTeam: { select: teamRosterSelect },
        },
        orderBy: { gameNumber: 'asc' },
      },
    },
  },
  createdBy: { select: { id: true, name: true } },
  actions: {
    select: {
      id: true,
      step: true,
      type: true,
      side: true,
      championId: true,
      championName: true,
      wasAutoPicked: true,
      lockedAt: true,
    },
    orderBy: { step: 'asc' as const },
  },
  participants: {
    select: {
      id: true,
      userId: true,
      role: true,
      joinedAt: true,
      leftAt: true,
      user: { select: { id: true, name: true, image: true } },
    },
  },
} as const;

const STATUS_PRIORITY: Record<string, number> = {
  IN_PROGRESS: 0,
  COINFLIP: 1,
  PAUSED: 2,
  LOBBY: 3,
  COMPLETED: 4,
  CANCELLED: 5,
};

export const draftRouter = createTRPCRouter({
  list: publicProcedure.input(draftListInputSchema).query(async ({ ctx, input }) => {
    const limit = input?.limit ?? 50;
    const drafts = await ctx.prisma.draft.findMany({
      where: {
        ...(input?.status && input.status.length > 0 ? { status: { in: input.status } } : {}),
        ...(input?.seasonId ? { seasonId: input.seasonId } : {}),
        ...(input?.format ? { format: input.format } : {}),
        ...(input?.gameNumber ? { gameNumber: input.gameNumber } : {}),
        ...(input?.teamId
          ? {
              OR: [{ blueTeamId: input.teamId }, { redTeamId: input.teamId }],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: draftListSelect,
    });

    return drafts.sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 99;
      const pb = STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }),

  byId: publicProcedure.input(draftIdSchema).query(async ({ ctx, input }) => {
    const draft = await ctx.prisma.draft.findUnique({
      where: { id: input.id },
      select: draftDetailSelect,
    });

    if (!draft) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft introuvable.' });
    }

    return draft;
  }),

  eligibleMatches: adminProcedure
    .input(draftEligibleMatchesSchema)
    .query(async ({ ctx, input }) => {
      const seasonId =
        input?.seasonId ??
        (await ctx.prisma.season
          .findFirst({ where: { isCurrent: true }, select: { id: true } })
          .then((s) => s?.id));

      if (!seasonId) {
        return [];
      }

      return ctx.prisma.match.findMany({
        where: { seasonId, isCompleted: false },
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true,
          format: true,
          scheduledAt: true,
          homeTeam: { select: { id: true, name: true, shortCode: true, slug: true, logoUrl: true } },
          awayTeam: { select: { id: true, name: true, shortCode: true, slug: true, logoUrl: true } },
          season: { select: { id: true, name: true } },
          drafts: {
            select: { id: true, gameNumber: true, status: true },
            orderBy: { gameNumber: 'asc' },
          },
        },
      });
    }),

  create: adminProcedure.input(draftCreateSchema).mutation(async ({ ctx, input }) => {
    const match = await ctx.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        seasonId: true,
        format: true,
        homeTeamId: true,
        awayTeamId: true,
        isCompleted: true,
      },
    });

    if (!match) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Match introuvable.' });
    }

    if (match.isCompleted) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Ce match est déjà terminé.',
      });
    }

    if (match.homeTeamId === match.awayTeamId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Les deux équipes doivent être différentes.',
      });
    }

    const format = input.format ?? match.format;
    const maxGames = format === 'BO5' ? 5 : format === 'BO3' ? 3 : 1;
    if (input.gameNumber > maxGames) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `gameNumber dépasse le format ${format}.`,
      });
    }

    const conflict = await ctx.prisma.draft.findFirst({
      where: {
        matchId: match.id,
        gameNumber: input.gameNumber,
        status: { notIn: ['CANCELLED'] },
      },
      select: { id: true, status: true },
    });

    if (conflict) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Un draft existe déjà pour ce match (game ${input.gameNumber}).`,
      });
    }

    const blueTeamId = input.blueSide === 'HOME' ? match.homeTeamId : match.awayTeamId;
    const redTeamId = input.blueSide === 'HOME' ? match.awayTeamId : match.homeTeamId;

    const patchVersion = await fetchLatestPatchVersion();

    const created = await ctx.prisma.$transaction(async (tx) => {
      const draft = await tx.draft.create({
        data: {
          matchId: match.id,
          seasonId: match.seasonId,
          format,
          fearless: input.fearless,
          gameNumber: input.gameNumber,
          patchVersion,
          blueTeamId,
          redTeamId,
          createdById: ctx.session.user.id,
        },
        select: draftDetailSelect,
      });

      await tx.auditLog.create({
        data: buildAuditLogInput({
          userId: ctx.session.user.id,
          action: 'CREATE',
          entity: 'Draft',
          entityId: draft.id,
          details: {
            matchId: match.id,
            seasonId: match.seasonId,
            format,
            gameNumber: input.gameNumber,
            fearless: input.fearless,
            blueTeamId,
            redTeamId,
            patchVersion,
          },
        }),
      });

      return draft;
    });

    return created;
  }),

  start: captainProcedure.input(draftIdSchema).mutation(async ({ ctx, input }) => {
    return controlDraft(ctx, input.id, 'start');
  }),

  pause: captainProcedure.input(draftIdSchema).mutation(async ({ ctx, input }) => {
    return controlDraft(ctx, input.id, 'pause');
  }),

  resume: captainProcedure.input(draftIdSchema).mutation(async ({ ctx, input }) => {
    return controlDraft(ctx, input.id, 'resume');
  }),

  cancel: adminProcedure.input(draftIdSchema).mutation(async ({ ctx, input }) => {
    return controlDraft(ctx, input.id, 'cancel');
  }),
});

type AuthedContext = TRPCContext & { session: NonNullable<TRPCContext['session']> };

async function controlDraft(
  ctx: AuthedContext,
  draftId: string,
  action: RealtimeControlAction,
) {
  const draft = await ctx.prisma.draft.findUnique({
    where: { id: draftId },
    select: { blueTeamId: true, redTeamId: true },
  });

  if (!draft) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft introuvable.' });
  }

  if (ctx.session.user.role !== 'ADMIN') {
    const teamId = ctx.session.user.teamId;
    if (teamId !== draft.blueTeamId && teamId !== draft.redTeamId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Vous ne participez pas à ce draft.' });
    }
  }

  const result = await callRealtimeControl(draftId, action);
  if (!result.ok) {
    const code =
      result.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : result.code === 'CONFLICT'
          ? 'CONFLICT'
          : 'INTERNAL_SERVER_ERROR';
    throw new TRPCError({
      code,
      message: result.message ?? `Realtime ${action} failed.`,
    });
  }

  return { ok: true as const };
}
