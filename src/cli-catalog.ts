#!/usr/bin/env node
/**
 * `create-scraper-catalog <id>` — scaffold a standalone CATALOG app from the SDK templates. A catalog
 * bundles several providers (a market × vertical, e.g. "Polish Car Deals") into one repo / Docker
 * image that joins the distributed catalog over Redis. Providers are auto-discovered from
 * `src/providers/**​/*.provider.ts` (no registry array).
 *
 *   npx create-scraper-catalog polish-vehicles --name "Polish Car Deals" --market PL --vehicles
 *
 * Then drop provider files under `src/providers/<id>/<id>.provider.ts` and `pnpm dev`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const TEMPLATES_DIR = join(__dirname, "..", "templates-catalog");
/** The single-provider template — reused to seed a catalog's first provider (they share it). */
const PROVIDER_TEMPLATES_DIR = join(__dirname, "..", "templates");

/** Title-case a kebab id into a default display name: `polish-vehicles` → `Polish Vehicles`. */
function titleCase(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** camelCase a provider id into its factory name: `superauto-pl` → `makeSuperautoPlProvider`. */
function factoryName(id: string): string {
  const camel = id.replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");
  return `make${camel.charAt(0).toUpperCase()}${camel.slice(1)}Provider`;
}

/**
 * Seed the catalog's FIRST provider from the single-provider template (`templates/src/provider.ts`),
 * so a fresh catalog is immediately runnable and demonstrates the pattern. This is why the two
 * scaffolds "use each other": creating a catalog triggers creating a provider inside it.
 */
function seedStarterProvider(target: string, providerId: string, o: Opts): void {
  const dir = join(target, "src", "providers", providerId);
  mkdirSync(dir, { recursive: true });
  const stamp = (content: string): string =>
    content
      .replace(/__PROVIDER_ID__/g, providerId)
      .replace(/__PROVIDER_FACTORY__/g, factoryName(providerId))
      // Match the catalog's vertical (the single-provider template defaults to real_estate).
      .replace(/businessDomain: "real_estate", \/\/ or "vehicles"/, `businessDomain: "${o.businessDomain}",`);
  for (const [src, out] of [
    ["src/provider.ts", `${providerId}.provider.ts`],
    ["src/provider.test.ts", `${providerId}.provider.test.ts`],
  ]) {
    const from = join(PROVIDER_TEMPLATES_DIR, src);
    if (existsSync(from)) writeFileSync(join(dir, out), stamp(readFileSync(from, "utf8")));
  }
  rmSync(join(target, "src", "providers", ".gitkeep"), { force: true });
}

interface Opts {
  id: string;
  name: string;
  market: string;
  businessDomain: "real_estate" | "vehicles";
  description: string;
  /** Id of the first (starter) provider to seed into the catalog. */
  provider: string;
}

function parseArgs(argv: string[]): Opts | null {
  const id = argv[2];
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(id)) return null;
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const businessDomain = argv.includes("--vehicles") ? "vehicles" : "real_estate";
  return {
    id,
    name: flag("name") ?? titleCase(id),
    market: (flag("market") ?? "INT").toUpperCase(),
    businessDomain,
    description: flag("description") ?? `${titleCase(id)} — a scraper catalog.`,
    provider: flag("provider") ?? "example-com",
  };
}

function applyTemplate(content: string, o: Opts): string {
  return content
    .replace(/__CATALOG_ID__/g, o.id)
    .replace(/__CATALOG_NAME__/g, o.name)
    .replace(/__CATALOG_MARKET__/g, o.market)
    .replace(/__CATALOG_BUSINESS_DOMAIN__/g, o.businessDomain)
    .replace(/__CATALOG_DESCRIPTION__/g, o.description);
}

function main(argv: string[]): void {
  const o = parseArgs(argv);
  if (!o) {
    console.error(
      "usage: create-scraper-catalog <id> [--name \"…\"] [--market PL] [--vehicles] [--description \"…\"]\n" +
        "  id like `polish-vehicles`, `swiss-real-estate` (<market>-<vertical>)",
    );
    process.exit(1);
  }

  const target = join(process.cwd(), `${o.id}-catalog`);
  if (existsSync(target)) {
    console.error(`refusing to overwrite existing directory: ${target}`);
    process.exit(1);
  }

  // Copy the template tree verbatim, then token-replace text files.
  cpSync(TEMPLATES_DIR, target, { recursive: true });

  for (const rel of [
    "package.json",
    "Dockerfile",
    "Dockerfile.local",
    "docker-compose.yml",
    ".env.example",
    "README.md",
    "CLAUDE.md",
    "src/catalog.ts",
    "src/index.ts",
    ".github/workflows/build.yaml",
    ".github/workflows/test.yml",
    ".claude/skills/add-provider/SKILL.md",
    ".claude/skills/test-catalog/SKILL.md",
  ]) {
    const p = join(target, rel);
    if (existsSync(p)) writeFileSync(p, applyTemplate(readFileSync(p, "utf8"), o));
  }

  // Seed the first provider so the catalog is born runnable (create-catalog → provider inside).
  seedStarterProvider(target, o.provider, o);

  console.log(`✔ scaffolded ${basename(target)}  (${o.name} · ${o.market} · ${o.businessDomain})`);
  console.log(`  seeded provider: src/providers/${o.provider}/${o.provider}.provider.ts (edit it — it's a stub)`);
  console.log(
    `\nNext:\n  cd ${o.id}-catalog\n  # edit the seeded provider, or add more under src/providers/<id>/<id>.provider.ts\n  #   (see .claude/skills/add-provider/SKILL.md)\n  pnpm install && REDIS_URL=redis://localhost:6379 pnpm dev`,
  );
}

main(process.argv);
