import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

function bloopWasmDevPlugin(): Plugin {
  // adjust path to wherever engine builds the wasm
  const wasmPath = path.resolve(
    __dirname,
    "../../packages/engine/wasm/bloop.wasm",
  );

  return {
    name: "bloop-wasm-dev",
    configureServer(server) {
      server.middlewares.use(
        "/bloop-wasm/bloop.wasm",
        async (req, res, next) => {
          try {
            const data = await fs.readFile(wasmPath);
            res.setHeader("Content-Type", "application/wasm");
            res.end(data);
          } catch (err) {
            // so you can see useful errors if the path is wrong
            console.error("[bloop-wasm-dev] failed to read wasm", err);
            res.statusCode = 404;
            res.end("wasm not found");
          }
        },
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [bloopWasmDevPlugin()],
  server: {
    allowedHosts: ["localhost", "bloop.ngrok.dev"],
  },
  // JSX config for Preact - only needed when linking @bloopjs/web directly
  // via workspace:* in the monorepo. When published, the package will be
  // pre-built without JSX so consumers don't need this.
  esbuild: {
    jsxImportSource: "preact",
    jsx: "automatic",
  },
  optimizeDeps: {
    exclude: ["@bloopjs/engine", "@bloopjs/bloop", "@bloopjs/web"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
