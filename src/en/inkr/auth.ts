// Port of keiyoushi/extensions-source src/en/inkr/InkrAuth.kt
import { HttpUrl, parseAs, type HttpClient } from "../../../sdk/index.ts";

interface StoredAuthUser {
  key?: string;
  value?: string;
}

interface FirebaseAuthUserDto {
  apiKey?: string;
  stsTokenManager?: { accessToken?: string; refreshToken?: string; expirationTime?: number } | null;
}

interface TokenRefreshDto {
  id_token?: string;
  refresh_token?: string;
  expires_in?: string;
}

interface PaymentInfoEnvelope {
  code?: number;
  data?: { isSubscriber?: boolean } | null;
  isSubscriber?: boolean;
}

const STORAGE_KEY_API_KEY = /^firebase:authUser:([^:]+):/;

const apiKeyFromStorageKey = (key: string): string | null => STORAGE_KEY_API_KEY.exec(key)?.[1] || null;

export class InkrAuth {
  /** kotlinx Mutex: ensureLoaded runs one at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  accessToken: string | null = null;
  private refreshToken: string | null = null;
  private firebaseApiKey: string | null = null;
  private expiresAtMs = 0;
  isSubscriber = false;
  private paymentLoaded = false;

  constructor(
    private readonly client: () => HttpClient,
    private readonly baseUrl: () => string,
  ) {}

  ensureLoaded(): Promise<void> {
    const run = this.lock.then(async () => {
      const now = Date.now();
      if (this.accessToken != null && now < this.expiresAtMs - 30_000) {
        // still valid
      } else if (this.refreshToken != null && (await this.refreshAccessToken())) {
        // refreshed
      } else {
        await this.loadFromWebView();
      }

      if (this.accessToken != null) {
        if (!this.paymentLoaded) {
          this.isSubscriber = await this.fetchIsSubscriber();
          this.paymentLoaded = true;
        }
      } else {
        this.isSubscriber = false;
        this.paymentLoaded = false;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private clearSession() {
    this.accessToken = null;
    this.refreshToken = null;
    this.firebaseApiKey = null;
    this.expiresAtMs = 0;
    this.isSubscriber = false;
    this.paymentLoaded = false;
  }

  private async loadFromWebView() {
    const stored = await this.readAuthUser();
    if (stored == null) {
      this.clearSession();
      return;
    }
    let user: FirebaseAuthUserDto | null = null;
    try {
      user = parseAs<FirebaseAuthUserDto>(stored.value ?? "");
    } catch {
      user = null;
    }
    const sts = user?.stsTokenManager;
    if (sts == null || !sts.accessToken) {
      this.clearSession();
      return;
    }
    this.accessToken = sts.accessToken;
    this.refreshToken = sts.refreshToken || null;
    this.firebaseApiKey = user!.apiKey || apiKeyFromStorageKey(stored.key ?? "");
    const exp = sts.expirationTime ?? 0;
    this.expiresAtMs = exp > 1_000_000_000_000 ? exp : exp > 0 ? exp * 1000 : Date.now() + 50 * 60_000;
    if (Date.now() >= this.expiresAtMs - 30_000 && this.refreshToken != null) {
      await this.refreshAccessToken();
    }
    this.paymentLoaded = false;
  }

  private async fetchIsSubscriber(): Promise<boolean> {
    const token = this.accessToken;
    if (token == null) return false;
    const bearer = await this.readIsSubscriber(`Bearer ${token}`);
    if (bearer != null) return bearer;
    return (await this.readIsSubscriber(token)) ?? false;
  }

  private async readIsSubscriber(authorization: string): Promise<boolean | null> {
    const headers = new Headers({ Authorization: authorization, "ikc-platform": "web", Accept: "application/json" });
    let response;
    try {
      response = await this.client().get("https://inkr-payment-api.inkr.com/v1/user/my-info", headers, { ensureSuccess: false });
    } catch {
      return null;
    }

    if (!response.isSuccessful) return null;

    let envelope: PaymentInfoEnvelope | null = null;
    try {
      envelope = response.parseAs<PaymentInfoEnvelope>();
    } catch {
      envelope = null;
    }
    if (envelope != null) return envelope.data?.isSubscriber ?? envelope.isSubscriber ?? false;
    return null;
  }

  /**
   * Upstream runs a WebView on baseUrl and evaluates its own script (READ_AUTH_JS) to read Firebase's authUser from
   * localStorage / IndexedDB. There is no WebView here, so this ends as upstream's runCatching does when the WebView
   * fails: null, and the source stays anonymous (free chapters only).
   */
  private async readAuthUser(): Promise<StoredAuthUser | null> {
    void this.baseUrl;
    return null;
  }

  private async refreshAccessToken(): Promise<boolean> {
    const token = this.refreshToken;
    if (token == null) return false;
    const apiKey = this.firebaseApiKey;
    if (apiKey == null) return false;
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: token });
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    const url = HttpUrl.parse("https://securetoken.googleapis.com/v1/token").newBuilder().addQueryParameter("key", apiKey).build();
    let response: TokenRefreshDto;
    try {
      response = (await this.client().post(url.toString(), headers, body)).parseAs<TokenRefreshDto>();
    } catch {
      return false;
    }

    if (!response.id_token) return false;
    this.accessToken = response.id_token;
    if (response.refresh_token) this.refreshToken = response.refresh_token;
    const expiresIn = Number.parseInt(response.expires_in ?? "3600", 10);
    this.expiresAtMs = Date.now() + (Number.isNaN(expiresIn) ? 3600 : expiresIn) * 1000;
    return true;
  }
}
