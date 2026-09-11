import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScrapedRaw } from "./run-provider-worker";

/**
 * A provider returns `{ ad, images, raw }` with the detail gallery ALONGSIDE the ad. The worker
 * used to persist only `{ ...ad, ...det.raw }`, dropping `det.images` — so every remote-worker
 * provider stored listings with no photos, `imageUrls(ad)` returned [], the image-embedding job
 * returned early without ever calling the embedder, and all 29 victory-cars-pl listings indexed
 * as "degraded: images" with nothing in the logs.
 */

test("the detail gallery is merged into the stored raw", () => {
  const raw = buildScrapedRaw(
    { make: "Mercedes-Benz", sourceUrl: "https://victory-cars.pl/car/gls/" },
    { images: ["https://victory-cars.pl/a.jpg", "https://victory-cars.pl/b.jpg"] },
  );

  assert.deepEqual(raw.images, ["https://victory-cars.pl/a.jpg", "https://victory-cars.pl/b.jpg"]);
  assert.equal(raw.make, "Mercedes-Benz");
});

test("the gallery wins over a provider-specific raw.images shape", () => {
  // otomoto's advert carries `images: { photos: [...] }` — an object, not the string[] the
  // ingest contract reads. Spreading det.raw last would shadow the gallery with it.
  const raw = buildScrapedRaw(
    { make: "BMW" },
    { raw: { images: { photos: [{ url: "https://otomoto.pl/x.jpg" }] } }, images: ["https://otomoto.pl/x.jpg"] },
  );

  assert.deepEqual(raw.images, ["https://otomoto.pl/x.jpg"], "gallery must be applied last");
});

test("det.raw still overlays the ad when there is no gallery", () => {
  const raw = buildScrapedRaw({ make: "BMW", year: 2019 }, { raw: { year: 2020, extra: true } });

  assert.equal(raw.year, 2020, "det.raw overlays the ad");
  assert.equal(raw.extra, true);
  assert.equal("images" in raw, false, "no empty images key when the provider returned none");
});

test("an empty gallery does not write an images key", () => {
  const raw = buildScrapedRaw({ make: "BMW" }, { images: [] });

  assert.equal("images" in raw, false);
});
