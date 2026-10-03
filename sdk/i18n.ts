// keiyoushi.lib.i18n.Intl. Messages are bundled as objects (from the upstream .properties files) instead of classpath
// resources. `intl["key"]` in Kotlin is `intl.get("key")` here; the class keeps its upstream name so ports read the same.

export type Messages = Record<string, Record<string, string>>; // language tag -> key -> text

export class Intl {
  readonly chosenLanguage: string;
  constructor(
    private readonly opts: { language: string; baseLanguage: string; availableLanguages: string[]; messages: Messages },
  ) {
    this.chosenLanguage = opts.availableLanguages.includes(opts.language) ? opts.language : opts.baseLanguage;
  }
  /** The message in the source's language, else English, else "[key]" - as upstream. */
  get(key: string): string {
    return this.opts.messages[this.chosenLanguage]?.[key] ?? this.opts.messages[this.opts.baseLanguage]?.[key] ?? `[${key}]`;
  }
  /** Java's String.format with %s / %d / %1$s placeholders. */
  format(key: string, ...args: unknown[]): string {
    let i = 0;
    return this.get(key).replace(/%(?:(\d+)\$)?[sd]/g, (_, n: string | undefined) => String(args[n ? Number(n) - 1 : i++] ?? ""));
  }
}

/** Parse a Java .properties file (used by tools/generate.ts to carry upstream messages over). */
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/\\\r?\n\s*/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const m = /^((?:\\.|[^=:\s])+)\s*[=:\s]\s*(.*)$/.exec(line);
    if (m) out[m[1].replace(/\\(.)/g, "$1")] = m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
  }
  return out;
}
