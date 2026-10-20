// Port of yuzono/anime-extensions src/all/animeonsen/AOAPIInterceptor.kt and SearchInterceptor.kt
import { GET, POST, type Chain, type ChainInterceptor, type Request } from "../../../sdk/index.ts";

export const AO_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.3";

const withAuth = (request: Request, token: string): Request => {
  const headers = new Headers(request.headers);
  headers.append("Authorization", `Bearer ${token}`);
  return { ...request, headers };
};

/** AOAPIInterceptor: an OAuth client-credentials token from auth.animeonsen.xyz on every API request, refreshed on a 401. */
export function AOAPIInterceptor(apiUrl: string): ChainInterceptor {
  const host = new URL(apiUrl).host;
  let token: string | null = null;
  let fetching: Promise<string | null> | null = null;

  // chain.proceed skips this interceptor, so the token request cannot recurse (upstream's separate tokenClient)
  const fetchToken = async (chain: Chain): Promise<string | null> => {
    try {
      const formBody = new URLSearchParams({
        client_id: "f296be26-28b5-4358-b5a1-6259575e23b7",
        client_secret: "349038c4157d0480784753841217270c3c5b35f4281eaee029de21cb04084235",
        grant_type: "client_credentials",
      });
      const headers = new Headers({ "User-Agent": AO_USER_AGENT, Accept: "application/json", Origin: "https://www.animeonsen.xyz", Referer: "https://www.animeonsen.xyz/" });
      const responseBody = (await chain.proceed(POST("https://auth.animeonsen.xyz/oauth/token", headers, formBody))).text();
      // If we still get an HTML page (Cloudflare block or wrong endpoint), fail gracefully
      if (!responseBody.trim() || responseBody.trimStart().startsWith("<")) return null;
      return (JSON.parse(responseBody) as { access_token?: string }).access_token ?? null;
    } catch {
      // Silently fail so we don't break endpoints that don't require auth (like Search)
      return null;
    }
  };

  // @Synchronized getOrRefreshToken: one fetch at a time, shared by every request waiting on it
  const getOrRefreshToken = async (chain: Chain, oldToken: string | null): Promise<string | null> => {
    if (token === oldToken) {
      fetching ??= fetchToken(chain).finally(() => (fetching = null));
      token = await fetching;
    }
    return token;
  };

  return async (chain) => {
    const originalRequest = chain.request();
    // Only apply API token to the API host, let SearchInterceptor handle the search host
    if (new URL(originalRequest.url).host !== host) return chain.proceed(originalRequest);

    const currentToken = await getOrRefreshToken(chain, null);
    const response = await chain.proceed(currentToken != null ? withAuth(originalRequest, currentToken) : originalRequest);
    if (response.code === 401) {
      const newToken = await getOrRefreshToken(chain, currentToken);
      if (newToken != null) return chain.proceed(withAuth(originalRequest, newToken));
    }
    return response;
  };
}

/** SearchInterceptor: the site's Meilisearch key, read once from the home page's ao-search-token meta. */
export function SearchInterceptor(baseUrl: string, searchUrl: string): ChainInterceptor {
  const host = new URL(searchUrl).host;
  let token: Promise<string> | null = null;
  return async (chain) => {
    const originalRequest = chain.request();
    if (new URL(originalRequest.url).host !== host) return chain.proceed(originalRequest);
    token ??= chain
      .proceed(GET(baseUrl))
      .then((r) => r.asJsoup().selectFirst("meta[name=ao-search-token]")?.attr("content") ?? "")
      .catch(() => "");
    return chain.proceed(withAuth(originalRequest, await token));
  };
}
