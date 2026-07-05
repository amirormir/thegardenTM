import { z } from 'zod';

export const playerRoleSchema = z.enum(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
export const playerRolesSchema = z
  .array(playerRoleSchema)
  .min(1)
  .max(5)
  .refine((roles) => new Set(roles).size === roles.length, {
    message: 'Roles must be unique.',
  });

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : undefined))
  .optional();

const optionalNullableIdSchema = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const optionalImageUrlSchema = z
  .union([z.string().trim(), z.null()])
  .transform((value) => {
    if (value === null || value.length === 0) {
      return null;
    }

    return value;
  })
  .pipe(z.string().url().nullable())
  .optional();

export const playerIdSchema = z.object({
  id: z.string().min(1),
});

export const playerByTeamSchema = z.object({
  teamId: z.string().min(1),
});

export const PLAYER_LIST_MAX_LIMIT = 200;
export const PLAYER_LIST_DEFAULT_LIMIT = 100;
export const PLAYER_PAGE_SIZE = 30;
export const PLAYER_PAGE_MAX_SIZE = 60;

export const playerListQuerySchema = z.object({
  search: z.string().trim().min(1).max(50).optional(),
  role: playerRoleSchema.optional(),
  sort: z
    .enum(['marketValue-desc', 'marketValue-asc', 'salary-desc', 'salary-asc', 'name-asc'])
    .optional(),
  limit: z.number().int().positive().max(PLAYER_LIST_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});

export const playerPagedQuerySchema = z.object({
  search: z.string().trim().min(1).max(50).optional(),
  role: playerRoleSchema.optional(),
  sort: z
    .enum(['marketValue-desc', 'marketValue-asc', 'salary-desc', 'salary-asc', 'name-asc'])
    .optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(PLAYER_PAGE_MAX_SIZE).default(PLAYER_PAGE_SIZE),
});

const playerBaseInputSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  slug: z.string().min(1).max(60).optional(),
  gameName: z.string().min(1).max(40),
  tagLine: z.string().min(1).max(10),
  role: playerRoleSchema,
  secondaryRoles: z.array(playerRoleSchema).max(4).default([]),
  teamId: optionalNullableIdSchema,
  imageUrl: optionalImageUrlSchema,
  age: z.number().int().positive().max(99).optional(),
  nationality: optionalTrimmedString.pipe(z.string().min(2).max(50).optional()),
  marketValue: z.number().int().nonnegative(),
  salary: z.number().int().nonnegative(),
  cost: z.number().int().min(1).max(5).default(1),
  puuid: optionalTrimmedString.pipe(z.string().min(1).optional()),
  summonerId: optionalTrimmedString.pipe(z.string().min(1).optional()),
  isActive: z.boolean().optional(),
});

export const playerCreateSchema = playerBaseInputSchema.refine(
  (input) => !input.secondaryRoles.includes(input.role),
  {
    message: 'Primary role cannot be duplicated in secondary roles.',
    path: ['secondaryRoles'],
  },
);

export const playerUpdateSchema = playerBaseInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
  })
  .refine(
    (input) =>
      input.role === undefined ||
      input.secondaryRoles === undefined ||
      !input.secondaryRoles.includes(input.role),
    {
      message: 'Primary role cannot be duplicated in secondary roles.',
      path: ['secondaryRoles'],
    },
  );

export const playerDeleteSchema = z.object({
  id: z.string().min(1),
});

export const updateMarketValueSchema = z.object({
  playerId: z.string().min(1),
  newValue: z.number().int().nonnegative(),
  reason: z.string().min(1).max(255).optional(),
});

export const marketValueHistoryCreateSchema = z.object({
  playerId: z.string().min(1),
  newValue: z.number().int().nonnegative(),
  reason: optionalTrimmedString.pipe(z.string().max(255).optional()),
  changedAt: z.coerce.date(),
});

export const marketValueHistoryUpdateSchema = z.object({
  id: z.string().min(1),
  newValue: z.number().int().nonnegative(),
  reason: optionalTrimmedString.pipe(z.string().max(255).optional()),
  changedAt: z.coerce.date(),
});

export const marketValueHistoryDeleteSchema = z.object({
  id: z.string().min(1),
});

export const playerTrophyCreateSchema = z.object({
  playerId: z.string().min(1),
  seasonLabel: z.string().trim().min(1).max(120),
  teamLabel: optionalTrimmedString.pipe(z.string().max(120).optional()),
  name: z.string().trim().min(1).max(120),
  description: optionalTrimmedString.pipe(z.string().max(255).optional()),
  awardedAt: z.coerce.date(),
});

export const playerTrophyUpdateSchema = z.object({
  id: z.string().min(1),
  seasonLabel: z.string().trim().min(1).max(120),
  teamLabel: optionalTrimmedString.pipe(z.string().max(120).optional()),
  name: z.string().trim().min(1).max(120),
  description: optionalTrimmedString.pipe(z.string().max(255).optional()),
  awardedAt: z.coerce.date(),
});

export const playerTrophyDeleteSchema = z.object({
  id: z.string().min(1),
});
