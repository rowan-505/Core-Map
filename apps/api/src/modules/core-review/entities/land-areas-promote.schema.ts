import { z } from "zod";

import { polygonOrMultiPolygonSchema } from "../../../lib/geo/core-geometry.schema.js";
import { parseBuildingOsmFeatureKey } from "../../../lib/osm/building-osm-feature-key.js";

export const promoteOsmLandAreaBodySchema = z
    .object({
        feature_key: z.string().trim().min(1),
        local_source: z.enum(["archive", "base"]),
        geometry: polygonOrMultiPolygonSchema,
        class_code: z.string().trim().min(1),
        name: z.string().trim().min(1).nullable().optional(),
        name_mm: z.string().trim().min(1).nullable().optional(),
        name_en: z.string().trim().min(1).nullable().optional(),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (!parseBuildingOsmFeatureKey(body.feature_key)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["feature_key"],
                message:
                    "feature_key must be a canonical land OSM identity (osm:way:<id> or osm:relation:<id>).",
            });
        }
    });

export const demoteOsmLandAreaBodySchema = z
    .object({
        feature_key: z.string().trim().min(1),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (!parseBuildingOsmFeatureKey(body.feature_key)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["feature_key"],
                message:
                    "feature_key must be a canonical land OSM identity (osm:way:<id> or osm:relation:<id>).",
            });
        }
    });

export type PromoteOsmLandAreaBody = z.infer<typeof promoteOsmLandAreaBodySchema>;
export type DemoteOsmLandAreaBody = z.infer<typeof demoteOsmLandAreaBodySchema>;

export const deleteOsmLandAreaBodySchema = z
    .object({
        feature_key: z.string().trim().min(1),
        confirm: z.literal("DELETE"),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (!parseBuildingOsmFeatureKey(body.feature_key)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["feature_key"],
                message:
                    "feature_key must be a canonical land OSM identity (osm:way:<id> or osm:relation:<id>).",
            });
        }
    });

export const clearLandAreaRenderSuppressionBodySchema = z
    .object({
        feature_key: z.string().trim().min(1),
        confirm: z.literal("CLEAR_SUPPRESSION"),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (!parseBuildingOsmFeatureKey(body.feature_key)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["feature_key"],
                message:
                    "feature_key must be a canonical land OSM identity (osm:way:<id> or osm:relation:<id>).",
            });
        }
    });

export type DeleteOsmLandAreaBody = z.infer<typeof deleteOsmLandAreaBodySchema>;
export type ClearLandAreaRenderSuppressionBody = z.infer<typeof clearLandAreaRenderSuppressionBodySchema>;
