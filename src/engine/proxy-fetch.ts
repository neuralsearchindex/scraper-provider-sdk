import { Agent, type Dispatcher, ProxyAgent, cacheStores, interceptors, fetch as undiciFetch } from "undici";

type UndiciRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;

const DEFAULT_PROXY_LIST_URL =
  "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=json";

const DEFAULT_TEST_URL = "http://httpbin.org/ip";
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_STATUSES: readonly number[] = [403, 429];
const DEFAULT_RETRY_DELAY_MS = 5000;

export interface ProxyFetcherOptions {
  /** Optional logger; silent when omitted. */
  logger?: { info(msg: string): void; warn(msg: string): void };
  /** How many proxies to race in each batch. */
  concurrency?: number;
  /** Per-proxy request timeout while probing. */
  timeoutMs?: number;
  /** Max proxy rotations per `fetch` call. */
  maxRetries?: number;
  /** HTTP statuses that trigger a proxy rotation. */
  retryStatuses?: readonly number[];
  /** Base delay in ms for exponential backoff between retries. */
  retryDelayMs?: number;
  /** URL used to probe proxy liveness. */
  testUrl?: string;
  /** Endpoint returning the free proxy list. */
  proxyListUrl?: string;
}

export interface ProxyFetcher {
  fetch(url: string, init?: UndiciRequestInit): Promise<UndiciResponse>;
  getWorkingProxy(): Promise<string>;
  clearCachedProxy(): void;
}

interface ProxyListEntry {
  protocol: string;
  alive: boolean;
  proxy: string;
}

export function createProxyFetcher(options: ProxyFetcherOptions = {}): ProxyFetcher {
  const {
    logger,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryStatuses = DEFAULT_RETRY_STATUSES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    testUrl = DEFAULT_TEST_URL,
    proxyListUrl = DEFAULT_PROXY_LIST_URL
  } = options;

  const retrySet = new Set(retryStatuses);

  // Cache non-proxied fetches (proxy list API, direct attempts) in memory so
  // repeated requests within the same process honor origin Cache-Control.
  const cachedAgent: Dispatcher = new Agent().compose(
    interceptors.cache({
      store: new cacheStores.MemoryCacheStore({
        maxSize: 100 * 1024 * 1024,
        maxCount: 1000,
        maxEntrySize: 5 * 1024 * 1024
      }),
      methods: ["GET", "HEAD"]
    })
  );

  let cachedProxy: string | null = null;

  const info = (msg: string) => (logger ? logger.info(msg) : undefined);
  const warn = (msg: string) => (logger ? logger.warn(msg) : undefined);

  async function fetchHttpProxies(): Promise<string[]> {
    const res = await undiciFetch(proxyListUrl, { dispatcher: cachedAgent });
    const data = (await res.json()) as { proxies: ProxyListEntry[] };
    return data.proxies.filter((p) => p.protocol === "http" && p.alive === true).map((p) => p.proxy);
  }

  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  async function testProxy(proxyUrl: string, externalSignal?: AbortSignal): Promise<string> {
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
    if (externalSignal) signals.push(externalSignal);
    const signal = AbortSignal.any(signals);

    const dispatcher = new ProxyAgent(proxyUrl);
    try {
      const res = await undiciFetch(testUrl, { dispatcher, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return proxyUrl;
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }

  async function getWorkingProxy(): Promise<string> {
    if (cachedProxy) {
      try {
        await testProxy(cachedProxy);
        return cachedProxy;
      } catch {
        warn("[proxy] Cached proxy failed, searching for a new one");
        cachedProxy = null;
      }
    }

    const proxies = await fetchHttpProxies();
    info(`[proxy] Probing ${proxies.length} HTTP proxies`);
    shuffle(proxies);

    const batches = chunk(proxies, concurrency);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchAbort = new AbortController();
      try {
        const winner = await Promise.any(batch.map((p) => testProxy(p, batchAbort.signal)));
        batchAbort.abort();
        info(`[proxy] Winner: ${winner}`);
        cachedProxy = winner;
        return winner;
      } catch {
        // AggregateError — every proxy in this batch failed; try next batch
      }
    }

    throw new Error("[proxy] No working proxy found after testing all candidates");
  }

  async function fetchViaProxy(url: string, init: UndiciRequestInit = {}): Promise<UndiciResponse> {
    // 1. Direct attempt — skip proxies entirely unless the origin blocks us.
    try {
      const res = await undiciFetch(url, { ...init, dispatcher: cachedAgent });
      if (!retrySet.has(res.status)) return res;
      warn(`[proxy] Direct ${url} returned ${res.status} — falling back to proxy`);
    } catch (err) {
      warn(`[proxy] Direct ${url} failed — ${(err as Error).message} — falling back to proxy`);
    }

    // 2. Proxy fallback, rotating on retry-worthy responses or network errors.
    let lastResponse: UndiciResponse | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** (attempt - 2)));
      const proxyUrl = await getWorkingProxy();
      const dispatcher = new ProxyAgent(proxyUrl);
      try {
        const res = await undiciFetch(url, { ...init, dispatcher });
        if (!retrySet.has(res.status)) return res;
        warn(`[proxy] ${proxyUrl} returned ${res.status} for ${url} — rotating (attempt ${attempt}/${maxRetries})`);
        lastResponse = res;
        cachedProxy = null;
      } catch (err) {
        warn(`[proxy] ${proxyUrl} threw for ${url} — ${(err as Error).message} (attempt ${attempt}/${maxRetries})`);
        cachedProxy = null;
        if (attempt === maxRetries) throw err;
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }

    // All retries exhausted — return the last received response so callers can inspect it.
    return lastResponse as UndiciResponse;
  }

  return {
    fetch: fetchViaProxy,
    getWorkingProxy,
    clearCachedProxy: () => {
      cachedProxy = null;
    }
  };
}
