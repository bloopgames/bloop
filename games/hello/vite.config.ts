import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin, type UserConfig } from "vite";

export default defineConfig({
  plugins: [bloopWasmDevPlugin()],
});

function bloopWasmDevPlugin(): Plugin {
  // adjust path to wherever engine builds the wasm
  const wasmPath = path.resolve(
    __dirname,
    "../../packages/engine/wasm/bloop.wasm",
  );

  return {
    name: "bloop-wasm-dev",
    config(): UserConfig {
      return {
        define: {
          "import.meta.env.VITE_ENGINE_WASM_URL": JSON.stringify(
            "/bloop-wasm/bloop.wasm",
          ),
        },
      };
    },
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
