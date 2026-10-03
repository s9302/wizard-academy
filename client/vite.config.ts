import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2022",
    // ~4.9 MB (1.8 MB gzipped): mostly the Rapier physics engine, whose
    // WebAssembly is embedded in the JS by the "-compat" package. Fine for a
    // game that loads once; Caddy compresses it on the way out.
    chunkSizeWarningLimit: 6000,
  },
  server: {
    host: true,
    // In development (npm run dev:client), forward /ws to the game server.
    proxy: { "/ws": { target: "ws://localhost:3000", ws: true } },
  },
});
