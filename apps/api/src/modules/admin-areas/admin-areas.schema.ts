import { z } from "zod";

export const adminAreasQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const adminAreaOptionsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(500),
    q: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional(),
    /**
     * Level filter for pickers:
     * - `state_region` — Region/State rows only
     * - `township` — township/town rows (place/road/building override + tourism filters)
     */
    admin_level_code: z.enum(["township", "state_region"]).optional(),
    /**
     * When set with `admin_level_code=township`, only townships that descend from this
     * Region/State (walks parent_id / child hierarchy).
     */
    region_admin_area_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "region_admin_area_id must be a numeric id")
        .optional(),
});

/** Road/street manual township override search (server-side, capped results). */
export const roadTownshipAdminAreaOptionsQuerySchema = z.object({
    q: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).default(50),
});
