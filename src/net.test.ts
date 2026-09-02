import assert from "node:assert/strict";
import test from "node:test";

import { extractLinks, harvestJsonLd, parseSitemapEntries, parseSitemapLocs } from "./net";
import { matchesDomain, resolveStrategy, type SiteProvider } from "./contract";

const SITEMAP = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://acme.com/listing/1</loc><lastmod>2026-01-02</lastmod></url>
  <url><loc>https://acme.com/listing/2</loc></url>
  <url><loc>https://acme.com/about&amp;more</loc></url>
</urlset>`;

test("parseSitemapEntries returns loc + optional lastmod, decoding entities", () => {
  const entries = parseSitemapEntries(SITEMAP);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { loc: "https://acme.com/listing/1", lastmod: "2026-01-02" });
  assert.deepEqual(entries[1], { loc: "https://acme.com/listing/2" });
  assert.equal(entries[2].loc, "https://acme.com/about&more");
});

test("parseSitemapLocs returns every <loc>", () => {
  assert.deepEqual(parseSitemapLocs(SITEMAP), [
    "https://acme.com/listing/1",
    "https://acme.com/listing/2",
    "https://acme.com/about&more",
  ]);
});

test("extractLinks resolves relative hrefs and dedupes", () => {
  const html = `<a href="/a">a</a><a href="/a">dup</a><a href="https://x.com/b">b</a>`;
  const links = extractLinks(html, "https://acme.com/").sort();
  assert.deepEqual(links, ["https://acme.com/a", "https://x.com/b"]);
});

test("harvestJsonLd parses ld+json blocks (object and array)", () => {
  const html = `
    <script type="application/ld+json">{"@type":"Car","name":"x"}</script>
    <script type="application/ld+json">[{"@type":"Org"}]</script>
    <script type="application/ld+json">not json</script>`;
  const nodes = harvestJsonLd(html);
  assert.equal(nodes.length, 2);
  assert.equal((nodes[0] as { name: string }).name, "x");
});

test("matchesDomain: www-stripped dot-boundary suffix only", () => {
  assert.equal(matchesDomain("https://www.acme.com/x", ["acme.com"]), true);
  assert.equal(matchesDomain("https://api.acme.com/x", ["acme.com"]), true);
  assert.equal(matchesDomain("https://notacme.com.evil.com/x", ["acme.com"]), false);
  assert.equal(matchesDomain("not a url", ["acme.com"]), false);
});

test("resolveStrategy: override → provider default → manual", () => {
  const p = { id: "x", domains: [] } as SiteProvider;
  assert.equal(resolveStrategy(p), "manual");
  assert.equal(resolveStrategy({ ...p, strategy: "llm" }), "llm");
  assert.equal(resolveStrategy({ ...p, strategy: "llm" }, "manual"), "manual");
});
