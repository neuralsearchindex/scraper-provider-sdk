#!/usr/bin/env node
/**
 * `create-scraper-provider <id>` — scaffold a standalone provider app from the SDK templates. The
 * generated app is a self-contained repo/Docker image that joins the distributed catalog over Redis.
 *
 *   npx create-scraper-provider superauto-pl
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const TEMPLATES_DIR = join(__dirname, "..", "templates");

/** camelCase → `makeSuperautoPlProvider` style factory name from an id like `superauto-pl`. */
function factoryName(id: string): string {
  const camel = id.replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");
  return `make${camel.charAt(0).toUpperCase()}${camel.slice(1)}Provider`;
}

function applyTemplate(content: string, id: string): string {
  return content
    .replace(/__PROVIDER_ID__/g, id)
    .replace(/__PROVIDER_FACTORY__/g, factoryName(id));
}

function main(argv: string[]): void {
  const id = argv[2];
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(id)) {
    console.error("usage: create-scraper-provider <id>   (id like `superauto-pl`, `<brand>-<tld>`)");
    process.exit(1);
  }

  const target = join(process.cwd(), `${id}-provider`);
  if (existsSync(target)) {
    console.error(`refusing to overwrite existing directory: ${target}`);
    process.exit(1);
  }

  // Copy the template tree verbatim, then token-replace text files + rename the provider file.
  cpSync(TEMPLATES_DIR, target, { recursive: true });

  const rewrite = (rel: string, outRel = rel) => {
    const src = join(target, rel);
    if (!existsSync(src)) return;
    const out = join(target, outRel);
    writeFileSync(out, applyTemplate(readFileSync(src, "utf8"), id));
    if (out !== src) rmSync(src);
  };

  for (const f of ["package.json", "Dockerfile", ".env.example", "README.md", "src/index.ts"]) {
    rewrite(f);
  }
  rewrite("src/provider.ts", `src/${id}.provider.ts`);
  rewrite("src/provider.test.ts", `src/${id}.provider.test.ts`);

  // Sanity: list what we produced.
  const listed = readdirSync(join(target, "src")).sort();
  console.log(`✔ scaffolded ${basename(target)}`);
  console.log(`  src/: ${listed.join(", ")}`);
  console.log(`\nNext:\n  cd ${id}-provider && pnpm install && JOBS_REDIS_URL=redis://localhost:6379 pnpm dev`);
}

main(process.argv);
