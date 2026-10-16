// Port of keiyoushi lib/unpacker (JsUnpacker + Unbaser, from DatL4g/JsUnpacker): Dean Edwards' packer, undone by
// table lookup. Nothing is evaluated.

const ALPHABET: Record<number, string> = {
  52: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP",
  54: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR",
  62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  95: " !\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
};

function unbaser(base: number): (value: string) => number {
  if (base >= 2 && base <= 36) return (v) => (/^[0-9a-z]+$/i.test(v) ? Number.parseInt(v, base) || 0 : 0);
  const str = ALPHABET[base > 62 ? 95 : base > 54 ? 62 : base > 52 ? 54 : 52];
  const dict = new Map([...str].map((c, i) => [c, i]));
  return (v) => [...v].reverse().reduce((acc, c, i) => acc + Math.trunc(base ** i * (dict.get(c) ?? 0)), 0);
}

const PACKED = /eval\(function\(p,a,c,k,e,[rd]?/im;
const EXTRACT = /\}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/gim;

export const JsUnpacker = {
  detect: (script: string) => PACKED.test(script),
  unpack(script: string): string[] {
    if (!PACKED.test(script)) return [];
    return [...script.matchAll(EXTRACT)].flatMap((m) => {
      const [, payload, radixS, countS, symtabS] = m;
      const symtab = symtabS.split("|");
      const count = Number.parseInt(countS, 10);
      if (symtab.length !== count) return []; // cannot be unpacked correctly
      const unbase = unbaser(Number.parseInt(radixS, 10) || 10);
      return [payload.replace(/\b\w+\b/g, (word) => symtab[unbase(word)] || word)];
    });
  },
  unpackAndCombine(script: string): string | null {
    const joined = JsUnpacker.unpack(script).join(" ");
    return joined.trim() ? joined : null;
  },
};

/** keiyoushi.lib.autoUnpacker */
export const autoUnpacker = (packed: string): string | null => JsUnpacker.unpackAndCombine(packed);
