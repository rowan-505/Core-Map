import { z } from "zod";

export const listFoodDrinkRecommendationsQuerySchema = z.object({
    township_admin_area_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "township_admin_area_id must be a numeric id"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    lang: z.enum(["my", "en"]).optional(),
    /** Optional map center for display distance only — never used in ranking. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
});

export type ListFoodDrinkRecommendationsQuery = z.infer<
    typeof listFoodDrinkRecommendationsQuerySchema
>;

export const listAdminFoodDrinkRecommendationsQuerySchema =
    listFoodDrinkRecommendationsQuerySchema;
