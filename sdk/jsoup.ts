// The slice of Jsoup's Element/Elements API that extensions use, on top of cheerio. Method names match Jsoup so a
// port stays a line-by-line translation; the helpers from keiyoushi's Jsoup.kt (attrOrNull, textOrNull, ...) are
// methods here instead of Kotlin extension functions.
import type { AnyNode, Element as DomElement } from "domhandler";
import type { CheerioAPI } from "cheerio";

// Jsoup separates these with whitespace in text(); inline elements join directly ("He<b>llo</b>" -> "Hello").
const BLOCK = new Set(
  "address article aside blockquote br dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td tfoot th thead tr ul".split(" "),
);
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

function textOf(node: AnyNode, out: string[], own = false) {
  for (const child of (node as DomElement).children ?? []) {
    if (child.type === "text") out.push((child as unknown as { data: string }).data);
    else if (child.type === "tag") {
      const block = BLOCK.has((child as DomElement).name);
      if (block) out.push(" ");
      if (!own) textOf(child, out);
      if (block) out.push(" ");
    }
    // script, style and comments carry no text in Jsoup
  }
}

// Jsoup pseudo-classes css-select lacks, registered with cheerio in parseHtml. Case-insensitive like Jsoup.
const javaRegex = (re: string) => (re.startsWith("(?i)") ? new RegExp(re.slice(4), "i") : new RegExp(re));
const textStr = (el: AnyNode, own = false) => {
  const out: string[] = [];
  textOf(el, out, own);
  return normalize(out.join(""));
};
const JSOUP_PSEUDOS = {
  // Jsoup's :contains is case-insensitive over normalised text; css-select's built-in one is case-sensitive
  contains: (el: DomElement, v?: string | null) => textStr(el).toLowerCase().includes(normalize(v ?? "").toLowerCase()),
  containsown: (el: DomElement, v?: string | null) => textStr(el, true).toLowerCase().includes((v ?? "").toLowerCase()),
  containsdata: (el: DomElement, v?: string | null) =>
    el.children
      .map((c) => (c as unknown as { data?: string }).data ?? "")
      .join("")
      .toLowerCase()
      .includes((v ?? "").toLowerCase()),
  matchestext: (el: DomElement, v?: string | null) => javaRegex(v ?? "").test(textStr(el)),
  matchesown: (el: DomElement, v?: string | null) => javaRegex(v ?? "").test(textStr(el, true)),
  // Jsoup's [attr~=regex]; the argument is "name=" + encodeURIComponent(regex), see jsoupCss
  attrregex: (el: DomElement, v?: string | null) => {
    const [name, re] = (v ?? "").split("=");
    const value = el.attribs?.[name.toLowerCase()];
    return value !== undefined && javaRegex(decodeURIComponent(re)).test(value);
  },
};
/**
 * Jsoup syntax css-select reads differently. Attribute names may hold ":" and "." in Jsoup (`[wire:model.live=genre]`),
 * so those are escaped. css-select reads `:matches(...)` as `:is(...)` and CSS-unescapes pseudo arguments, so Jsoup's
 * regex pseudos are renamed and their backslashes (escaped parentheses included) re-escaped.
 */
export function jsoupCss(css: string): string {
  css = css.replace(/\[\s*([\w-]+(?:[:.][\w-]+)+)(?=\s*[\]=~|^$*!])/g, (_, name: string) => `[${name.replace(/[:.]/g, "\\$&")}`);
  // Jsoup's [attr~=value] is a regex find, not CSS's whitespace-separated word match
  css = css.replace(/\[\s*([\w-]+)\s*~=\s*([^\]]*)\]/g, (_, name: string, re: string) => `:attrregex(${name}=${encodeURIComponent(re.trim()).replace(/[()'!*~]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)})`);
  // Jsoup takes an unquoted attribute value up to "]", spaces included ([title=Next page]); CSS needs quotes
  css = css.replace(/\[\s*([\w-]+)\s*([|^$*!]?=)\s*([^"'\]=]*[^"'\]\s=][^"'\]]*)\]/g, (m, name: string, op: string, v: string) => (/\s/.test(v.trim()) ? `[${name}${op}"${v.trim()}"]` : m));
  // Jsoup's :eq(n) is the element sibling index, i.e. :nth-child(n + 1); cheerio's :eq is a position in the result set
  css = css.replace(/:eq\(\s*(\d+)\s*\)/g, (_, n: string) => `:nth-child(${Number(n) + 1})`);
  if (!/:matches/i.test(css)) return css;
  const re = /:matches(Own)?\(/gi;
  let out = "";
  let i = 0;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let j = re.lastIndex;
    for (; j < css.length && depth; j++) {
      if (css[j] === "\\") j++;
      else if (css[j] === "(") depth++;
      else if (css[j] === ")") depth--;
    }
    // css-what unescapes pseudo data twice: a backslash becomes 4, one before a paren 7 (the paren stays escaped)
    const arg = css.slice(re.lastIndex, j - 1).replace(/\\(.)/g, (_, c: string) => (c === "(" || c === ")" ? "\\".repeat(7) : "\\".repeat(4)) + c);
    out += `${css.slice(i, m.index)}:${m[1] ? "matchesown" : "matchestext"}(${arg})`;
    i = re.lastIndex = j;
  }
  return out + css.slice(i);
}

export class Element {
  constructor(
    private readonly $: CheerioAPI,
    readonly node: AnyNode,
    readonly baseUri: string,
  ) {}

  private get c() {
    return this.$(this.node);
  }
  private wrap(nodes: AnyNode[]) {
    return new Elements(...nodes.map((n) => new Element(this.$, n, this.baseUri)));
  }

  /** Jsoup matches this element too, not only its descendants: `img.selectFirst("img")` is the img itself. */
  private match(css: string) {
    css = jsoupCss(css);
    // addBack(css) filters without the custom pseudos; is() keeps them
    const found = this.c.find(css);
    return this.c.is(css) ? found.addBack() : found;
  }
  select(css: string): Elements {
    return this.wrap(this.match(css).toArray());
  }
  selectFirst(css: string): Element | null {
    const n = this.match(css).get(0);
    return n ? new Element(this.$, n, this.baseUri) : null;
  }
  selectLast(css: string): Element | null {
    return this.select(css).last();
  }
  /** Like Jsoup: missing attribute -> "", and an "abs:" prefix resolves the value against the page URL. */
  attr(name: string): string {
    if (name.startsWith("abs:")) return this.absUrl(name.slice(4));
    return this.c.attr(name) ?? "";
  }
  attrOrNull(name: string): string | null {
    const v = this.attr(name).trim();
    return v ? v : null;
  }
  hasAttr(name: string): boolean {
    return this.c.attr(name) !== undefined;
  }
  absUrl(name: string): string {
    const v = this.c.attr(name);
    if (!v) return "";
    try {
      // java.net.URL keeps literal spaces ("a.jpg 175w, b.jpg 350w" in abs:srcset); WHATWG URL encodes them
      const href = new URL(v.trim(), this.baseUri).href;
      return /\s/.test(v.trim()) && !v.includes("%20") ? href.replaceAll("%20", " ") : href;
    } catch {
      return "";
    }
  }
  text(): string {
    const out: string[] = [];
    textOf(this.node, out);
    return normalize(out.join(""));
  }
  textOrNull(): string | null {
    return this.text() || null;
  }
  ownText(): string {
    const out: string[] = [];
    textOf(this.node, out, true);
    return normalize(out.join(""));
  }
  ownTextOrNull(): string | null {
    return this.ownText() || null;
  }
  /** Raw text including line breaks, like Jsoup's wholeText(). */
  wholeText(): string {
    // Jsoup emits "\n" for <br>; cheerio's text() drops it
    const walk = (nodes: AnyNode[]): string =>
      nodes.map((n) => (n.type === "text" ? (n as unknown as { data: string }).data : n.type === "tag" && (n as unknown as { name: string }).name === "br" ? "\n" : "children" in n ? walk((n as unknown as { children: AnyNode[] }).children) : "")).join("");
    return walk(this.c.toArray().flatMap((e) => ("children" in e ? (e as unknown as { children: AnyNode[] }).children : [])));
  }
  /** Content of <script>/<style>, like Jsoup's data(). */
  data(): string {
    return this.c.html() ?? "";
  }
  html(): string {
    return this.c.html() ?? "";
  }
  outerHtml(): string {
    return this.$.html(this.node);
  }
  id(): string {
    return this.attr("id");
  }
  /** Document.location(): the URL the page came from (after redirects). */
  location(): string {
    return this.baseUri;
  }
  className(): string {
    return this.attr("class");
  }
  hasClass(name: string): boolean {
    return this.c.hasClass(name);
  }
  /** Removes this element from the document, like Jsoup's Element.remove(). */
  remove(): void {
    this.c.remove();
  }
  tagName(): string {
    return (this.node as DomElement).name ?? "";
  }
  is(css: string): boolean {
    return this.c.is(jsoupCss(css));
  }
  children(): Elements {
    return this.wrap(this.c.children().toArray());
  }
  /** Jsoup's childNodes(): elements as Element, text nodes as their whitespace-normalised text (TextNode.text()); comments are skipped. */
  childNodes(): (Element | string)[] {
    const out: (Element | string)[] = [];
    for (const n of (this.node as DomElement).children ?? []) {
      if (n.type === "text") out.push((n as unknown as { data: string }).data.replace(/\s+/g, " "));
      else if (n.type === "tag") out.push(new Element(this.$, n, this.baseUri));
    }
    return out;
  }
  parent(): Element | null {
    const p = this.c.parent().get(0);
    return p ? new Element(this.$, p, this.baseUri) : null;
  }
  nextElementSibling(): Element | null {
    const n = this.c.next().get(0);
    return n ? new Element(this.$, n, this.baseUri) : null;
  }
  /** `nextSibling() as? TextNode` then `.text()`: the text node right after this element, else null. */
  nextSiblingText(): string | null {
    const n = this.node.next;
    return n && n.type === "text" ? (n as unknown as { data: string }).data : null;
  }
  previousElementSibling(): Element | null {
    const n = this.c.prev().get(0);
    return n ? new Element(this.$, n, this.baseUri) : null;
  }
  /** Jsoup's closest(css): this element or the nearest ancestor matching, else null. */
  closest(css: string): Element | null {
    const n = this.c.closest(jsoupCss(css)).get(0);
    return n ? new Element(this.$, n, this.baseUri) : null;
  }
  /** Jsoup's parents(): ancestors, nearest first. */
  parents(): Elements {
    return this.wrap(this.c.parents().toArray());
  }
  /** Jsoup's previousElementSiblings(): preceding siblings, nearest first. */
  previousElementSiblings(): Elements {
    return this.wrap(this.c.prevAll().toArray());
  }
}

export type Document = Element;

export class Elements extends Array<Element> {
  // map/filter/slice return plain arrays, so `select(...).map(el => SManga)` is an ordinary SManga[]
  static get [Symbol.species]() {
    return Array;
  }
  first(): Element | null {
    return this[0] ?? null;
  }
  last(): Element | null {
    return this[this.length - 1] ?? null;
  }
  text(): string {
    return this.map((e) => e.text())
      .filter(Boolean)
      .join(" ");
  }
  textOrNull(): string | null {
    return this.text() || null;
  }
  /** First non-empty value among the elements, like Jsoup. */
  attr(name: string): string {
    for (const e of this) if (e.hasAttr(name.replace(/^abs:/, ""))) return e.attr(name);
    return "";
  }
  eachAttr(name: string): string[] {
    return this.filter((e) => e.hasAttr(name.replace(/^abs:/, ""))).map((e) => e.attr(name));
  }
  eachText(): string[] {
    return this.map((e) => e.text()).filter(Boolean);
  }
  select(css: string): Elements {
    return new Elements(...this.flatMap((e) => [...e.select(css)]));
  }
  html(): string {
    return this.map((e) => e.html()).join("\n");
  }
  isEmpty(): boolean {
    return this.length === 0;
  }
  /** Removes every element from the document, like Jsoup's Elements.remove(). */
  remove(): Elements {
    for (const e of this) e.remove();
    return this;
  }
}

/** Parse HTML into a document root whose relative links resolve against `baseUri` (Kotlin's String.asJsoup(baseUrl)). */
export function parseHtml(load: CheerioAPI["load"], html: string, baseUri: string): Document {
  // scriptingEnabled: false parses <noscript> content as elements, as Jsoup does (sites hide real <img> there)
  const $ = load(html, { pseudos: JSOUP_PSEUDOS, scriptingEnabled: false });
  return new Element($, $.root().get(0)!, baseUri);
}

/** Jsoup.parse(xml, baseUri, Parser.xmlParser()). Namespaced tags are selected with an escaped colon: "media\\:content". */
export function parseXml(load: CheerioAPI["load"], xml: string, baseUri: string): Document {
  const $ = load(xml, { xml: true, pseudos: JSOUP_PSEUDOS });
  return new Element($, $.root().get(0)!, baseUri);
}
