#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prompts from "prompts";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

const templates = [
  {
    name: "hello",
    title: "Empty Project",
    description: "An empty project with Bloop setup",
  },
  {
    name: "mario",
    title: "Realtime Multiplayer",
    description: "Mario-style versus platformer with rollback netcode",
  },
];

async function main() {
  const args = process.argv.slice(2);
  let projectName = args[0];

  // If no project name provided, prompt for it
  if (!projectName) {
    const response = await prompts({
      type: "text",
      name: "projectName",
      message: "Project name:",
      initial: "hellobloop",
    });
    projectName = response.projectName;
    if (!projectName) {
      console.log("Cancelled.");
      process.exit(1);
    }
  }

  // Prompt for template
  const { template } = await prompts({
    type: "select",
    name: "template",
    message: "Pick a template:",
    choices: templates.map((t) => ({
      title: `${t.title} - ${t.description}`,
      value: t.name,
    })),
  });

  if (!template) {
    console.log("Cancelled.");
    process.exit(1);
  }

  const projectDir = path.resolve(process.cwd(), projectName);

  // Check if directory exists
  if (fs.existsSync(projectDir)) {
    console.error(`Error: Directory "${projectName}" already exists.`);
    process.exit(1);
  }

  console.log(`\nCreating ${projectName}...`);

  // Find templates directory (relative to this script in dist/)
  const templatesDir = path.join(DIRNAME, "..", "templates", template);
  if (!fs.existsSync(templatesDir)) {
    console.error(`Error: Template "${template}" not found.`);
    console.error(`Expected at: ${templatesDir}`);
    process.exit(1);
  }

  // Copy template files
  copyDir(templatesDir, projectDir);

  // Update package.json with project name
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    let pkgContent = fs.readFileSync(pkgPath, "utf-8");
    pkgContent = pkgContent.replace(/\{\{name\}\}/g, projectName);
    fs.writeFileSync(pkgPath, pkgContent);
  }

  console.log(`\nDone! Next steps:\n`);
  console.log(`  cd ${projectName}`);
  console.log(`  bun install`);
  console.log(`  bun dev`);
  console.log();
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    // npm won't publish .gitignore, so we store it as "gitignore" and rename here
    const destName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
