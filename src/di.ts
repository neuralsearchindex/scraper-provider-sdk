/**
 * Provider auto-discovery — the SAME drop-a-file model the central scraper uses
 * (`di/create-di-container.ts` + `di/util.ts`), vendored here so a catalog app depends only on this
 * SDK. Drop a `src/providers/<id>/<id>.provider.ts` whose default export is a `() => SiteProvider`
 * factory and it is picked up automatically — no registry array to maintain.
 *
 * awilix camel-cases each filename via {@link formatName} (`otomoto-pl.provider` ⇒ `otomotoPlProvider`),
 * registers every default-export factory as a singleton, and we resolve every registration whose
 * name ends in `Provider`. Provider factories take no dependencies, so a non-strict container is fine.
 */

import { asFunction, createContainer, Lifetime } from "awilix";

import type { SiteProvider } from "./contract";

/**
 * camelCase a provider filename (sans extension) into its registration name, mirroring the scraper's
 * `di/util.ts`: split on `.`/`-`, capitalise every segment after the first, and drop `core`/`function`
 * marker segments. `otomoto-pl.provider` → `otomotoPlProvider`.
 */
export function formatName(fileName: string): string {
  const parts = fileName.split(/[.-]/);
  return parts
    .map((part, index) =>
      part === "core" || part === "function"
        ? ""
        : index === 0
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

/**
 * Load every `*.provider.{js,ts}` under `glob` (an absolute path the CALLER resolves from its own
 * `__dirname`, so it targets `src/` under tsx and `lib/` after tsc — the scraper's exact trick) and
 * return the resolved {@link SiteProvider}s. A provider with no `domains` array is skipped.
 */
export function loadProvidersFromDi(glob: string): SiteProvider[] {
  const container = createContainer();
  container.loadModules([glob], {
    formatName,
    resolverOptions: { register: asFunction, lifetime: Lifetime.SINGLETON },
  });
  return Object.keys(container.registrations)
    .filter((name) => name.endsWith("Provider"))
    .map((name) => container.resolve<SiteProvider>(name))
    .filter((p): p is SiteProvider => Boolean(p) && Array.isArray(p.domains));
}
