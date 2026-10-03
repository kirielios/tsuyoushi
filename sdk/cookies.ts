// OkHttp's CookieJar (client.cookieJar), in memory per source like the app's OkHttpClient. Domain-aware and honours
// Max-Age/Expires; paths are ignored (ponytail: add path matching if a source ever scopes cookies by path).

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  expiresAt: number; // ms since epoch; Infinity = session cookie
}

const matches = (c: Cookie, host: string) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`));

export class CookieJar {
  private cookies: Cookie[] = [];

  /** Parse and keep Set-Cookie header values received from `url`. */
  saveFromResponse(url: string, setCookies: string[]) {
    const host = new URL(url).hostname;
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(";");
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      const cookie: Cookie = { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain: host, hostOnly: true, expiresAt: Infinity };
      let maxAge: number | undefined;
      for (const a of attrs) {
        const [k, v = ""] = a.split("=").map((s) => s.trim());
        const key = k.toLowerCase();
        if (key === "domain" && v) {
          const d = v.replace(/^\./, "").toLowerCase();
          if (host !== d && !host.endsWith(`.${d}`)) cookie.domain = ""; // a site may not set cookies for another domain
          else Object.assign(cookie, { domain: d, hostOnly: false });
        } else if (key === "max-age" && /^-?\d+$/.test(v)) maxAge = Number(v);
        else if (key === "expires" && !Number.isNaN(Date.parse(v))) cookie.expiresAt = Date.parse(v);
      }
      if (!cookie.domain) continue;
      if (maxAge !== undefined) cookie.expiresAt = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000;
      this.cookies = this.cookies.filter((c) => !(c.name === cookie.name && c.domain === cookie.domain));
      if (cookie.expiresAt > Date.now()) this.cookies.push(cookie);
    }
  }

  /** Cookies that apply to `url`, expired ones dropped. */
  loadForRequest(url: string): Cookie[] {
    const host = new URL(url).hostname;
    const now = Date.now();
    this.cookies = this.cookies.filter((c) => c.expiresAt > now);
    return this.cookies.filter((c) => matches(c, host));
  }

  /** Keiyoushi's `addCookie`/`setCookie` helpers: store "name=value; Domain=…" as if `url` had sent it. */
  set(url: string, cookie: string) {
    this.saveFromResponse(url, [cookie]);
  }

  remove(url: string, name: string) {
    const host = new URL(url).hostname;
    this.cookies = this.cookies.filter((c) => !(c.name === name && matches(c, host)));
  }

  clear() {
    this.cookies = [];
  }
}
