import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { formatName, loadProvidersFromDi } from "./di";

test("formatName camel-cases a provider filename like the scraper's di/util", () => {
  assert.equal(formatName("otomoto-pl.provider"), "otomotoPlProvider");
  assert.equal(formatName("betterhomes-ch.provider"), "betterhomesChProvider");
});

test("loadProvidersFromDi auto-discovers every *.provider.ts (no registry array)", () => {
  const glob = path.join(__dirname, "__fixtures__/providers/**/*.provider.{js,ts}");
  const providers = loadProvidersFromDi(glob);
  const ids = providers.map((p) => p.id).sort();
  assert.deepEqual(ids, ["bar-com", "foo-pl"]);
  assert.equal(providers.find((p) => p.id === "foo-pl")?.businessDomain, "vehicles");
});
