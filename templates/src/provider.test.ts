import assert from "node:assert/strict";
import test from "node:test";

import __PROVIDER_FACTORY__, { isDetailUrl } from "./__PROVIDER_ID__.provider";

test("provider identity", () => {
  const p = __PROVIDER_FACTORY__();
  assert.equal(p.id, "__PROVIDER_ID__");
  assert.ok(p.domains.length > 0);
  assert.equal(typeof p.discover, "function");
  assert.equal(typeof p.extractDetails, "function");
});

test("isDetailUrl distinguishes detail pages from index pages", () => {
  assert.equal(isDetailUrl("https://example.com/listing/123"), true);
  assert.equal(isDetailUrl("https://example.com/search?page=2"), false);
});
