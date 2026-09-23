import { z } from "zod";

/** Report category codes — must match the seeded ref.ref_report_types rows. */
export const REPORT_TYPE_CODES = [
    "wrong_info",
    "wrong_location",
    "missing_item",
    "closed_or_removed",
    "duplicate_item",
    "transport_issue",
    "community_info",
    "other_map_issue",
    "new_stop",
    "tourism_incorrect_type",
    "tourism_incorrect_description",
    "tourism_incorrect_price",
    "tourism_incorrect_review",
    "tourism_other",
] as const;

/** Lifecycle status codes — must match the seeded ref.ref_report_statuses rows. */
export const REPORT_STATUS_CODES = [
    "submitted",
    "in_review",
    "needs_more_info",
    "accepted",
    "rejected",
    "duplicate",
    "resolved",
] as const;

export const REPORT_SOURCE_CODES = ["public", "field_survey"] as const;

export const ADMIN_REPORT_TARGET_ENTITY_TYPES = [
    "place",
    "street",
    "building",
    "bus_stop",
    "bus_route",
    "map_point",
    "tourism_review",
    "stop",
    "route",
    "variant",
    "path",
] as const;

export const FIELD_VARIANT_FILTER_CODES = ["D0", "D1"] as const;

/**
 * Reason codes accepted by the report reward endpoint. Must be a subset of the
 * contrib.point_ledger reason_code CHECK (see migration 113). For a normal reward
 * from an accepted report, prefer `valid_report` or `useful_correction`.
 */
export const REPORT_REWARD_REASON_CODES = [
    "valid_report",
    "useful_correction",
    "useful_photo",
    "admin_adjustment",
    "reversal",
    "spam_penalty",
    "false_report_penalty",
] as const;

/** Target kinds supported by the MVP report flow. */
export const REPORT_TARGET_ENTITY_TYPES = [
    "place",
    "street",
    "building",
    "bus_stop",
    "bus_route",
    "map_point",
    "tourism_review",
] as const;

export const reportCreateBodySchema = z
    .object({
        reportTypeCode: z.enum(REPORT_TYPE_CODES),
        reasonCode: z.string().trim().min(1).max(120).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().min(1).max(4000),
        targetEntityType: z.enum(REPORT_TARGET_ENTITY_TYPES),
        targetEntityId: z.number().int().positive().optional(),
        targetPublicId: z.string().trim().uuid().optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        // Required for anonymous reports (may also arrive via the x-anonymous-id header).
        anonymousId: z.string().trim().min(1).max(128).optional(),
    })
    .superRefine((value, ctx) => {
        if (value.targetEntityType === "map_point") {
            if (value.latitude === undefined || value.longitude === undefined) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["latitude"],
                    message: "latitude and longitude are required for map_point targets",
                });
            }
        } else if (value.targetEntityType === "tourism_review") {
            if (!value.targetPublicId) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["targetPublicId"],
                    message: "targetPublicId is required for tourism_review targets",
                });
            }
        } else if (value.targetEntityId === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["targetEntityId"],
                message: "targetEntityId is required for entity targets",
            });
        }
        // A coordinate pair must be complete when either side is present.
        const hasLat = value.latitude !== undefined;
        const hasLng = value.longitude !== undefined;
        if (hasLat !== hasLng) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["longitude"],
                message: "latitude and longitude must be provided together",
            });
        }
    });

export type ReportCreateBody = z.infer<typeof reportCreateBodySchema>;

export const followupBodySchema = z.object({
    message: z.string().trim().min(1).max(2000),
});

export type FollowupBody = z.infer<typeof followupBodySchema>;

export const adminStatusBodySchema = z.object({
    statusCode: z.enum(REPORT_STATUS_CODES),
    note: z.string().trim().max(1000).optional(),
});

export const adminRequestInfoBodySchema = z.object({
    message: z.string().trim().min(1).max(2000),
});

export const adminNoteBodySchema = z.object({
    adminNote: z.string().trim().max(2000).nullable(),
});

export const rewardPointsBodySchema = z.object({
    // Positive for a reward; negative is allowed for penalty/reversal reason codes.
    pointsDelta: z
        .number()
        .int()
        .gte(-1_000_000)
        .lte(1_000_000)
        .refine((value) => value !== 0, "pointsDelta must be non-zero"),
    reasonCode: z.enum(REPORT_REWARD_REASON_CODES),
    note: z.string().trim().max(1000).optional(),
});

/** Apply request: action + revision only. Targets/coords/names come from trusted report data. */
export const REPORT_APPLY_ACTION_CODES = [
    "MOVE_STOP",
    "REMOVE_FROM_ROUTE",
    "CREATE_AND_INSERT_STOP",
    "UPDATE_STOP_DETAILS",
    "OPEN_ROUTE_EDITOR",
    "RESOLVE",
    "REJECT",
] as const;

export const adminApplyBodySchema = z
    .object({
        action: z.enum(REPORT_APPLY_ACTION_CODES),
        expectedCanonicalRevision: z.string().trim().min(1).max(80),
    })
    .strict();

export type AdminApplyBody = z.infer<typeof adminApplyBodySchema>;

export const reportPublicIdParamSchema = z.object({
    publicId: z.string().trim().uuid(),
});

/** Admin routes reference reports by their public_id (never the internal numeric id). */
export const adminReportIdParamSchema = z.object({
    id: z.string().trim().uuid(),
});

export const myReportsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminReportsQuerySchema = z.object({
    status: z.enum(REPORT_STATUS_CODES).optional(),
    type: z.enum(REPORT_TYPE_CODES).optional(),
    adminAreaId: z.coerce.number().int().positive().optional(),
    targetEntityType: z.enum(ADMIN_REPORT_TARGET_ENTITY_TYPES).optional(),
    source: z.enum(REPORT_SOURCE_CODES).optional(),
    routeCode: z.string().trim().min(1).max(40).optional(),
    variantCode: z.enum(FIELD_VARIANT_FILTER_CODES).optional(),
    // "true"/"false" query param → boolean (avoids z.coerce.boolean's "false" pitfall).
    anonymous: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => (value === undefined ? undefined : value === "true")),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;

export const ADMIN_REPORT_REVIEW_ACTION_CODES = [
    "RENAME_STOP",
    "MOVE_STOP",
    "CREATE_STOP_AND_INSERT",
    "INSERT_EXISTING_STOP",
    "REMOVE_STOP_FROM_VARIANT",
    "REORDER_ROUTE_STOP",
    "VERIFY_STOP",
    "REJECT_NO_CHANGE",
] as const;

const nullableUuidSchema = z.string().uuid().nullable();
const nullableDateTimeSchema = z.string().datetime().nullable();
const nullableFiniteSchema = z.number().finite().nullable();
const internalIdSchema = z.string().regex(/^\d+$/).nullable();

export const adminReportGeoPointSchema = z
    .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
    })
    .strict();

const adminReportComparisonValueSchema = z
    .object({
        name: z.string().nullable(),
        coordinates: adminReportGeoPointSchema.nullable(),
        sequence: z.number().int().nullable(),
    })
    .strict();

const adminReportTransportStopSchema = z
    .object({
        id: internalIdSchema,
        publicId: nullableUuidSchema,
        name: z.string().nullable(),
        coordinates: adminReportGeoPointSchema.nullable(),
        sequence: z.number().int().nullable(),
    })
    .strict();

const adminReportRouteSchema = z
    .object({
        id: internalIdSchema,
        publicId: nullableUuidSchema,
        code: z.string().nullable(),
        name: z.string().nullable(),
    })
    .strict();

const adminReportVariantSchema = z
    .object({
        id: internalIdSchema,
        publicId: nullableUuidSchema,
        code: z.string().nullable(),
        direction: z.string().nullable(),
        originName: z.string().nullable(),
        destinationName: z.string().nullable(),
    })
    .strict();

const adminReportMediaSchema = z
    .object({
        publicId: z.string().uuid(),
        mimeType: z.string(),
        byteSize: z.number().int().nonnegative(),
        width: z.number().int().nonnegative().nullable(),
        height: z.number().int().nonnegative().nullable(),
        note: z.string().nullable(),
        sortOrder: z.number().int(),
        published: z.boolean(),
    })
    .strict();

const adminReportStatusEventSchema = z
    .object({
        oldStatusCode: z.string().nullable(),
        newStatusCode: z.string(),
        actorDisplayName: z.string().nullable(),
        note: z.string().nullable(),
        createdAt: z.string().datetime(),
    })
    .strict();

const adminReportFollowupSchema = z
    .object({
        actorType: z.string(),
        actorDisplayName: z.string().nullable(),
        message: z.string(),
        createdAt: z.string().datetime(),
    })
    .strict();

export const adminReportDetailResponseSchema = z
    .object({
        report: z
            .object({
                publicId: z.string().uuid(),
                sourceCode: z.enum(REPORT_SOURCE_CODES),
                reportTypeCode: z.enum(REPORT_TYPE_CODES),
                statusCode: z.enum(REPORT_STATUS_CODES),
                description: z.string(),
                observedAt: nullableDateTimeSchema,
                reporterName: z.string().nullable(),
                reporterPublicId: nullableUuidSchema,
                reporterEmail: z.string().email().nullable(),
                isAnonymous: z.boolean(),
                anonymousId: z.string().nullable(),
                eligibleForPoints: z.boolean(),
                rewardGrantedAt: nullableDateTimeSchema,
                title: z.string().nullable(),
                reasonCode: z.string().nullable(),
                targetEntityType: z.string().nullable(),
                targetEntityId: internalIdSchema,
                targetPublicId: nullableUuidSchema,
                reportedCoordinates: adminReportGeoPointSchema.nullable(),
                adminAreaId: internalIdSchema,
                adminAreaName: z.string().nullable(),
                priority: z.string(),
                confidenceScore: z.number().finite(),
                createdAt: z.string().datetime(),
                updatedAt: z.string().datetime(),
            })
            .strict(),
        resolvedTarget: z
            .object({
                entityType: z.string().nullable(),
                stopId: internalIdSchema,
                stopPublicId: nullableUuidSchema,
                routeId: internalIdSchema,
                routePublicId: nullableUuidSchema,
                routeVariantId: internalIdSchema,
                routeVariantPublicId: nullableUuidSchema,
                stopSequence: z.number().int().nullable(),
            })
            .strict(),
        comparison: z
            .object({
                snapshotRevision: z.string().nullable(),
                currentRevision: z.string().nullable(),
                isStale: z.boolean().nullable(),
                original: adminReportComparisonValueSchema.nullable(),
                current: adminReportComparisonValueSchema.nullable(),
                proposed: adminReportComparisonValueSchema.nullable(),
                proposedLocationSource: z.string().nullable(),
            })
            .strict(),
        observer: z
            .object({
                coordinates: adminReportGeoPointSchema,
                accuracyMetres: nullableFiniteSchema,
                distanceToCurrentStopMetres: nullableFiniteSchema,
                distanceToProposedPositionMetres: nullableFiniteSchema,
            })
            .strict()
            .nullable(),
        routeContext: z
            .object({
                route: adminReportRouteSchema.nullable(),
                variant: adminReportVariantSchema.nullable(),
                previousStop: adminReportTransportStopSchema.nullable(),
                currentStop: adminReportTransportStopSchema.nullable(),
                nextStop: adminReportTransportStopSchema.nullable(),
                insertion: z
                    .object({
                        afterStop: adminReportTransportStopSchema.nullable(),
                        beforeStop: adminReportTransportStopSchema.nullable(),
                    })
                    .strict()
                    .nullable(),
            })
            .strict()
            .nullable(),
        affectedRoutes: z.array(
            z
                .object({
                    routeId: internalIdSchema,
                    routePublicId: z.string().uuid(),
                    routeCode: z.string(),
                    routeName: z.string().nullable(),
                    routeVariantId: internalIdSchema,
                    routeVariantPublicId: z.string().uuid(),
                    variantCode: z.string(),
                    direction: z.string().nullable(),
                    sequence: z.number().int(),
                })
                .strict()
        ),
        evidence: z
            .object({
                media: z.array(adminReportMediaSchema),
            })
            .strict(),
        review: z
            .object({
                allowedActions: z.array(z.enum(ADMIN_REPORT_REVIEW_ACTION_CODES)),
                suggestedAction: z.enum(ADMIN_REPORT_REVIEW_ACTION_CODES).nullable(),
                blockedReasons: z.array(z.string()),
            })
            .strict(),
        workflow: z
            .object({
                adminNote: z.string().nullable(),
                reviewedAt: nullableDateTimeSchema,
                statusEvents: z.array(adminReportStatusEventSchema),
                followups: z.array(adminReportFollowupSchema),
            })
            .strict(),
    })
    .strict();

export type AdminReportReviewActionCode =
    (typeof ADMIN_REPORT_REVIEW_ACTION_CODES)[number];
export type AdminReportDetailResponse = z.infer<
    typeof adminReportDetailResponseSchema
>;
