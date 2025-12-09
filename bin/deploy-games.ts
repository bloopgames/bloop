import { mkdir, cp, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.join(__dirname, "..");
const infraDir = path.join(rootDir, "infra");
const packagesDir = path.join(rootDir, "packages");
const gamesDir = path.join(rootDir, "games");

// Games to deploy (folder names under games/)
const games = ["buzzer", "mario"];

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log("=== Building packages ===");

  // Build engine wasm first
  console.log("Building engine wasm...");
  await $`zig build -p .`.cwd(path.join(packagesDir, "engine"));

  // Build bloop package
  console.log("Building bloop package...");
  await $`bun run build`.cwd(path.join(packagesDir, "bloop"));

  // Build web package
  console.log("Building web package...");
  await $`bun run build`.cwd(path.join(packagesDir, "web"));

  console.log("\n=== Building games ===");

  // Clean infra dist/neil folder
  const infraDistDir = path.join(infraDir, "dist");
  const neilDir = path.join(infraDistDir, "neil");
  await rm(neilDir, { recursive: true, force: true });

  // Build each game
  for (const game of games) {
    const gamePath = path.join(gamesDir, game);
    const deployPath = `neil/${game}`;
    const base = `/${deployPath}/`;

    console.log(`\nBuilding ${game} with base=${base}...`);
    await $`bun run build --base=${base}`.cwd(gamePath);

    // Copy wasm to game dist/assets (where the JS expects it via import.meta.url)
    const wasmSrc = path.join(packagesDir, "engine", "wasm", "bloop.wasm");
    const gameDist = path.join(gamePath, "dist");
    const wasmDest = path.join(gameDist, "assets", "bloop.wasm");
    console.log(`Copying wasm to ${wasmDest}...`);
    await cp(wasmSrc, wasmDest);

    // Copy game dist to infra dist
    const infraGameDist = path.join(infraDistDir, deployPath);
    console.log(`Copying ${gameDist} to ${infraGameDist}...`);
    await mkdir(infraGameDist, { recursive: true });
    await cp(gameDist, infraGameDist, { recursive: true });
  }

  console.log("\n=== Build complete ===");
  console.log("Games will be available at:");
  for (const game of games) {
    console.log(`  /neil/${game}/`);
  }

  if (isDryRun) {
    console.log("\n--dry-run specified, skipping deploy");
    return;
  }

  console.log("\n=== Deploying to fly.io ===");
  await $`fly deploy`.cwd(infraDir);

  console.log("\n=== Deploy complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
