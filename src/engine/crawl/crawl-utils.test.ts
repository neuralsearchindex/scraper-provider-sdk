import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rejectLink,
  isSameSite,
  getURLDepth,
  isFile,
  compilePatterns,
  type LinkFilterOptions,
} from "./crawl-utils";

const base = (over: Partial<LinkFilterOptions> = {}): LinkFilterOptions => ({
  baseHost: "example.com",
  basePath: "/listings",
  maxDepth: 10,
  includes: [],
  excludes: [],
  allowSubdomains: false,
  allowExternalLinks: false,
  allowBackwardCrawling: false,
  isRobotsAllowed: () => true,
  ...over,
});

test("rejectLink skips asset files and non-web protocols", () => {
  assert.equal(rejectLink("https://example.com/a.png", base()), "asset-file");
  assert.equal(rejectLink("mailto:x@example.com", base()), "non-web-protocol");
});

test("rejectLink rejects external hosts unless allowed / subdomains honoured", () => {
  assert.equal(rejectLink("https://other.com/x", base()), "external-host");
  assert.equal(
    rejectLink(
      "https://sub.example.com/listings/x",
      base({ allowSubdomains: true })
    ),
    null
  );
});

test("rejectLink enforces backward, depth, include/exclude, robots", () => {
  assert.equal(rejectLink("https://example.com/other", base()), "backward");
  assert.equal(
    rejectLink("https://example.com/listings/a/b/c", base({ maxDepth: 1 })),
    "depth"
  );
  assert.equal(
    rejectLink(
      "https://example.com/listings/x",
      base({ excludes: compilePatterns(["/x$"]) })
    ),
    "exclude"
  );
  assert.equal(
    rejectLink(
      "https://example.com/listings/x",
      base({ isRobotsAllowed: () => false })
    ),
    "robots"
  );
  assert.equal(rejectLink("https://example.com/listings/ok", base()), null);
});

test("include patterns require a match", () => {
  assert.equal(
    rejectLink(
      "https://example.com/listings/other",
      base({ includes: compilePatterns(["/property/"]) })
    ),
    "include"
  );
  assert.equal(
    rejectLink(
      "https://example.com/listings/property/1",
      base({ includes: compilePatterns(["/property/"]) })
    ),
    null
  );
});

test("isSameSite / getURLDepth / isFile basics", () => {
  assert.equal(isSameSite("www.example.com", "example.com", false), true);
  assert.equal(isSameSite("sub.example.com", "example.com", false), false);
  assert.equal(isSameSite("sub.example.com", "example.com", true), true);
  assert.equal(getURLDepth("https://x.com/a/b"), 2);
  assert.equal(getURLDepth("https://x.com/"), 0);
  assert.equal(isFile("https://x.com/a.png"), true);
  assert.equal(isFile("https://x.com/a.pdf"), false); // pdf intentionally crawlable
});
