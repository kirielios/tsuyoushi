// Port of keiyoushi/extensions-source lib/randomua/Helper.kt and lib/randomua/UserAgentPreference.kt
//
// Upstream's `context(source: HttpSource)` becomes explicit `preferences` / `client` arguments (a source's
// `preferences` is protected), and Headers.Builder is the Fetch Headers the SDK's headersBuilder() returns.
// Upstream blocks the calling thread on the user-agent list download; headers are synchronous here, so
// setRandomUserAgent starts the download on first use and applies the chosen agent once it has arrived.
import type { HttpClient } from "../../sdk/network.ts";
import { EditTextPreference, ListPreference, type PreferenceScreen, type SharedPreferences } from "../../sdk/preferences.ts";

// --- Helper.kt

let userAgent: string | null = null;
let pending: Promise<string | null> | null = null;

export enum UserAgentType {
  MOBILE = "MOBILE",
  DESKTOP = "DESKTOP",
  OFF = "OFF",
}

interface UserAgentList {
  desktop: string[];
  mobile: string[];
}

const UA_DB_URL = "https://keiyoushi.github.io/user-agents/user-agents.json";

/** Async form of upstream's blocking getRandomUserAgent; the result is cached for the process, as upstream. */
export async function getRandomUserAgent(
  client: HttpClient,
  userAgentType: UserAgentType,
  filterInclude: string[],
  filterExclude: string[],
): Promise<string | null> {
  if (userAgent) return userAgent;

  const uaResponse = await client.get(UA_DB_URL, new Headers(), { ensureSuccess: false });
  if (!uaResponse.isSuccessful) return null;

  const userAgentList = uaResponse.parseAs<UserAgentList>();
  let list: string[];
  if (userAgentType === UserAgentType.DESKTOP) list = userAgentList.desktop;
  else if (userAgentType === UserAgentType.MOBILE) list = userAgentList.mobile;
  else throw new Error(`Expected UserAgentType.DESKTOP or UserAgentType.MOBILE but got UserAgentType.${userAgentType} instead`);

  const filtered = list
    .filter((it) => filterInclude.length === 0 || filterInclude.some((f) => it.toLowerCase().includes(f.toLowerCase())))
    .filter((it) => !filterExclude.some((f) => it.toLowerCase().includes(f.toLowerCase())));
  return (userAgent = filtered.length ? filtered[Math.floor(Math.random() * filtered.length)] : null);
}

// --- UserAgentPreference.kt

const PREF_KEY_RANDOM_UA = "pref_key_random_ua_";
const RANDOM_UA_ENTRIES = ["OFF", "Desktop", "Mobile"];
const RANDOM_UA_VALUES = ["off", "desktop", "mobile"];
const PREF_KEY_CUSTOM_UA = "pref_key_custom_ua_";

/** Helper function to return UserAgentType based on SharedPreference value */
function getPrefUAType(preferences: SharedPreferences): UserAgentType {
  switch (preferences.getString(PREF_KEY_RANDOM_UA, "off")) {
    case "mobile":
      return UserAgentType.MOBILE;
    case "desktop":
      return UserAgentType.DESKTOP;
    default:
      return UserAgentType.OFF;
  }
}

/** Helper function to return custom UserAgent from SharedPreference */
function getPrefCustomUA(preferences: SharedPreferences): string | null {
  const ua = preferences.getString(PREF_KEY_CUSTOM_UA, null);
  return ua?.trim() ? ua : null;
}

/**
 * Helper function to add user agent preference to the headers:
 * `headers.setRandomUserAgent(UserAgentType.MOBILE)` upstream is
 * `setRandomUserAgent(headers, this.preferences, this.client, UserAgentType.MOBILE)` here.
 *
 * @param userAgentType only set if you want to not include or bypass the preference value
 * @param filterInclude Filter to only include Random User Agents containing these strings
 * @param filterExclude Filter to exclude Random User Agents containing these strings
 */
export function setRandomUserAgent(
  headers: Headers,
  preferences: SharedPreferences,
  client: HttpClient,
  userAgentType: UserAgentType | null = null,
  filterInclude: string[] = [],
  filterExclude: string[] = [],
): Headers {
  const randomUserAgentType = userAgentType ?? getPrefUAType(preferences);
  const customUserAgent = getPrefCustomUA(preferences);

  let ua: string;
  if (randomUserAgentType !== UserAgentType.OFF) {
    if (!userAgent) {
      // ponytail: requests made before the list arrives keep the default agent; await getRandomUserAgent first if that matters
      pending ??= getRandomUserAgent(client, randomUserAgentType, filterInclude, filterExclude)
        .catch(() => null)
        .finally(() => (pending = null));
      return headers;
    }
    ua = userAgent;
  } else if (customUserAgent != null) {
    ua = customUserAgent;
  } else {
    return headers;
  }

  try {
    headers.set("User-Agent", ua);
  } catch {
    // upstream rejects an invalid custom agent when it is typed (Headers.headersOf); the app's form cannot, so skip it here
  }
  return headers;
}

/** Helper function to add Random User-Agent settings to SharedPreference: `screen.addRandomUAPreference()` upstream. */
export function addRandomUAPreference(screen: PreferenceScreen) {
  // setEnabled / change listeners (toasts, header validation) have no counterpart in the app's settings form
  const customUaPref = new EditTextPreference(screen.context);
  customUaPref.key = PREF_KEY_CUSTOM_UA;
  customUaPref.title = "Custom user agent string";
  customUaPref.summary = "Leave blank to use the default user agent string";

  const randomUaPref = new ListPreference(screen.context);
  randomUaPref.key = PREF_KEY_RANDOM_UA;
  randomUaPref.title = "Random user agent string";
  randomUaPref.entries = RANDOM_UA_ENTRIES;
  randomUaPref.entryValues = RANDOM_UA_VALUES;
  randomUaPref.summary = "%s";
  randomUaPref.setDefaultValue("off");
  screen.addPreference(randomUaPref);
  screen.addPreference(customUaPref);
}
