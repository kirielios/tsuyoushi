// Port of keiyoushi/extensions-source lib/i18n/Intl.kt
//
// The SDK's Intl (sdk/i18n.ts) already carries get / format / chosenLanguage; this adds the rest of upstream's API.
// Messages are bundled objects (from the upstream .properties files) instead of classpath resources, so the
// constructor takes `messages` where upstream takes a ClassLoader and a message-file-name function.
import { Intl as SdkIntl, parseProperties, type Messages } from "../../sdk/i18n.ts";

export { parseProperties, type Messages };

export class Intl extends SdkIntl {
  /** java.text.Collator.getInstance(locale): `intl.collator.compare(a, b)` */
  readonly collator: globalThis.Intl.Collator;

  constructor(opts: { language: string; baseLanguage: string; availableLanguages: string[]; messages: Messages }) {
    super(opts);
    this.collator = new globalThis.Intl.Collator(this.chosenLanguage);
  }

  languageDisplayName(localeCode: string): string {
    let name = localeCode;
    try {
      name = new globalThis.Intl.DisplayNames([this.chosenLanguage], { type: "language" }).of(localeCode) ?? localeCode;
    } catch {
      // invalid tag: Java's Locale.forLanguageTag would yield an empty name; keep the code instead
    }
    return name.charAt(0).toLocaleUpperCase(this.chosenLanguage) + name.slice(1);
  }

  static createDefaultMessageFileName(lang: string): string {
    const langSnakeCase = lang.replace(/-/g, "_").toLowerCase();
    return `assets/i18n/messages_${langSnakeCase}.properties`;
  }
}
