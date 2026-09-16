/**
 * Measure lifecycle MVT tile cost against local tile_source (Windows Postgres).
 *
 * Usage (from apps/api, with LOCAL_TILE_DATABASE_URL set and Postgres up):
 *   npx tsx src/modules/local-basemap/measure-lifecycle-mvt.ts
 *
 * Reports feature count, payload bytes, and response time for representative tiles.
 * Does not print secrets.
 */
import pg from "pg";

import {
    countLifecycleFeaturesInTile,
    queryLifecycleMvt,
    type LifecycleMvtEntity,
} from "./local-basemap.mvt.js";

type Sample = {
    label: string;
    entity: LifecycleMvtEntity;
    z: number;
    x: number;
    y: number;
};

/**
 * Approximate WebMercator samples for the Dev Map perf checklist:
 * dense Yangon, Mandalay urban, sparse rural, large land, buildings z14 gate.
 */
const SAMPLES: Sample[] = [
    { label: "dense Yangon buildings z15", entity: "buildings", z: 15, x: 26120, y: 14840 },
    { label: "Mandalay buildings z15", entity: "buildings", z: 15, x: 25970, y: 14590 },
    { label: "rural buildings z15", entity: "buildings", z: 15, x: 25500, y: 14500 },
    { label: "large land tile z10", entity: "land", z: 10, x: 816, y: 463 },
    { label: "Yangon land z12", entity: "land", z: 12, x: 3265, y: 1855 },
    { label: "buildings z14 (core+archive only)", entity: "buildings", z: 14, x: 13060, y: 7420 },
    { label: "buildings z12 (should be empty)", entity: "buildings", z: 12, x: 3265, y: 1855 },
    { label: "land z8 (should be empty)", entity: "land", z: 8, x: 204, y: 115 },
];

async function main(): Promise<void> {
    const url = (process.env.LOCAL_TILE_DATABASE_URL || process.env.COREMAP_TILES_DATABASE_URL || "").trim();
    if (!url) {
        console.error("LOCAL_TILE_DATABASE_URL is not set.");
        process.exit(1);
    }

    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
        await pool.query("SELECT 1");
    } catch (err) {
        console.error("Cannot connect to local tiles DB:", err instanceof Error ? err.message : err);
        console.error("Start Windows Postgres / port-forward, then re-run.");
        await pool.end().catch(() => undefined);
        process.exit(2);
    }

    console.log("Lifecycle MVT performance samples");
    console.log("entity\tz\tx\ty\tfeatures\tbytes\tms\tlabel");

    for (const sample of SAMPLES) {
        const t0 = performance.now();
        const tile = await queryLifecycleMvt(pool, sample.entity, sample.z, sample.x, sample.y);
        const ms = Math.round(performance.now() - t0);
        const { count } = await countLifecycleFeaturesInTile(
            pool,
            sample.entity,
            sample.z,
            sample.x,
            sample.y,
        );
        console.log(
            `${sample.entity}\t${sample.z}\t${sample.x}\t${sample.y}\t${count}\t${tile.byteLength}\t${ms}\t${sample.label}`,
        );
    }

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
