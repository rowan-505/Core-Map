import { z } from "zod";

export const COMMUNITY_FEEDS = ["latest", "trusted"] as const;
export const COMMUNITY_REACTIONS = ["confirm", "helpful", "incorrect"] as const;
export const COMMUNITY_PAGE_SIZE = 20;
export const COMMUNITY_MAX_PAGE_SIZE = 50;

export const COMMUNITY_MODERATION_ACTIONS = [
    "verify",
    "unverify",
    "reject",
    "resolve",
    "expire",
    "remove",
    "reopen",
] as const;

const uuidSchema = z.string().trim().uuid();

export const communityPostPublicIdParamSchema = z.object({
    publicId: uuidSchema,
});

export const communityListQuerySchema = z
    .object({
        feed: z.enum(COMMUNITY_FEEDS).default("latest"),
        cursor: z.string().trim().min(1).max(2_000).optional(),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(COMMUNITY_MAX_PAGE_SIZE)
            .default(COMMUNITY_PAGE_SIZE),
        category: z.string().trim().min(1).max(120).optional(),
        /** west,south,east,north — only matches posts that have a location */
        bbox: z.string().trim().min(1).max(120).optional(),
    })
    .superRefine((value, ctx) => {
        if (!value.bbox) return;
        const parts = value.bbox.split(",").map((part) => Number(part.trim()));
        if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["bbox"],
                message: "bbox must be west,south,east,north numbers",
            });
            return;
        }
        const [west, south, east, north] = parts;
        if (west! >= east! || south! >= north!) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["bbox"],
                message: "bbox requires west < east and south < north",
            });
        }
        if (west! < -180 || east! > 180 || south! < -90 || north! > 90) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["bbox"],
                message: "bbox coordinates out of range",
            });
        }
    });

export const myCommunityPostsQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(2_000).optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(COMMUNITY_MAX_PAGE_SIZE)
        .default(COMMUNITY_PAGE_SIZE),
});

export const COMMUNITY_ADMIN_SORTS = ["published_at_desc", "published_at_asc"] as const;

export const adminCommunityPostsQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(2_000).optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(COMMUNITY_MAX_PAGE_SIZE)
        .default(COMMUNITY_PAGE_SIZE),
    publicationStatus: z
        .enum(["published", "resolved", "expired", "rejected", "removed"])
        .optional(),
    verificationStatus: z
        .enum(["unverified", "community_confirmed", "admin_verified"])
        .optional(),
    /** Published posts that are Community Confirmed or CoreMap Verified. */
    trustedOnly: z
        .union([z.literal("true"), z.literal("false"), z.boolean()])
        .optional()
        .transform((value) => value === true || value === "true"),
    /**
     * Closed workflow: resolved | expired | rejected | removed.
     * Ignored when publicationStatus is set.
     */
    closedOnly: z
        .union([z.literal("true"), z.literal("false"), z.boolean()])
        .optional()
        .transform((value) => value === true || value === "true"),
    category: z.string().trim().min(1).max(120).optional(),
    /** Case-insensitive match on title, description, or author display name. */
    search: z.string().trim().min(1).max(200).optional(),
    sort: z.enum(COMMUNITY_ADMIN_SORTS).default("published_at_desc"),
});

const locationBodySchema = z
    .object({
        lng: z.number().finite().gte(-180).lte(180),
        lat: z.number().finite().gte(-90).lte(90),
        label: z.string().trim().max(240).optional(),
    })
    .strict();

export const createCommunityPostBodySchema = z
    .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(5_000),
        category: z.string().trim().min(1).max(120),
        location: locationBodySchema.nullable().optional(),
    })
    .strict();

export const patchCommunityPostBodySchema = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().min(1).max(5_000).optional(),
        category: z.string().trim().min(1).max(120).optional(),
        location: locationBodySchema.nullable().optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.title !== undefined ||
            value.description !== undefined ||
            value.category !== undefined ||
            value.location !== undefined,
        { message: "At least one field is required" }
    );

export const putCommunityReactionBodySchema = z
    .object({
        reactionType: z.enum(COMMUNITY_REACTIONS),
    })
    .strict();

export const adminModerationBodySchema = z
    .object({
        note: z.string().trim().max(1_000).optional(),
    })
    .strict();

export const adminModerationActionParamSchema = z.object({
    publicId: uuidSchema,
    action: z.enum(COMMUNITY_MODERATION_ACTIONS),
});

type CommunityCursor = {
    v: 1;
    publishedAt: string;
    publicId: string;
};

export class InvalidCommunityCursorError extends Error {
    constructor() {
        super("Invalid community cursor");
        this.name = "InvalidCommunityCursorError";
    }
}

export function encodeCommunityCursor(input: {
    publishedAt: Date;
    publicId: string;
}): string {
    const payload: CommunityCursor = {
        v: 1,
        publishedAt: input.publishedAt.toISOString(),
        publicId: input.publicId,
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCommunityCursor(cursor: string): {
    publishedAt: Date;
    publicId: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
        throw new InvalidCommunityCursorError();
    }

    const parsed = z
        .object({
            v: z.literal(1),
            publishedAt: z.string().datetime({ offset: true }),
            publicId: uuidSchema,
        })
        .safeParse(value);

    if (!parsed.success) {
        throw new InvalidCommunityCursorError();
    }

    return {
        publishedAt: new Date(parsed.data.publishedAt),
        publicId: parsed.data.publicId,
    };
}

export function parseBbox(bbox: string): {
    west: number;
    south: number;
    east: number;
    north: number;
} {
    const [west, south, east, north] = bbox.split(",").map((part) => Number(part.trim()));
    return { west: west!, south: south!, east: east!, north: north! };
}

export type CommunityListQuery = z.infer<typeof communityListQuerySchema>;
export type CreateCommunityPostBody = z.infer<typeof createCommunityPostBodySchema>;
export type PatchCommunityPostBody = z.infer<typeof patchCommunityPostBodySchema>;
