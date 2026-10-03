// Port of keiyoushi/extensions-source src/en/monochromecustom/MonochromeCustom.kt
import { EditTextPreference, type PreferenceScreen } from "../../../sdk/index.ts";
import { MonochromeCMS } from "../../../themes/monochrome/index.ts";

const DEMO_API_URL = "https://api-3qnqyl7llq-lz.a.run.app";

export default class MonochromeCustom extends MonochromeCMS {
  protected override get apiUrl(): string {
    return this.preferences.getString("apiUrl", DEMO_API_URL)!;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new EditTextPreference(screen.context);
    p.key = "apiUrl";
    p.title = "API URL";
    p.summary = "The API URL of your Monochrome installation";
    p.setDefaultValue(DEMO_API_URL);
    screen.addPreference(p);
  }
}
