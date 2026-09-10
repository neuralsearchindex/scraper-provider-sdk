/**
 * Side-effect entrypoint for catalog apps:
 *
 *     import "@neuralsearchindex/scraper-provider-sdk/errors/register";  // FIRST import
 *
 * Sentry instruments modules as they are required and ES imports are hoisted,
 * so an init call placed inside the entrypoint runs too late to patch
 * anything it already imported. Importing this module first is the only way
 * to get automatic HTTP breadcrumbs and spans.
 *
 * `runCatalogWorker` also initialises, so a catalog that omits this line still
 * reports errors — it just loses the automatic instrumentation. That fallback
 * is why every EXISTING catalog is covered without touching its repo.
 */
import { initCatalogErrors } from "./errors";

initCatalogErrors();
