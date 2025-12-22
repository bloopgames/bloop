import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

const ROOT = path.join(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages/create-bloop");
const TEMPLATES_DIR = path.join(PKG_DIR, "templates");

const isDryRun = process.argv.includes("--dry-run");

// Get current @bloopjs version from npm
async function getLatestVersion(packageName: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  const json = (await response.json()) as any;
  if (json.error === "Not found") {
    throw new Error(`${packageName} not found on npm`);
  }
  return json["dist-tags"]?.latest || "0.0.0";
}

// Transform package.json: replace workspace deps and set name placeholder
function transformPackageJson(content: string, bloopVersion: string): string {
  const pkg = JSON.parse(content);

  // Replace name with placeholder
  pkg.name = "{{name}}";

  // Replace workspace:* dependencies with actual version
  if (pkg.dependencies) {
    for (const [key, value] of Object.entries(pkg.dependencies)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        pkg.dependencies[key] = `^${bloopVersion}`;
      }
    }
  }

  return JSON.stringify(pkg, null, 2);
}

// Generate minimal vite.config.ts (no WASM plugin needed)
function generateViteConfig(): string {
  return `import { defineConfig } from "vite";

export default defineConfig({
  // WASM loads from CDN automatically via @bloopjs/engine
});
`;
}

async function main() {
  console.log("Publishing create-bloop...\n");

  // Get latest @bloopjs version
  const bloopVersion = await getLatestVersion("@bloopjs/bloop");
  console.log(`Using @bloopjs version: ${bloopVersion}`);

  // Clean and create templates dir
  await rm(TEMPLATES_DIR, { recursive: true, force: true });
  await mkdir(TEMPLATES_DIR, { recursive: true });

  // Copy and transform each game template
  for (const game of ["hello", "mario"]) {
    console.log(`\nProcessing template: ${game}`);
    const src = path.join(ROOT, "games", game);
    const dest = path.join(TEMPLATES_DIR, game);

    // Use git ls-files to get tracked files (respects .gitignore)
    const filesOutput = await $`git ls-files`.cwd(src).text();
    const files = filesOutput.trim().split("\n").filter(Boolean);

    console.log(`  Found ${files.length} files`);

    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      await mkdir(path.dirname(destPath), { recursive: true });

      // Apply transformations to specific files
      if (file === "package.json") {
        const content = await Bun.file(srcPath).text();
        await Bun.write(destPath, transformPackageJson(content, bloopVersion));
        console.log(`  Transformed: ${file}`);
      } else if (file === "vite.config.ts") {
        await Bun.write(destPath, generateViteConfig());
        console.log(`  Generated: ${file}`);
      } else {
        await cp(srcPath, destPath);
      }
    }
  }

  // Install dependencies
  console.log("\nInstalling dependencies...");
  await $`bun install`.cwd(PKG_DIR);

  // Build CLI
  console.log("\nBuilding CLI...");
  await $`bun run build`.cwd(PKG_DIR);

  if (isDryRun) {
    console.log("\n[DRY RUN] Skipping npm publish");
    console.log("\nTo test locally:");
    console.log(`  cd /tmp && bun create ${PKG_DIR} test-project`);
  } else {
    // Publish
    console.log("\nPublishing to npm...");
    await $`npm publish --access public`.cwd(PKG_DIR);
    console.log("\nPublished create-bloop!");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
