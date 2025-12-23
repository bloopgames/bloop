import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin, type UserConfig } from "vite";

export default defineConfig({
  plugins: [bloopLocalDevPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        tapeLoad: path.resolve(__dirname, "tape-load.html"),
      },
    },
  },
});

/**
 * Vite plugin for local monorepo development with bloop packages.
 * Handles:
 * - Serving WASM from packages/engine
 * - JSX config for Preact (used by @bloopjs/web debug UI)
 * - Excluding workspace packages from optimization
 * - Allowed hosts for ngrok tunneling
 */
function bloopLocalDevPlugin(): Plugin {
  const wasmPath = path.resolve(
    __dirname,
    "../../packages/engine/wasm/bloop.wasm",
  );

  return {
    name: "bloop-local-dev",
    config(): UserConfig {
      return {
        define: {
          "import.meta.env.VITE_ENGINE_WASM_URL": JSON.stringify(
            "/bloop-wasm/bloop.wasm",
          ),
        },

        server: {
          allowedHosts: ["localhost", "bloop.ngrok.dev"],
        },
        esbuild: {
          jsxImportSource: "preact",
          jsx: "automatic",
        },
        optimizeDeps: {
          exclude: ["@bloopjs/engine", "@bloopjs/bloop", "@bloopjs/web"],
        },
      };
    },
    configureServer(server) {
      server.middlewares.use(
        "/bloop-wasm/bloop.wasm",
        async (_req, res, _next) => {
          try {
            const data = await fs.readFile(wasmPath);
            res.setHeader("Content-Type", "application/wasm");
            res.end(data);
          } catch (err) {
            console.error("[bloop-local-dev] failed to read wasm", err);
            res.statusCode = 404;
            res.end("wasm not found");
          }
        },
      );
    },
  };
}
