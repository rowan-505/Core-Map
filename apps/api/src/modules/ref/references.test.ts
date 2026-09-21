import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getReferenceConfig, isReferenceTypeKey, listReferenceConfigs } from "./references.registry.js";
import { ReferencesError, ReferencesService } from "./references.service.js";
import type { ReferencesRepository } from "./references.repo.js";
import { REFERENCE_TYPE_KEYS } from "./references.types.js";

describe("references registry", () => {
    it("rejects unknown types", () => {
        assert.equal(isReferenceTypeKey("languages"), false);
        assert.equal(isReferenceTypeKey("place-classes"), false);
        assert.equal(isReferenceTypeKey("validation-statuses"), false);
        assert.equal(isReferenceTypeKey("poi-categories"), true);
    });

    it("allowlists only ref tables with explicit keys", () => {
        const configs = listReferenceConfigs();
        assert.equal(configs.length, REFERENCE_TYPE_KEYS.length);
        for (const config of configs) {
            assert.match(config.table, /^ref_/);
            assert.ok(config.createSchema);
            assert.ok(config.patchSchema);
        }
    });

    it("keeps codes create-only in field metadata", () => {
        for (const config of listReferenceConfigs()) {
            const codeField = config.fields.find((f) => f.key === "code");
            assert.ok(codeField);
            assert.equal(codeField.createOnly, true);
            assert.notEqual(codeField.editable, true);
        }
    });
});

describe("references service", () => {
    function fakeRepo(overrides: Partial<ReferencesRepository> = {}): ReferencesRepository {
        return {
            countRows: async () => 3,
            list: async () => [{ id: "1", code: "demo", name: "Demo", usage_count: 0 }],
            countUsage: async () => 0,
            findById: async () => ({ id: "1", code: "demo", name: "Demo" }),
            existsId: async () => true,
            wouldCreateHierarchyCycle: async () => false,
            create: async (_c: unknown, data: Record<string, unknown>) => ({ id: "9", ...data }),
            update: async (_c: unknown, id: string, data: Record<string, unknown>) => ({
                id,
                code: "demo",
                ...data,
            }),
            ...overrides,
        } as unknown as ReferencesRepository;
    }

    it("returns 404 for unknown type", async () => {
        const service = new ReferencesService(fakeRepo());
        await assert.rejects(
            () => service.list("not-a-type"),
            (err: unknown) => err instanceof ReferencesError && err.statusCode === 404,
        );
    });

    it("rejects code changes on update", async () => {
        const service = new ReferencesService(fakeRepo());
        await assert.rejects(
            () => service.update("source-types", "1", { code: "new_code", name: "X" }),
            (err: unknown) =>
                err instanceof ReferencesError &&
                err.statusCode === 409 &&
                err.message.includes("immutable"),
        );
    });

    it("rejects self-parenting", async () => {
        const config = getReferenceConfig("poi-categories");
        assert.equal(config.hierarchical, true);
        const service = new ReferencesService(fakeRepo());
        await assert.rejects(
            () => service.update("poi-categories", "5", { parent_id: "5" }),
            (err: unknown) => err instanceof ReferencesError && err.statusCode === 409,
        );
    });

    it("maps unique violations to 409", async () => {
        const service = new ReferencesService(
            fakeRepo({
                create: async () => {
                    const error = Object.assign(new Error("duplicate"), { code: "23505" });
                    throw error;
                },
            }),
        );
        await assert.rejects(
            () => service.create("source-types", { code: "osm", name: "OSM" }),
            (err: unknown) => err instanceof ReferencesError && err.statusCode === 409,
        );
    });

    it("parses create payload for source-types", async () => {
        const service = new ReferencesService(fakeRepo());
        const row = await service.create("source-types", { code: "Field_Survey", name: " Field " });
        assert.equal(row.code, "field_survey");
        assert.equal(row.name, "Field");
    });
});
