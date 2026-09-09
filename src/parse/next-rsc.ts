/**
 * Reader for the **Next.js App Router RSC flight stream**. App-Router pages don't ship
 * a `__NEXT_DATA__` blob; instead they stream serialized data through
 * `<script>self.__next_f.push([1,"<escaped-json-fragment>"])</script>` tags. This
 * concatenates those fragments back into one string and pulls JSON objects out of it.
 * (Server-rendered, so a browser `scrape()` returns it — no client re-fetch.)
 */

/** Concatenate + unescape every `self.__next_f.push([1,"…"])` payload into one stream. */
export function rscStream(html: string): string {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,\s*("(?:\\.|[^"\\])*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out += JSON.parse(m[1]) as string;
    } catch {
      /* skip a malformed fragment */
    }
  }
  return out;
}

/** The balanced JSON object starting at the `{` at `start` (string/escape aware), or null. */
export function balancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Find the first JSON object in the stream that starts `{"id":…` and satisfies `pred`
 * (e.g. "has referenceId + property_type" → the listing object). Uses balanced-brace
 * extraction so nested objects/strings are handled.
 */
export function findRscObject<T = Record<string, unknown>>(
  stream: string,
  pred: (o: Record<string, unknown>) => boolean
): T | null {
  const re = /\{"id":/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    const raw = balancedObject(stream, m.index);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (pred(obj)) return obj as T;
    } catch {
      /* not a complete object here — keep scanning */
    }
  }
  return null;
}

/** One image object embedded in the RSC stream. */
export interface RscImage {
  url: string;
  is_floor_plan?: boolean;
  mime_type?: string;
}

/** Collect image objects ({url, mime_type:image/*}) from the stream, deduped, in order. */
export function rscImages(stream: string): RscImage[] {
  const out: RscImage[] = [];
  const seen = new Set<string>();
  const re = /\{"[^{}]*?"mime_type":"image\/[^{}]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    try {
      const obj = JSON.parse(m[0]) as RscImage;
      if (obj.url && !seen.has(obj.url)) {
        seen.add(obj.url);
        out.push(obj);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}
