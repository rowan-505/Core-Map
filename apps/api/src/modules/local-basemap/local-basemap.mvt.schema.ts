import { z } from "zod";

export const localBasemapLifecycleTileParamsSchema = z.object({
    /** URL segment: buildings_lifecycle | land_lifecycle */
    layer: z.enum(["buildings_lifecycle", "land_lifecycle"]),
    z: z.coerce.number().int().min(0).max(22),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
});

export function lifecycleEntityFromLayer(
    layer: "buildings_lifecycle" | "land_lifecycle",
): "buildings" | "land" {
    return layer === "buildings_lifecycle" ? "buildings" : "land";
}