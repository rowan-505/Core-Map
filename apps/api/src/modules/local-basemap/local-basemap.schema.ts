import { z } from "zod";

export const localBasemapEntityParamSchema = z.object({
    entity: z.enum(["buildings", "land"]),
});

export const localBasemapSearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
});

export const localBasemapFeatureKeyParamsSchema = localBasemapEntityParamSchema.extend({
    featureKey: z.string().trim().min(3).max(120),
});

/** Dev Map inspector does not need GeoJSON; Local Basemap admin map does. */
export const localBasemapFeatureDetailQuerySchema = z.object({
    includeGeometry: z
        .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
        .optional()
        .transform((value) => value === "1" || value === "true"),
});

export const localBasemapActionBodySchema = z.object({
    feature_key: z.string().trim().min(3).max(120),
    confirm: z.enum(["DELETE", "CLEAR_SUPPRESSION"]).optional(),
});
