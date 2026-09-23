import type { FastifySchema } from "fastify";

import { Tags } from "../../lib/openapi/common.js";

export const getPostalCodeSchema: FastifySchema = {
    tags: [Tags.Search],
    summary: "Look up a Myanmar Post postal code",
    description:
        "Reads ref.ref_postal_codes (API-only reference table). Does not mutate core.core_addresses.",
    params: {
        type: "object",
        required: ["postalCode"],
        properties: {
            postalCode: {
                type: "string",
                pattern: "^[0-9]{7}$",
                description: "Seven-digit Myanmar Post code",
            },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["postal_code", "match_status", "source_name", "source_version"],
            properties: {
                postal_code: { type: "string" },
                region_name_en: { type: ["string", "null"] },
                region_name_my: { type: ["string", "null"] },
                township_name_en: { type: ["string", "null"] },
                township_name_my: { type: ["string", "null"] },
                locality_name_en: { type: ["string", "null"] },
                locality_name_my: { type: ["string", "null"] },
                locality_type: { type: ["string", "null"] },
                township_admin_area_id: { type: ["string", "null"] },
                local_admin_area_id: { type: ["string", "null"] },
                match_status: { type: "string" },
                match_method: { type: ["string", "null"] },
                source_name: { type: "string" },
                source_version: { type: "string" },
            },
        },
        400: {
            type: "object",
            properties: {
                message: { type: "string" },
                issues: {},
            },
        },
        404: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
    },
};
