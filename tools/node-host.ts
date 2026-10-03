// A Host for Node, used by tools/check.ts. The reader app implements the same contract in its own runtime.
import { Resolver, lookup as systemLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { load } from "cheerio";
import sharp, { type OutputInfo } from "sharp";
import { Agent, fetch } from "undici";
import type { Host, HostImage } from "../sdk/host.ts";

export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// DNS=1.1.1.1,8.8.8.8 resolves site hosts there instead of the system resolver (Mihon's DoH setting, for ISPs
// that answer blocked hosts with a block page's IP). Falls back to the system resolver when those fail.
const servers = process.env.DNS?.split(",").filter(Boolean);
const dispatcher = servers?.length ? new Agent({ connect: { lookup: publicLookup(servers) } }) : undefined;

// Same resolver as the app's lib/dns.ts: https:// entries are DNS-over-HTTPS JSON endpoints, tried first (this ISP also
// rewrites plain port-53 answers from 1.1.1.1 for some hosts); plain IPs are classic DNS; then the system resolver.
const dnsCache = new Map<string, { addresses: string[]; until: number }>();
const direct = new Agent();
export function publicLookup(servers: string[]): LookupFunction {
  const dohs = servers.filter((s) => s.startsWith("https://"));
  const plain = servers.filter((s) => !s.startsWith("https://"));
  const resolver = new Resolver({ timeout: 3000, tries: 2 });
  if (plain.length) resolver.setServers(plain);
  const resolve = async (hostname: string): Promise<string[] | null> => {
    const hit = dnsCache.get(hostname);
    if (hit && hit.until > Date.now()) return hit.addresses;
    for (const endpoint of dohs) {
      try {
        const r = await fetch(`${endpoint}?name=${encodeURIComponent(hostname)}&type=A`, { headers: { accept: "application/dns-json" }, dispatcher: direct, signal: AbortSignal.timeout(4000) });
        const a = ((await r.json()) as { Answer?: { type: number; data: string; TTL: number }[] }).Answer?.filter((x) => x.type === 1) ?? [];
        if (a.length) {
          dnsCache.set(hostname, { addresses: a.map((x) => x.data), until: Date.now() + Math.max(Math.min(...a.map((x) => x.TTL)), 60) * 1000 });
          return a.map((x) => x.data);
        }
      } catch {
        // next endpoint
      }
    }
    if (!plain.length) return null;
    return new Promise((ok) => resolver.resolve4(hostname, (err, addresses) => ok(err || !addresses.length ? null : addresses)));
  };
  return (hostname, options, callback) => {
    resolve(hostname).then((addresses) => {
      if (!addresses) return systemLookup(hostname, options, callback);
      if (options.all) callback(null, addresses.map((address) => ({ address, family: 4 })));
      else callback(null, addresses[0], 4);
    }, () => systemLookup(hostname, options, callback));
  };
}

export function nodeHost(prefs: Record<string, unknown> = {}): Host {
  const jar = new Map<string, Map<string, string>>(); // hostname -> cookie name -> value
  return {
    userAgent: USER_AGENT,
    load,
    prefs: { get: (k) => prefs[k], set: (k, v) => void (prefs[k] = v) },
    image: sharpImage,
    async fetch(url, init) {
      const headers: Record<string, string> = { ...init.headers };
      const cookies = jar.get(new URL(url).hostname);
      if (cookies?.size && !headers.cookie) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      const r = await fetch(url, { method: init.method, headers, body: init.body, redirect: "follow", signal: AbortSignal.timeout(20_000), dispatcher });
      const host = new URL(r.url).hostname;
      for (const c of r.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        if (i > 0) (jar.get(host) ?? jar.set(host, new Map()).get(host)!).set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
      return { status: r.status, url: r.url, setCookies: r.headers.getSetCookie(), headers: Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v])), body: new Uint8Array(await r.arrayBuffer()) };
    },
  };
}

/** Host.image with sharp; the reader app has the same in lib/kei/runtime.ts. Each distinct image is decoded once. */
export const sharpImage: HostImage = {
  async size(bytes) {
    const { width, height } = await sharp(bytes).metadata();
    return { width, height };
  },
  async compose({ width, height, format, quality, layers }) {
    const decoded = new Map<Uint8Array, Promise<{ data: Buffer; info: OutputInfo }>>();
    const input = await Promise.all(
      layers.map(async ({ bytes, sx, sy, sw, sh, dx, dy, flip, rotate }) => {
        if (!decoded.has(bytes)) decoded.set(bytes, sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
        const { data, info } = await decoded.get(bytes)!;
        const raw = { width: info.width, height: info.height, channels: 4 as const };
        let tile = await sharp(data, { raw }).extract({ left: sx, top: sy, width: sw, height: sh }).raw().toBuffer();
        let tw = sw;
        let th = sh;
        if (flip) tile = await sharp(tile, { raw: { width: tw, height: th, channels: 4 } }).flop().raw().toBuffer();
        if (rotate) {
          const r = await sharp(tile, { raw: { width: tw, height: th, channels: 4 } }).rotate(-90 * rotate).raw().toBuffer({ resolveWithObject: true });
          [tile, tw, th] = [r.data, r.info.width, r.info.height];
        }
        // clip to the canvas, as Canvas does (rects are unclipped only for transformed layers)
        const left = Math.max(0, -dx);
        const top = Math.max(0, -dy);
        const cw = Math.min(tw - left, width - Math.max(dx, 0));
        const ch = Math.min(th - top, height - Math.max(dy, 0));
        if (cw <= 0 || ch <= 0) return null;
        if (cw !== tw || ch !== th) tile = await sharp(tile, { raw: { width: tw, height: th, channels: 4 } }).extract({ left, top, width: cw, height: ch }).raw().toBuffer();
        return { input: tile, raw: { width: cw, height: ch, channels: 4 as const }, left: Math.max(dx, 0), top: Math.max(dy, 0) };
      }),
    );
    const canvas = sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(input.filter((l) => l !== null));
    return new Uint8Array(await (format === "png" ? canvas.png() : canvas.toFormat(format, { quality })).toBuffer());
  },
};
