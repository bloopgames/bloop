import { unlink } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

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
const packages = ["engine", "bloop"];

const packageCwds = packages.map((packageName) =>
  path.join(__dirname, "..", "packages", packageName),
);

try {
  if (process.env.NPM_TOKEN) {
    await Bun.write(
      path.join(__dirname, "..", ".npmrc"),
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

  // prep all packages to be the same version, replace src/*.ts exports with dist/*.js and dist/*.d.ts
  for (const packageCwd of packageCwds) {
    await prepPackage(packageCwd, maxVersion);
  }

  for (const packageCwd of packageCwds) {
    await publishPackage(packageCwd);
  }

  await $`git tag "v${maxVersion.join(".")}"`;
  await $`git push --tags`;
} catch (e) {
  console.error(e);
} finally {
  for (const packageCwd of packageCwds) {
    console.log("reverting", packageCwd);
    await revertPackageJson(packageCwd);
  }

  if (process.env.NPM_TOKEN) {
    await unlink(path.join(__dirname, "..", ".npmrc"));
  }
}

async function revertPackageJson(cwd: string) {
  await $`git checkout package.json`.cwd(cwd);
  await $`git checkout jsr.json`.cwd(cwd);
}

async function prepPackage(cwd: string, version: [number, number, number]) {
  const packageJsonPath = path.join(cwd, "package.json");
  const jsrJsonPath = path.join(cwd, "jsr.json");
  const packageJson = await Bun.file(packageJsonPath).json();
  const jsrJson = await Bun.file(jsrJsonPath).json();
  const versionString = version.join(".");
  packageJson.version = versionString;
  jsrJson.version = versionString;
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

  await pinWorkspaceDeps(packageJson, versionString);
  await Bun.write(jsrJsonPath, JSON.stringify(jsrJson, null, 2));
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(packageJson.name, packageJson.version);

  await $`bun run build`.cwd(cwd);
  await $`npm publish --dry-run`.cwd(cwd);
}

// bun won't pick up the new package.json versions, it'll use what's in bun.lock instead, see
// https://github.com/oven-sh/bun/issues/20477
async function pinWorkspaceDeps(packageJson: any, versionString: string) {
  if (packageJson.dependencies) {
    for (const [key, value] of Object.entries(packageJson.dependencies)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        (packageJson.dependencies as Record<string, unknown>)[key] =
          versionString;
      }
    }
  }
  if (packageJson.devDependencies) {
    for (const [key, value] of Object.entries(packageJson.devDependencies)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        (packageJson.devDependencies as Record<string, unknown>)[key] =
          versionString;
      }
    }
  }
}

async function getDesiredVersion(
  cwd: string,
): Promise<[number, number, number]> {
  const packageJson = await Bun.file(path.join(cwd, "package.json")).json();

  const remoteVersion = await getRemoteVersion(packageJson.name);
  const npmVersion = remoteVersion
    .split(".")
    .map((str: string) => Number.parseInt(str, 10));
  const packageJsonVersion = packageJson.version
    .split(".")
    .map((str: string) => Number.parseInt(str, 10));

  if (packageJsonVersion.length !== 3) {
    throw new Error("package.json version must be in the format x.y.z");
  }

  let version = npmVersion;
  if (packageJsonVersion[0]! > npmVersion[0]) {
    version = packageJsonVersion;
  } else if (packageJsonVersion[1]! > npmVersion[1]) {
    version[1] = packageJsonVersion[1];
    version[2] = packageJsonVersion[2];
  } else if (packageJsonVersion[2]! > npmVersion[2]) {
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

async function getRemoteVersion(name: string) {
  const results = await fetch(`https://registry.npmjs.org/${name}`);
  const json = (await results.json()) as any;

  if (json.error === "Not found") {
    console.warn(`${name} not found on npm, using 0.0.0 as latest version`);
    return "0.0.0";
  } else if (!json["dist-tags"] || !json["dist-tags"].latest) {
    if (json.time?.unpublished?.versions) {
      return json.time.unpublished.versions[
        json.time.unpublished.versions.length - 1
      ];
    }
    console.error(json);
    throw new Error(`${name} found on npm but no latest version`);
  }

  return json["dist-tags"].latest || "0.0.0";
}
