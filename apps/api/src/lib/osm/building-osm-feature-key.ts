/**
 * Building OSM identity for promote-to-Core.
 * Aligns with tools/data-pipeline/local-osm/source-identity.ts
 * (osm:way:123 ≡ osm:W:123 ≡ way + 123). Buildings are way/relation only.
 */

export type BuildingOsmFeatureType = "way" | "relation";

export type BuildingOsmFeatureKey = {
    featureKey: string;
    sourceFeatureType: BuildingOsmFeatureType;
    sourceFeatureId: bigint;
};

function canonicalOsmType(token: string): "node" | "way" | "relation" | null {
    const raw = token.trim().toLowerCase();
    if (raw === "n" || raw === "node") {
        return "node";
    }
    if (raw === "w" || raw === "way") {
        return "way";
    }
    if (raw === "r" || raw === "rel" || raw === "relation") {
        return "relation";
    }
    return null;
}

export function parseBuildingOsmFeatureKey(
    value: string | null | undefined
): BuildingOsmFeatureKey | null {
    if (value == null) {
        return null;
    }
    let raw = String(value).trim();
    if (raw === "") {
        return null;
    }
    if (raw.toLowerCase().startsWith("osm:")) {
        raw = raw.slice(4);
    }
    raw = raw.replaceAll("/", ":");
    const parts = raw.split(":");
    if (parts.length < 2) {
        return null;
    }
    const type = canonicalOsmType(parts[0] ?? "");
    const id = (parts[1] ?? "").trim();
    if (type !== "way" && type !== "relation") {
        return null;
    }
    if (id === "" || !/^[1-9][0-9]*$/.test(id)) {
        return null;
    }
    return {
        featureKey: `osm:${type}:${id}`,
        sourceFeatureType: type,
        sourceFeatureId: BigInt(id),
    };
}
