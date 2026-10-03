// Port of keiyoushi/extensions-source src/all/mangafire/VrfSigner.kt
import type { Request } from "../../../sdk/index.ts";

const TABLE_1 =
  "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==";
const KEY_1 = "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=";
const TABLE_2 =
  "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==";
const KEY_2 = "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==";
const TABLE_3 =
  "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==";
const KEY_3 = "DELOJgPsVaCcblDtTGMdHzM=";

const b64decode = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

const STAGES: [Uint8Array, Uint8Array, number][] = [
  [b64decode(TABLE_1), b64decode(KEY_1), 0x5a],
  [b64decode(TABLE_2), b64decode(KEY_2), 0x35],
  [b64decode(TABLE_3), b64decode(KEY_3), 0xba],
];

export class VrfSigner {
  /** Request rewriter (addInterceptor): adds `vrf` to every /api/ request. */
  interceptor() {
    return (request: Request): Request => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return request;

      // queryParameterNames (distinct, first-seen order) flatMap values, sortedBy key (stable)
      const names = [...new Set(url.searchParams.keys())];
      const params = names.flatMap((key) => url.searchParams.getAll(key).map((v): [string, string] => [key, v]));
      params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

      let sortedQueryUrl = url.pathname.replace(/^\/api/, "");
      if (params.length) {
        sortedQueryUrl += "?";
        let lastKey = "";
        let index = 0;
        sortedQueryUrl += params
          .map(([key, value]) => {
            // Put index in keys with suffix []
            let newKey = key;
            if (key.endsWith("[]")) {
              if (lastKey !== key) index = 0;
              lastKey = key;
              newKey = key.replace("[]", `[${index++}]`);
            }
            return `${newKey}=${value}`;
          })
          .join("&");
      }

      const search = new URLSearchParams();
      params.forEach(([k, v]) => search.append(k, v));
      search.append("vrf", this.sign(sortedQueryUrl));
      url.search = search.toString();
      return { ...request, url: url.href };
    };
  }

  sign(path: string): string {
    let data: Uint8Array = new TextEncoder().encode(path);
    for (const [table, key, iv] of STAGES) data = this.encryptStage(data, table, key, iv);
    // URL_SAFE | NO_PADDING | NO_WRAP
    return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private encryptStage(data: Uint8Array, table: Uint8Array, key: Uint8Array, iv: number): Uint8Array {
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i++) {
      prev = table[(data[i] ^ key[i % key.length] ^ prev) & 0xff];
      out[i] = prev;
    }
    return out;
  }
}
