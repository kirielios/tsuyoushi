// Port of keiyoushi/extensions-source src/en/mangago/SoJsonV4Deobfuscator.kt
/*
    Ported from https://github.com/hax0r31337/JSDec/blob/master/js/dec.js

    SPDX-License-Identifier: MIT
    Copyright (c) 2020 liulihaocai
 */
const splitRegex = /[a-zA-Z]+/;

export function decode(jsf: string): string {
  if (!jsf.startsWith("['sojson.v4']")) throw new Error("Obfuscated code is not sojson.v4");

  const args = jsf.substring(240, jsf.length - 59).split(splitRegex);

  return args
    .map((it) => {
      if (!/^[+-]?\d+$/.test(it)) throw new Error(`For input string: "${it}"`);
      return String.fromCharCode(Number.parseInt(it, 10));
    })
    .join("");
}
