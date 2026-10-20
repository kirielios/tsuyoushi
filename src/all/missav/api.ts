// Port of yuzono/anime-extensions src/all/missav/MissAvApi.kt
import { toHex, utf8 } from "../../../sdk/index.ts";

export const RESULT_COUNT = 24;
const API_URL = "https://client-rapi-missav.recombee.com";
const PUBLIC_TOKEN = "Ikkg568nlM51RHvldlPvc2GzZPE9R4XGzaH9Qj4zK9npbbbTly1gj9K4mgRn0QlV";

export const MissAvApi = {
  generateUUID: (): string => crypto.randomUUID(),

  async searchURL(uuid: string): Promise<string> {
    return API_URL + (await generateHMACSignature(`/missav-default/search/users/${uuid}/items/?frontend_timestamp=${Date.now()}`, PUBLIC_TOKEN));
  },

  async recommURL(recommId: string): Promise<string> {
    return API_URL + (await generateHMACSignature(`/missav-default/recomms/next/items/${recommId}?frontend_timestamp=${Date.now()}`, PUBLIC_TOKEN));
  },

  searchData: (query: string): string => JSON.stringify(requestParams("search", undefined, query)),

  get recommData() {
    return `{"count":${RESULT_COUNT},"cascadeCreate":true}`;
  },
};

function requestParams(scenario: string, targetUserId?: string, searchQuery?: string) {
  return {
    ...(targetUserId != null && { targetUserId }),
    ...(searchQuery != null && { searchQuery }),
    count: RESULT_COUNT,
    scenario,
    returnProperties: true,
    includedProperties: ["title_en", "dm"],
    cascadeCreate: true,
  };
}

async function generateHMACSignature(data: string, key: string): Promise<string> {
  try {
    const k = await crypto.subtle.importKey("raw", utf8(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const hexString = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", k, utf8(data))));
    return `${data}&frontend_sign=${hexString}`;
  } catch {
    // Fallback to original path if signing fails
    return data;
  }
}
