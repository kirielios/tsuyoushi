// OkHttp's HttpUrl and HttpUrl.Builder, the part sources use: `url.toHttpUrl().newBuilder().addPathSegment(...)`.
// Path segments follow OkHttp: "https://a.b" has one empty segment, and adding to a path that ends in "/" replaces
// that empty last segment, so "/manga/" + "page" -> "/manga/page".

const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export class HttpUrl {
  private constructor(private readonly url: URL) {}
  static parse(url: string): HttpUrl {
    return new HttpUrl(new URL(url));
  }
  static parseOrNull(url: string | null | undefined): HttpUrl | null {
    try {
      return url && /^https?:/i.test(url) ? new HttpUrl(new URL(url)) : null;
    } catch {
      return null;
    }
  }
  get scheme() {
    return this.url.protocol.replace(/:$/, "");
  }
  get host() {
    return this.url.hostname;
  }
  get encodedPath() {
    return this.url.pathname;
  }
  get encodedQuery() {
    return this.url.search.replace(/^\?/, "") || null;
  }
  get pathSegments(): string[] {
    return this.url.pathname.slice(1).split("/").map(decodeURIComponent);
  }
  get fragment() {
    return this.url.hash.replace(/^#/, "") || null;
  }
  queryParameter(name: string) {
    return this.url.searchParams.get(name);
  }
  queryParameterValues(name: string) {
    return this.url.searchParams.getAll(name);
  }
  /** Relative links resolve as in a browser; null when the result is not a URL. */
  resolve(link: string): HttpUrl | null {
    try {
      return new HttpUrl(new URL(link, this.url));
    } catch {
      return null;
    }
  }
  newBuilder(): HttpUrlBuilder {
    return new HttpUrlBuilder(new URL(this.url.href));
  }
  toString() {
    return this.url.href;
  }
  toURL() {
    return new URL(this.url.href);
  }
}

export class HttpUrlBuilder {
  private segments: string[];
  /** Names added with a null value: OkHttp writes them bare ("?name"), URLSearchParams would write "?name=". */
  private readonly bare = new Set<string>();
  constructor(private readonly url: URL) {
    this.segments = url.pathname.slice(1).split("/");
  }
  private push(encoded: string) {
    if (this.segments.length && this.segments[this.segments.length - 1] === "") this.segments[this.segments.length - 1] = encoded;
    else this.segments.push(encoded);
  }
  /** Adds one segment; slashes inside it are encoded, as OkHttp does. */
  addPathSegment(segment: string) {
    this.push(encodeSegment(segment));
    return this;
  }
  /** Adds "a/b/" as several segments (a trailing slash leaves an empty last segment). */
  addPathSegments(segments: string) {
    for (const s of segments.split("/")) this.push(encodeSegment(s));
    return this;
  }
  addEncodedPathSegment(segment: string) {
    this.push(segment);
    return this;
  }
  /** Adds "a/b/" as several already-encoded segments. */
  addEncodedPathSegments(segments: string) {
    for (const s of segments.split("/")) this.push(s);
    return this;
  }
  setPathSegment(index: number, segment: string) {
    this.segments[index] = encodeSegment(segment);
    return this;
  }
  removePathSegment(index: number) {
    this.segments.splice(index, 1);
    return this;
  }
  encodedPath(path: string) {
    this.segments = path.replace(/^\//, "").split("/");
    return this;
  }
  addQueryParameter(name: string, value: string | null = null) {
    if (value === null) this.bare.add(name);
    this.url.searchParams.append(name, value ?? "");
    return this;
  }
  /** Appends name=value as given: "+" stays a space and "%2B" a plus, as OkHttp's addEncodedQueryParameter. */
  addEncodedQueryParameter(name: string, value: string | null = null) {
    const s = this.url.search;
    this.url.search = `${s ? `${s}&` : "?"}${name}=${value ?? ""}`;
    return this;
  }
  setQueryParameter(name: string, value: string | null) {
    if (value === null) this.bare.add(name);
    else this.bare.delete(name);
    this.url.searchParams.set(name, value ?? "");
    return this;
  }
  removeAllQueryParameters(name: string) {
    this.url.searchParams.delete(name);
    return this;
  }
  fragment(f: string | null) {
    this.url.hash = f ?? "";
    return this;
  }
  build(): HttpUrl {
    const u = new URL(this.url.href);
    u.pathname = "/" + this.segments.join("/");
    if (this.bare.size) {
      const names = new Set([...this.bare].map((n) => new URLSearchParams({ [n]: "" }).toString().slice(0, -1)));
      u.search = u.search.slice(1).split("&").map((kv) => (kv.endsWith("=") && names.has(kv.slice(0, -1)) ? kv.slice(0, -1) : kv)).join("&");
    }
    return HttpUrl.parse(u.href);
  }
  toString() {
    return this.build().toString();
  }
}

/** Kotlin's String.toHttpUrl() / toHttpUrlOrNull() */
export const toHttpUrl = (url: string) => HttpUrl.parse(url);
export const toHttpUrlOrNull = (url: string | null | undefined) => HttpUrl.parseOrNull(url);
