import { z } from "zod";

export const postalCodeParamSchema = z.object({
    postalCode: z
        .string()
        .trim()
        .regex(/^[0-9]{7}$/, "postalCode must be exactly seven ASCII digits"),
});

export type PostalCodeParam = z.infer<typeof postalCodeParamSchema>;
