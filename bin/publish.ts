import { cp, mkdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

const ROOT = path.join(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages/create-bloop");
const TEMPLATES_DIR = path.join(PKG_DIR, "templates");
const isTemplatesOnly = process.argv.includes("templates-only");

const status = await $`git status -s`.text();
if (status.length !== 0 && !process.env.FORCE) {
  console.error(`$ git status\n${status}`);
  throw new Error(
    "git status is not empty, please commit or stash changes before publishing or run with FORCE=1.",
  );
}

if (!process.env.NPM_TOKEN) {
  console.warn(
    `NPM_TOKEN is not set. Publish will fail unless run on a github action authenticated with oidc.`,
  );
}

// order matters, these have to be in increasing order of dependencies
const packages = ["engine", "bloop", "web"];

const packageCwds = packages.map((packageName) =>
  path.join(ROOT, "packages", packageName),
);

try {
  if (process.env.NPM_TOKEN) {
    await Bun.write(
      path.join(ROOT, ".npmrc"),
      `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}`,
    );
  }

  let maxVersion: [number, number, number] = [0, 0, 0];
  // find the highest version across all packages
  for (const packageCwd of packageCwds) {
    const version = await getDesiredVersion(packageCwd);
    if (isVersionGreater(version, maxVersion)) {
      maxVersion = version;
    }
  }
  const versionString = maxVersion.join(".");

  // prep all packages to be the same version, replace src/*.ts exports with dist/*.js and dist/*.d.ts
  for (const packageCwd of packageCwds) {
    await prepPackage(packageCwd, maxVersion);
  }

  if (!isTemplatesOnly) {
    for (const packageCwd of packageCwds) {
      await publishPackage(packageCwd);
    }
    await $`git tag "v${versionString}"`;
    await $`git push --tags`;
  }

  await publishTemplates(versionString);
} finally {
  for (const packageCwd of packageCwds) {
    console.log("reverting", packageCwd);
    await revertPackageJson(packageCwd);
  }

  await revertPackageJson(PKG_DIR);

  if (process.env.NPM_TOKEN) {
    await unlink(path.join(ROOT, ".npmrc"));
  }
}

// ============================================================================
// Package publishing helpers
// ============================================================================

async function revertPackageJson(cwd: string) {
  await $`git checkout package.json`.cwd(cwd);
  await $`git checkout jsr.json`.cwd(cwd).nothrow();
  await $`git checkout js/defaultUrl.ts`.cwd(cwd).nothrow();
}

async function prepPackage(cwd: string, version: [number, number, number]) {
  const packageJsonPath = path.join(cwd, "package.json");
  const jsrJsonPath = path.join(cwd, "jsr.json");
  const packageJson = await Bun.file(packageJsonPath).json();
  const jsrJson = await Bun.file(jsrJsonPath).json();
  const versionStr = version.join(".");
  packageJson.version = versionStr;
  jsrJson.version = versionStr;
  for (const [key, value] of Object.entries(packageJson.exports)) {
    (packageJson.exports as Record<string, unknown>)[key] = {
      import: (value as any).import
        .replace("src", "dist")
        .replace("js/", "dist/")
        .replace(".ts", ".js"),
      types: (value as any).types
        .replace("src", "dist")
        .replace("js/", "dist/")
        .replace(".ts", ".d.ts"),
    };
  }

  await pinWorkspaceDeps(packageJson, versionStr);
  await Bun.write(jsrJsonPath, JSON.stringify(jsrJson, null, 2));
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(packageJson.name, packageJson.version);

  if (packageJson.name === "@bloopjs/engine") {
    const defaultUrlPath = path.join(cwd, "js/defaultUrl.ts");
    await Bun.write(
      defaultUrlPath,
      `export const DEFAULT_WASM_URL: URL = new URL("https://unpkg.com/@bloopjs/engine@${versionStr}/wasm/bloop.wasm");\n`,
    );
    console.log(`  Set DEFAULT_WASM_URL to CDN URL for v${versionStr}`);
  }

  await $`bun run build`.cwd(cwd);
  await $`npm publish --dry-run`.cwd(cwd);
}

// bun won't pick up the new package.json versions, it'll use what's in bun.lock instead, see
// https://github.com/oven-sh/bun/issues/20477
async function pinWorkspaceDeps(packageJson: any, versionStr: string) {
  if (packageJson.dependencies) {
    for (const [key, value] of Object.entries(packageJson.dependencies)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        (packageJson.dependencies as Record<string, unknown>)[key] = versionStr;
      }
    }
  }
  if (packageJson.devDependencies) {
    for (const [key, value] of Object.entries(packageJson.devDependencies)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        (packageJson.devDependencies as Record<string, unknown>)[key] =
          versionStr;
      }
    }
  }
}

async function getLatestVersion(packageName: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  const json = (await response.json()) as any;

  if (json.error === "Not found") {
    console.warn(`${packageName} not found on npm, using 0.0.0`);
    return "0.0.0";
  }

  if (!json["dist-tags"]?.latest) {
    if (json.time?.unpublished?.versions) {
      return json.time.unpublished.versions.at(-1);
    }
    throw new Error(`${packageName} found on npm but no latest version`);
  }

  return json["dist-tags"].latest;
}

async function getDesiredVersion(
  cwd: string,
): Promise<[number, number, number]> {
  const packageJson = await Bun.file(path.join(cwd, "package.json")).json();

  const remoteVersion = await getLatestVersion(packageJson.name);
  const npmVersion = remoteVersion
    .split(".")
    .map((str: string) => Number.parseInt(str, 10));
  const packageJsonVersion = packageJson.version
    .split(".")
    .map((str: string) => Number.parseInt(str, 10));

  if (packageJsonVersion.length !== 3) {
    throw new Error("package.json version must be in the format x.y.z");
  }

  if (npmVersion.length !== 3) {
    throw new Error("remote version must be in the format x.y.z");
  }

  let version = npmVersion as [number, number, number];
  if (packageJsonVersion[0]! > npmVersion[0]!) {
    version = packageJsonVersion;
  } else if (packageJsonVersion[1]! > npmVersion[1]!) {
    version[1] = packageJsonVersion[1];
    version[2] = packageJsonVersion[2];
  } else if (packageJsonVersion[2]! > npmVersion[2]!) {
    version[2] = packageJsonVersion[2];
  }

  version[2]++;

  return version;
}

function isVersionGreater(
  a: [number, number, number],
  b: [number, number, number],
) {
  return (
    a[0] > b[0] ||
    (a[0] === b[0] && a[1] > b[1]) ||
    (a[0] === b[0] && a[1] === b[1] && a[2] > b[2])
  );
}

async function publishPackage(cwd: string) {
  await $`npm publish --access public`.cwd(cwd);
  await $`bunx jsr publish --allow-dirty`.cwd(cwd);
}

async function publishTemplates(bloopVersion: string) {
  await rm(TEMPLATES_DIR, { recursive: true, force: true });
  await mkdir(TEMPLATES_DIR, { recursive: true });

  console.log("building...");
  await $`bun run build`.cwd(PKG_DIR);

  // Copy and transform each game template
  for (const game of ["hello", "mario"]) {
    const src = path.join(ROOT, "games", game);
    const dest = path.join(TEMPLATES_DIR, game);

    // Use git ls-files to get tracked files (respects .gitignore)
    const filesOutput = await $`git ls-files`.cwd(src).text();
    const files = filesOutput.trim().split("\n").filter(Boolean);

    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      await mkdir(path.dirname(destPath), { recursive: true });

      // Apply transformations to specific files
      if (file === "package.json") {
        const content = await Bun.file(srcPath).text();
        await Bun.write(
          destPath,
          transformTemplatePackageJson(content, bloopVersion),
        );
      } else if (file === "vite.config.ts") {
        // Skip - vite works without config file
      } else {
        await cp(srcPath, destPath);
      }
    }
  }

  const packageJsonPath = path.join(PKG_DIR, "package.json");
  const nextVersion = await getDesiredVersion(PKG_DIR);
  const packageJson = await Bun.file(packageJsonPath).json();
  packageJson.version = nextVersion.join(".");
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(packageJson.name, packageJson.version);
  await $`npm publish --access public`.cwd(PKG_DIR);
}

function transformTemplatePackageJson(
  content: string,
  bloopVersion: string,
): string {
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
