// Static decoder for the javascript-obfuscator (RC4 string array) output Kuramanime serves as /storage/leviathan.js.
// Nothing here runs the site's script: the string array, its rotation and the wrapper functions are parsed and
// evaluated by a small arithmetic interpreter that only knows numbers, strings, + - * / and parseInt.

type Value = number | string;
type Wrapper = { params: string[]; target: string; args: string[] };

const B64 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";

function b64(input: string): string {
  let out = "";
  for (let bc = 0, bs = 0, i = 0; i < input.length; i++) {
    const d = B64.indexOf(input[i]);
    if (d < 0) continue;
    bs = bc % 4 ? bs * 64 + d : d;
    if (bc++ % 4) out += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
  }
  try {
    return decodeURIComponent(Array.from(out, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
  } catch {
    return out;
  }
}

function rc4(data: string, key: string): string {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let out = "";
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    out += String.fromCharCode(data.charCodeAt(k) ^ s[(s[i] + s[j]) % 256]);
  }
  return out;
}

/** Decodes a JS string literal body (without the quotes). */
export function unescapeJs(body: string): string {
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, e: string) => {
    if (e[0] === "x" || e[0] === "u") return String.fromCharCode(Number.parseInt(e.slice(1), 16));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[e] ?? e;
  });
}

// --- tiny expression evaluator ------------------------------------------------------------------------------------

const TOKEN = /\s*(0x[0-9a-fA-F]+|\d+(?:\.\d+)?|'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|[A-Za-z_$][\w$]*|!!\[\]|[-+*/%(),])/y;

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(start))) break;
      throw new Error(`unexpected input at ${src.slice(start, start + 20)}`);
    }
    tokens.push(m[1]);
  }
  return tokens;
}

export class Deobfuscator {
  private readonly strings: string[];
  private readonly decoderName: string;
  private readonly offset: number;
  private readonly wrappers = new Map<string, Wrapper>();
  private readonly cache = new Map<string, string>();

  constructor(src: string) {
    const dec = /function (_0x\w+)\((_0x\w+),_0x\w+\)\{\2=\2-\(([^)]*)\);const _0x\w+=(_0x\w+)\(\)/.exec(src);
    if (!dec) throw new Error("decoder not found");
    this.decoderName = dec[1];
    const arrayName = dec[4];
    const arr = new RegExp(`function ${arrayName}\\(\\)\\{const _0x\\w+=\\[(.*?)\\];`).exec(src);
    if (!arr) throw new Error("string array not found");
    this.strings = Array.from(arr[1].matchAll(/'((?:[^'\\]|\\[\s\S])*)'/g), (m) => unescapeJs(m[1]));

    for (const m of src.matchAll(/function (_0x\w+)\(([\w,]*)\)\{return (_0x\w+)\(([^;{}]*)\);\}/g)) {
      this.wrappers.set(m[1], { params: m[2].split(","), target: m[3], args: splitArgs(m[4]) });
    }
    this.offset = 0;
    this.offset = this.evalExpr(dec[3], {}) as number;

    // Rotation: (function(arrayFn, target){ ... while(!![]){try{const x=EXPR;if(x===target)break;else push(shift)} ...}}(arrayFn, TARGET))
    const rot = new RegExp(`while\\(!!\\[\\]\\)\\{try\\{const _0x\\w+=(.*?);if\\(_0x\\w+===_0x\\w+\\)break;`).exec(src);
    const target = new RegExp(`\\}\\(${arrayName},([^)]*)\\)`).exec(src);
    if (!rot || !target) throw new Error("rotation not found");
    const want = this.evalExpr(target[1], {});
    for (let i = 0; i <= this.strings.length; i++) {
      this.cache.clear();
      try {
        if (this.evalExpr(rot[1], {}) === want) return;
      } catch {
        // a non-numeric string: rotate on
      }
      this.strings.push(this.strings.shift()!);
    }
    throw new Error("rotation did not converge");
  }

  /** The string the decoder returns for (index, key) once the offset is applied. */
  decode(index: number, key: string): string {
    const id = `${index}|${key}`;
    let v = this.cache.get(id);
    if (v === undefined) {
      const raw = this.strings[index - this.offset];
      if (raw === undefined) throw new Error(`index ${index} out of range`);
      v = rc4(b64(raw), key);
      this.cache.set(id, v);
    }
    return v;
  }

  /** Calls a wrapper (or the decoder) by name with already-evaluated arguments. */
  call(name: string, args: Value[]): Value {
    if (name === this.decoderName) return this.decode(args[0] as number, String(args[1]));
    if (name === "parseInt") return Number.parseInt(String(args[0]), 10);
    const w = this.wrappers.get(name);
    if (!w) throw new Error(`unknown function ${name}`);
    const scope: Record<string, Value> = {};
    w.params.forEach((p, i) => (scope[p] = args[i]));
    return this.call(
      w.target,
      w.args.map((a) => this.evalExpr(a, scope)),
    );
  }

  isCallable(name: string): boolean {
    return name === this.decoderName || this.wrappers.has(name);
  }

  evalExpr(src: string, scope: Record<string, Value>): Value {
    const t = tokenize(src);
    let p = 0;
    const peek = () => t[p];
    const next = () => t[p++];
    const expect = (s: string) => {
      if (next() !== s) throw new Error(`expected ${s}`);
    };
    const primary = (): Value => {
      const tok = next();
      if (tok === undefined) throw new Error("unexpected end");
      if (tok === "(") {
        const v = additive();
        expect(")");
        return v;
      }
      if (tok === "-") return -(primary() as number);
      if (tok === "+") return +primary();
      if (/^0x/.test(tok)) return Number.parseInt(tok, 16);
      if (/^\d/.test(tok)) return Number(tok);
      if (tok[0] === "'" || tok[0] === '"') return unescapeJs(tok.slice(1, -1));
      if (peek() === "(") {
        next();
        const args: Value[] = [];
        while (peek() !== ")") {
          args.push(additive());
          if (peek() === ",") next();
        }
        expect(")");
        return this.call(tok, args);
      }
      if (tok in scope) return scope[tok];
      throw new Error(`unknown identifier ${tok}`);
    };
    const multiplicative = (): Value => {
      let v = primary();
      while (peek() === "*" || peek() === "/" || peek() === "%") {
        const op = next();
        const r = primary() as number;
        v = op === "*" ? (v as number) * r : op === "/" ? (v as number) / r : (v as number) % r;
      }
      return v;
    };
    const additive = (): Value => {
      let v = multiplicative();
      while (peek() === "+" || peek() === "-") {
        const op = next();
        const r = multiplicative();
        v = op === "+" ? (typeof v === "string" || typeof r === "string" ? `${v}${r}` : v + r) : (v as number) - (r as number);
      }
      return v;
    };
    const v = additive();
    if (p !== t.length) throw new Error(`trailing input in ${src.slice(0, 40)}`);
    return v;
  }
}

/** Splits a comma-separated argument list at depth 0. */
export function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += src[++i];
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

const STR = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;
const CONCAT = `${STR}(?:\\+${STR})*`;

/**
 * The constant jLoadSecure posts as `authorization`: in the script it is
 * `const v = obj[key]; …; data["authorization"] = v`, with `obj = { key: "piece" + "piece" + … }`.
 */
export function findAuthorization(src: string): string | null {
  const d = new Deobfuscator(src);
  // Every wrapper call with literal arguments becomes the string it decodes to.
  const s = src.replace(/(_0x[0-9a-f]+)\(((?:\s*-?\s*-?0x[0-9a-f]+\s*,?|\s*'(?:[^'\\]|\\.)*'\s*,?)+)\)/g, (m, name: string) => {
    if (!d.isCallable(name)) return m;
    try {
      return JSON.stringify(d.evalExpr(m, {}));
    } catch {
      return m;
    }
  });
  const str = (expr: string) => String(d.evalExpr(expr, {}));
  for (const m of s.matchAll(new RegExp(`\\[(${CONCAT})\\]=(_0x\\w+)`, "g"))) {
    if (str(m[1]) !== "authorization") continue;
    const src = new RegExp(`${m[2]}=(_0x\\w+)\\[(${CONCAT})\\]`).exec(s);
    if (!src) continue;
    const key = str(src[2]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = new RegExp(`['"]${key}['"]:(${CONCAT})[,}]`).exec(s);
    if (value) return str(value[1]);
  }
  return null;
}
