import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");

export function syncLocalTileDatasets(
    datasets: string[],
    env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolvePromise) => {
        const child = spawn("npm", ["run", "tiles:sync", "--", ...datasets], {
            cwd: repoRoot,
            env: { ...env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        child.stdout?.on("data", (chunk) => {
            out += String(chunk);
        });
        child.stderr?.on("data", (chunk) => {
            out += String(chunk);
        });
        child.on("error", (error) => {
            resolvePromise({ ok: false, detail: error.message });
        });
        child.on("close", (code) => {
            resolvePromise({
                ok: code === 0,
                detail: code === 0 ? "ok" : out.trim().slice(-500) || `exit ${code}`,
            });
        });
    });
}
