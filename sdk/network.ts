// keiyoushi.network (client.get/post/head, rateLimit, interceptors) and keiyoushi.utils (asJsoup, parseAs) over the
// host's fetch.
import { CookieJar } from "./cookies.ts";
import type { Host, HostResponse } from "./host.ts";
import { parseHtml, parseXml, type Document } from "./jsoup.ts";

export class HttpException extends Error {
  constructor(
    readonly code: number,
    readonly url: string,
  ) {
    super(`HTTP error ${code}`);
  }
}

function charsetOf(contentType = "") {
  return /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
}

export class Response {
  constructor(
    private readonly host: Host,
    private readonly raw: HostResponse,
  ) {}
  /**
   * Response.Builder().request(request).code(200).body(bytes.toResponseBody(mediaType)).build(): a response made
   * without the network, for interceptors that answer themselves (text pages, data: images). No host, so no asJsoup.
   */
  static of(url: string, body: Uint8Array, contentType?: string | null, code = 200): Response {
    return new Response({} as Host, { status: code, url, headers: contentType ? { "content-type": contentType } : {}, body });
  }
  get code() {
    return this.raw.status;
  }
  get isSuccessful() {
    return this.raw.status >= 200 && this.raw.status < 300;
  }
  /** response.newBuilder().code(code).build() */
  withCode(code: number): Response {
    return new Response(this.host, { ...this.raw, status: code });
  }
  /** response.newBuilder().body(body).build(), for interceptors that rewrite the payload (image decryption). */
  withBody(body: Uint8Array): Response {
    return new Response(this.host, { ...this.raw, body });
  }
  /** Final URL after redirects (OkHttp's response.request.url). */
  get url() {
    return this.raw.url;
  }
  header(name: string): string | null {
    return this.raw.headers[name.toLowerCase()] ?? null;
  }
  /** Repeated headers arrive joined by ", "; this splits Link-style lists ("<a>; rel=x, <b>; rel=y"). */
  headerValues(name: string): string[] {
    const v = this.header(name);
    return v ? v.split(/,\s*(?=<)/) : [];
  }
  bytes(): Uint8Array {
    return this.raw.body;
  }
  /** response.body.string() */
  text(): string {
    // OkHttp's MediaType.charset() swallows unsupported names ("UTF-8mb4") and falls back to UTF-8
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(charsetOf(this.raw.headers["content-type"]));
    } catch {
      decoder = new TextDecoder("utf-8");
    }
    return decoder.decode(this.raw.body);
  }
  /** keiyoushi's Response.asJsoup(): links resolve against the final URL. */
  asJsoup(): Document {
    return parseHtml(this.host.load, this.text(), this.raw.url);
  }
  /** Response.asJsoup(Parser.xmlParser()) */
  asXml(): Document {
    return parseXml(this.host.load, this.text(), this.raw.url);
  }
  /** keiyoushi's Response.parseAs<T>(). */
  parseAs<T>(): T {
    return JSON.parse(this.text()) as T;
  }
}

export interface Request {
  url: string;
  method: string;
  headers: Headers;
  body?: string | Uint8Array;
}
/** OkHttp application interceptors, reduced to what sources do with them here: rewrite the request before it goes out. */
export type Interceptor = (request: Request) => Request | Promise<Request>;
/** OkHttp's Interceptor.Chain, for interceptors that inspect the response (JS challenges, retries, login walls). */
export interface Chain {
  request(): Request;
  /** Sends `request` through the remaining chain interceptors, the rate limits and the network. */
  proceed(request: Request): Promise<Response>;
}
/** OkHttp's `addInterceptor { chain -> ... }` form; runs after the request rewriters, outside the rate limits. */
export type ChainInterceptor = (chain: Chain) => Promise<Response>;

/** keiyoushi's RateLimitInterceptor: at most `permits` requests per `periodMs`, optionally only for some URLs. */
class RateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly permits: number,
    private readonly periodMs: number,
    readonly applies: (url: URL) => boolean,
  ) {}
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.periodMs);
      if (this.stamps.length < this.permits) {
        this.stamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, this.periodMs - (now - this.stamps[0]) + 5));
    }
  }
}

/** OkHttpClient.Builder for configureClient(): `rateLimit(3)`, `rateLimit(1, 2_000)`, `addInterceptor(...)`. */
export class ClientBuilder {
  readonly interceptors: Interceptor[] = [];
  readonly limiters: RateLimiter[] = [];
  timeoutMs?: number;
  /** rateLimit(permits, period = 1s, shouldLimit = all) - periods are milliseconds here (Kotlin's 2.seconds -> 2_000). */
  rateLimit(permits: number, periodMs = 1000, shouldLimit: (url: URL) => boolean = () => true) {
    this.limiters.push(new RateLimiter(permits, periodMs, shouldLimit));
    return this;
  }
  addInterceptor(i: Interceptor) {
    this.interceptors.push(i);
    return this;
  }
  readonly chainInterceptors: ChainInterceptor[] = [];
  /** addInterceptor { chain -> chain.proceed(chain.request()) } */
  addChainInterceptor(i: ChainInterceptor) {
    this.chainInterceptors.push(i);
    return this;
  }
  /** Accepted for fidelity; the host applies its own timeout. */
  readTimeout(ms: number) {
    this.timeoutMs = ms;
    return this;
  }
  connectTimeout(ms: number) {
    return this.readTimeout(ms);
  }
}

type Body = string | URLSearchParams | Uint8Array;

export class HttpClient {
  constructor(
    private readonly host: Host,
    /** The source's headers; a request's own headers replace them. */
    private readonly defaults: () => Headers,
    private readonly config: ClientBuilder,
  ) {}

  /** client.cookieJar: cookies the sites set, sent back on matching requests. */
  readonly cookieJar = new CookieJar();

  /** Send a prepared request (client.newCall(request).await()). */
  async execute(req: Request, ensureSuccess = false): Promise<Response> {
    for (const i of this.config.interceptors) req = await i(req);
    const res = await this.proceed(req, 0);
    if (ensureSuccess && !res.isSuccessful) throw new HttpException(res.code, res.url);
    return res;
  }

  private async proceed(req: Request, index: number): Promise<Response> {
    const ci = this.config.chainInterceptors[index];
    if (ci) return ci({ request: () => req, proceed: (next) => this.proceed(next, index + 1) });
    const url = new URL(req.url);
    for (const l of this.config.limiters) if (l.applies(url)) await l.acquire();
    const headers = Object.fromEntries(req.headers);
    // OkHttp's BridgeInterceptor: the jar's cookies become the Cookie header
    const cookies = this.cookieJar.loadForRequest(req.url);
    if (cookies.length) {
      // an explicit Cookie header (set by an interceptor) keeps the pairs the jar does not know
      const explicit: string[] = [];
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() !== "cookie") continue;
        explicit.push(...headers[k].split("; ").filter((p) => p && !cookies.some((c) => p.startsWith(`${c.name}=`))));
        delete headers[k];
      }
      headers.Cookie = [...explicit, ...cookies.map((c) => `${c.name}=${c.value}`)].join("; ");
    }
    const fetched = await this.host.fetch(req.url, { method: req.method, headers, body: req.body });
    // fetch drops the fragment from the final URL; OkHttp's response.request.url keeps it unless a redirect replaced it
    const hash = req.url.indexOf("#");
    const raw = hash >= 0 && !fetched.url.includes("#") && fetched.url === req.url.slice(0, hash) ? { ...fetched, url: req.url } : fetched;
    // ponytail: cookies set by intermediate redirects are lost (the host follows redirects); fine until a login needs them
    if (raw.setCookies?.length) this.cookieJar.saveFromResponse(raw.url, raw.setCookies);
    return new Response(this.host, raw);
  }

  /** Fire and forget (client.newCall(request).enqueue): view counters and the like. */
  enqueue(req: Request) {
    this.execute(req).catch(() => undefined);
  }

  private call(method: string, url: string | URL, headers: Headers | undefined, body: Body | undefined, ensureSuccess: boolean) {
    const h = new Headers(headers ?? this.defaults());
    if (body instanceof URLSearchParams && !h.has("Content-Type")) h.set("Content-Type", "application/x-www-form-urlencoded");
    return this.execute({ url: String(url), method, headers: h, body: body instanceof URLSearchParams ? body.toString() : body }, ensureSuccess);
  }

  /** client.get(url): throws HttpException on a non-2xx status unless ensureSuccess is false, as upstream does. */
  get(url: string | URL, headers?: Headers, opts: { ensureSuccess?: boolean } = {}) {
    return this.call("GET", url, headers, undefined, opts.ensureSuccess ?? true);
  }
  post(url: string | URL, headers?: Headers, body?: Body, opts: { ensureSuccess?: boolean } = {}) {
    return this.call("POST", url, headers, body, opts.ensureSuccess ?? true);
  }
  head(url: string | URL, headers?: Headers, opts: { ensureSuccess?: boolean } = {}) {
    return this.call("HEAD", url, headers, undefined, opts.ensureSuccess ?? true);
  }
}
