// Port of keiyoushi/extensions-source core keiyoushi/utils/NextJs.kt: pull a JSON value out of Next.js flight data
// (App Router `self.__next_f.push`, raw `text/x-component` RSC bodies) or Pages Router `__NEXT_DATA__`.
// JSON only: nothing served by the site is executed. The deserializer step is a cast; callers apply DTO defaults.
import type { Document } from "./jsoup.ts";
import type { Response } from "./network.ts";

type Json = unknown;
type Predicate = (element: Json) => boolean;

const NEXT_F_REGEX = /self\.__next_f\.push\(\s*(\[.*])\s*\)\s*;?\s*$/s;
const isObject = (e: Json): e is Record<string, Json> => typeof e === "object" && e !== null && !Array.isArray(e);

function extractValueNextJs(payload: Json, predicate: Predicate): Json | null {
  if (!isObject(payload) && !Array.isArray(payload)) return null;
  if (predicate(payload)) return payload;
  for (const child of Array.isArray(payload) ? payload : Object.values(payload)) {
    const result = extractValueNextJs(child, predicate);
    if (result != null) return result;
  }
  return null;
}

/** React Flight value markers ($$, $undefined, $D, $n, $Q, $W, $L, $@, $<id>[:path]); see NextJs.kt. */
function resolveNextJsRefs(element: Json, chunkCache: Map<string, string>, modelCache: Map<string, Json>, resolving: Set<string> = new Set()): Json {
  if (Array.isArray(element)) return element.map((it) => resolveNextJsRefs(it, chunkCache, modelCache, resolving));
  if (isObject(element)) return Object.fromEntries(Object.entries(element).map(([k, v]) => [k, resolveNextJsRefs(v, chunkCache, modelCache, resolving)]));
  if (typeof element === "string" && element.startsWith("$") && element.length >= 2) {
    const str = element;
    if (str === "$undefined") return null;
    if (str === "$Infinity" || str === "$-Infinity" || str === "$NaN" || str === "$-0") return str.substring(1);
    switch (str[1]) {
      case "$":
        return str.substring(1);
      case "D":
      case "n":
        return str.substring(2);
      case "Q":
        return resolveMapRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;
      case "W":
        return resolveSetRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;
      case "L":
      case "@":
        return resolveModelRef(str.substring(2), chunkCache, modelCache, resolving) ?? element;
      default:
        return resolveModelRef(str.substring(1), chunkCache, modelCache, resolving) ?? element;
    }
  }
  return element;
}

function resolveModelRef(reference: string, chunkCache: Map<string, string>, modelCache: Map<string, Json>, resolving: Set<string>): Json | null {
  const segments = reference.split(":");
  const id = segments[0];
  if (segments.length === 1 && chunkCache.has(id)) return chunkCache.get(id)!;
  if (resolving.has(id)) return null; // cycle
  const guard = new Set(resolving).add(id);
  if (!modelCache.has(id)) return null;
  let value: Json = modelCache.get(id);
  for (let i = 1; i < segments.length; i++) {
    if (typeof value === "string" && value.startsWith("$")) value = resolveNextJsRefs(value, chunkCache, modelCache, guard);
    const next = walkRefSegment(value, segments[i]);
    if (next === undefined) return null;
    value = next;
  }
  return resolveNextJsRefs(value, chunkCache, modelCache, guard);
}

function walkRefSegment(value: Json, segment: string): Json | undefined {
  if (isObject(value)) return value[segment];
  if (Array.isArray(value)) {
    if (value.length >= 4 && value[0] === "$") {
      const named = { type: 1, key: 2, props: 3 }[segment];
      if (named !== undefined) return value[named];
    }
    return /^-?\d+$/.test(segment) ? value[Number(segment)] : undefined;
  }
  return undefined;
}

function resolveMapRef(id: string, chunkCache: Map<string, string>, modelCache: Map<string, Json>, resolving: Set<string>): Json | null {
  if (resolving.has(id)) return null;
  const entries = modelCache.get(id);
  if (!Array.isArray(entries)) return null;
  const resolved = resolveNextJsRefs(entries, chunkCache, modelCache, new Set(resolving).add(id));
  if (!Array.isArray(resolved)) return null;
  const out: Record<string, Json> = {};
  for (const p of resolved) if (Array.isArray(p) && p.length === 2) out[typeof p[0] === "object" && p[0] !== null ? JSON.stringify(p[0]) : String(p[0])] = p[1];
  return out;
}

function resolveSetRef(id: string, chunkCache: Map<string, string>, modelCache: Map<string, Json>, resolving: Set<string>): Json | null {
  if (resolving.has(id)) return null;
  const values = modelCache.get(id);
  if (!Array.isArray(values)) return null;
  return resolveNextJsRefs(values, chunkCache, modelCache, new Set(resolving).add(id));
}

function tryJson(s: string): { ok: true; value: Json } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

function extractAppRouterPayloads(document: Document, chunkCache: Map<string, string>, modelCache: Map<string, Json>): Json[] {
  return document
    .select("script:not([src])")
    .map((it) => it.data())
    .filter((it) => it.includes("self.__next_f.push"))
    .flatMap((script) => {
      try {
        const raw = NEXT_F_REGEX.exec(script)?.[1];
        if (raw == null) return [];
        const arr = JSON.parse(raw) as Json[];
        const content = arr[1];
        if (typeof content !== "string") return [];
        return extractRscPayloads(content, chunkCache, modelCache);
      } catch {
        return [];
      }
    });
}

function extractPagesRouterPayloads(document: Document): Json[] {
  const data = document.selectFirst("script#__NEXT_DATA__")?.data();
  if (data == null) return [];
  try {
    const root = JSON.parse(data) as { props?: { pageProps?: Json } };
    return [root?.props?.pageProps, root].filter((it) => it != null);
  } catch {
    return [];
  }
}

const utf8Length = (c: number) => (c < 0x80 ? 1 : c < 0x800 ? 2 : 3);

function extractRscPayloads(body: string, chunkCache: Map<string, string>, modelCache: Map<string, Json>): Json[] {
  const results: Json[] = [];
  let pos = 0;
  while (pos < body.length) {
    const colonIdx = body.indexOf(":", pos);
    if (colonIdx === -1) break;
    const id = body.substring(pos, colonIdx);
    if (!id || !/^[0-9a-fA-F]+$/.test(id)) {
      pos++;
      continue;
    }
    pos = colonIdx + 1;
    if (pos >= body.length) break;

    if (body[pos] === "T") {
      // Binary chunk: T<hexLen>,<content>; the length counts UTF-8 bytes
      pos++;
      const commaIdx = body.indexOf(",", pos);
      if (commaIdx === -1) break;
      const byteLen = parseInt(body.substring(pos, commaIdx), 16);
      if (Number.isNaN(byteLen)) break;
      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;
      while (pos < body.length && bytes < byteLen) {
        const code = body.charCodeAt(pos);
        if (code >= 0xd800 && code <= 0xdbff) {
          bytes += 4;
          pos++;
        } else bytes += utf8Length(code);
        pos++;
      }
      const chunkContent = body.substring(start, pos);
      chunkCache.set(id, chunkContent);
      const parsed = tryJson(chunkContent);
      if (parsed.ok) results.push(parsed.value);
    } else {
      const [element, end] = parseJsonAt(body, pos);
      if (element !== undefined) {
        results.push(element);
        modelCache.set(id, element);
      }
      pos = end;
    }
  }
  return results;
}

/** The JSON value starting at `start` and the position right after it (undefined when it does not parse). */
function parseJsonAt(body: string, start: number): [Json | undefined, number] {
  if (start >= body.length) return [undefined, start];
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = start;
  while (i < body.length) {
    const c = body[i++];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) {
      const r = tryJson(body.substring(start, i));
      return [r.ok ? r.value : undefined, i];
    }
    if (depth === 0 && /\s/.test(c)) {
      const r = tryJson(body.substring(start, i - 1));
      return [r.ok ? r.value : undefined, i];
    }
  }
  return [undefined, i];
}

function firstMatch<T>(payloads: Json[], chunkCache: Map<string, string>, modelCache: Map<string, Json>, predicate: Predicate): T | null {
  for (const payload of payloads) {
    const result = extractValueNextJs(resolveNextJsRefs(payload, chunkCache, modelCache), predicate);
    if (result != null) return result as T;
  }
  return null;
}

/** Document.extractNextJs(predicate) */
export function extractNextJsFromDocument<T>(document: Document, predicate: Predicate): T | null {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, Json>();
  let payloads = extractAppRouterPayloads(document, chunkCache, modelCache);
  if (!payloads.length) payloads = extractPagesRouterPayloads(document);
  return firstMatch<T>(payloads, chunkCache, modelCache, predicate);
}

/** String.extractNextJsRsc(predicate): a raw `text/x-component` body. */
export function extractNextJsRsc<T>(body: string, predicate: Predicate): T | null {
  const chunkCache = new Map<string, string>();
  const modelCache = new Map<string, Json>();
  return firstMatch<T>(extractRscPayloads(body, chunkCache, modelCache), chunkCache, modelCache, predicate);
}

/** Response.extractNextJs(predicate): dispatches on Content-Type like upstream. */
export function extractNextJs<T>(response: Response, predicate: Predicate): T | null {
  const contentType = response.header("Content-Type") ?? "";
  if (contentType.includes("text/x-component")) return extractNextJsRsc<T>(response.text(), predicate);
  if (contentType.includes("text/html")) return extractNextJsFromDocument<T>(response.asJsoup(), predicate);
  throw new Error(`Unsupported Content-Type for Next.js extraction: ${contentType}`);
}

/** `it is JsonObject && "a" in it && "b" in it` */
export const hasKeys =
  (...keys: string[]): Predicate =>
  (it) =>
    isObject(it) && keys.every((k) => k in it);
