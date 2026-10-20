// rou.video moved from Next.js (__NEXT_DATA__, what upstream reads) to TanStack Start, which streams its loader data as
// seroval: a JS expression `$_TSR.router=($R=>$R[0]={...})($R["tsr"])` with unquoted keys, !0/!1, void 0 and $R[n]
// back-references. No eval in the reader, so this reads that subset of JS literals.

type Value = unknown;

export function parseTsrRouter(html: string): Record<string, Value> | null {
  const start = html.indexOf("$_TSR.router=($R=>");
  if (start < 0) return null;
  return new Parser(html, start + "$_TSR.router=($R=>".length).value() as Record<string, Value>;
}

/** The loader data of the page's own route (the deepest match that has any). */
export function loaderData<T>(html: string): T | null {
  const matches = (parseTsrRouter(html)?.matches ?? []) as { l?: unknown }[];
  for (let i = matches.length - 1; i >= 0; i--) if (matches[i].l != null) return matches[i].l as T;
  return null;
}

class Parser {
  private readonly refs: Value[] = [];
  constructor(
    private readonly s: string,
    private i: number,
  ) {}

  private fail(): never {
    throw new Error(`seroval: unexpected ${JSON.stringify(this.s.slice(this.i, this.i + 20))} at ${this.i}`);
  }
  private eat(token: string): boolean {
    if (!this.s.startsWith(token, this.i)) return false;
    this.i += token.length;
    return true;
  }

  value(): Value {
    const s = this.s;
    if (this.eat("$R[")) {
      const end = s.indexOf("]", this.i);
      const n = Number(s.slice(this.i, end));
      this.i = end + 1;
      if (!this.eat("=")) return this.refs[n];
      // the container is registered before its children, which may point back at it
      const c = s[this.i];
      if (c === "{" || c === "[") {
        const v: Value = c === "{" ? {} : [];
        this.refs[n] = v;
        this.fill(v);
        return v;
      }
      return (this.refs[n] = this.value());
    }
    const c = s[this.i];
    if (c === "{" || c === "[") {
      const v: Value = c === "{" ? {} : [];
      this.fill(v);
      return v;
    }
    if (c === '"') return this.string();
    if (this.eat("!0")) return true;
    if (this.eat("!1")) return false;
    if (this.eat("null")) return null;
    if (this.eat("void 0")) return undefined;
    if (this.eat("NaN")) return NaN;
    if (this.eat("Infinity")) return Infinity;
    if (this.eat("-Infinity")) return -Infinity;
    if (this.eat('new Date("')) {
      const end = s.indexOf('"', this.i);
      const d = s.slice(this.i, end);
      this.i = end;
      if (!this.eat('")')) this.fail();
      return d;
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(this.i, this.i + 40));
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    return this.fail();
  }

  private fill(v: Value) {
    const isArray = Array.isArray(v);
    this.i++; // { or [
    const close = isArray ? "]" : "}";
    while (!this.eat(close)) {
      if (isArray) {
        // seroval writes holes as ",,"
        if (this.s[this.i] === ",") {
          (v as Value[]).push(undefined);
          this.i++;
          continue;
        }
        (v as Value[]).push(this.value());
      } else {
        const key = this.s[this.i] === '"' ? this.string() : this.ident();
        if (!this.eat(":")) this.fail();
        (v as Record<string, Value>)[key] = this.value();
      }
      this.eat(",");
    }
  }

  private ident(): string {
    const m = /^[A-Za-z_$][\w$]*|^\d+/.exec(this.s.slice(this.i, this.i + 200));
    if (!m) this.fail();
    this.i += m[0].length;
    return m[0];
  }

  private string(): string {
    let out = "";
    this.i++; // opening quote
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) this.fail();
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      if (e === "u") {
        out += String.fromCharCode(Number.parseInt(this.s.slice(this.i, this.i + 4), 16));
        this.i += 4;
      } else if (e === "x") {
        out += String.fromCharCode(Number.parseInt(this.s.slice(this.i, this.i + 2), 16));
        this.i += 2;
      } else {
        out += ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[e] ?? e;
      }
    }
  }
}
