import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";

function bloopWasmDevPlugin(): Plugin {
  // adjust path to wherever engine builds the wasm
  const wasmPath = path.resolve(
    __dirname,
    "../../packages/engine/wasm/bloop.wasm"
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
        }
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), bloopWasmDevPlugin()],
  server: {
    allowedHosts: ["localhost", "bloop.ngrok.dev"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
