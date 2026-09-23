import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import sirv from "sirv";
import { phase3ReviewApiPlugin } from "./server/reviewApiPlugin";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const tilesRoot = path.join(repoRoot, "infrastructure/tiles/pmtiles");
const fontsRoot = path.join(repoRoot, "apps/web/public/fonts");

function localAssetsPlugin(): Plugin {
  return {
    name: "phase3-local-map-assets",
    configureServer(server) {
      // Range-capable static serving for optional local PMTiles fallback + Myanmar glyphs.
      server.middlewares.use(
        "/local-tiles",
        sirv(tilesRoot, { dev: true, etag: true, extensions: [] }),
      );
      server.middlewares.use("/fonts", sirv(fontsRoot, { dev: true, etag: true, extensions: [] }));
      // Same production manifest path the public web map uses (CDN URLs inside).
      server.middlewares.use(
        "/basemaps",
        sirv(path.join(repoRoot, "apps/web/public/basemaps"), {
          dev: true,
          etag: true,
          extensions: [],
        }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), localAssetsPlugin(), phase3ReviewApiPlugin()],
  server: {
    port: 5188,
    strictPort: true,
    fs: {
      allow: [repoRoot, path.resolve(import.meta.dirname)],
    },
  },
});
