// Port of keiyoushi/extensions-source src/en/mangamo/MangamoAuth.kt
import type { HttpClient } from "../../../sdk/index.ts";
import { MangamoConstants } from "./constants.ts";
import type { FirebaseAuthDto, FirebaseRegisterDto, MangamoLoginDto, TokenRefreshDto } from "./dto.ts";
import type { MangamoHelper } from "./helper.ts";

const parseJson = <T>(text: string): T => JSON.parse(text) as T;

export class MangamoAuth {
  private currentToken: string | undefined;
  private refreshToken = "";
  private expirationTime = 0;
  // synchronized(this)
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly helper: MangamoHelper,
    private readonly client: HttpClient,
    private readonly userToken: string,
  ) {}

  getIdToken(): Promise<string> {
    const run = this.lock.then(async () => {
      if (this.currentToken === undefined) {
        await this.obtainInitialIdToken();
      }
      await this.refreshIfNecessary();
      return this.currentToken!;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  async forceRefresh() {
    await this.obtainInitialIdToken();
  }

  private expireIn(seconds: number) {
    this.expirationTime = Date.now() + (seconds - 1) * 1000;
  }

  private async obtainInitialIdToken() {
    const mangamoLoginResponse = await this.client.post(`${MangamoConstants.FIREBASE_FUNCTION_BASE_PATH}/v3/login`, this.helper.jsonHeaders, `{"purchaserInfo":{"originalAppUserId":"${this.userToken}"}}`, { ensureSuccess: false });

    const customToken = parseJson<MangamoLoginDto>(mangamoLoginResponse.text()).accessToken;

    const googleIdentityResponse = await this.client.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${MangamoConstants.FIREBASE_API_KEY}`,
      new Headers({ "Content-Type": "application/json" }),
      `{"token":"${customToken}","returnSecureToken":true}`,
      { ensureSuccess: false },
    );

    const tokenInfo = parseJson<FirebaseAuthDto>(googleIdentityResponse.text());

    this.currentToken = tokenInfo.idToken;
    this.refreshToken = tokenInfo.refreshToken;
    this.expireIn(Number(tokenInfo.expiresIn));
  }

  private async refreshIfNecessary() {
    if (Date.now() > this.expirationTime) {
      const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });

      const refreshResponse = await this.client.post(
        `https://securetoken.googleapis.com/v1/token?key=${MangamoConstants.FIREBASE_API_KEY}`,
        headers,
        `grant_type=refresh_token&refresh_token=${this.refreshToken}`,
        { ensureSuccess: false },
      );

      if (refreshResponse.code === 200) {
        const tokenInfo = parseJson<TokenRefreshDto>(refreshResponse.text());

        this.currentToken = tokenInfo.id_token;
        this.refreshToken = tokenInfo.refresh_token;
        this.expireIn(Number(tokenInfo.expires_in));
      } else {
        // Refresh token may have expired
        await this.obtainInitialIdToken();
      }
    }
  }

  static async createAnonymousUserToken(client: HttpClient): Promise<string> {
    const googleIdentityResponse = await client.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${MangamoConstants.FIREBASE_API_KEY}`,
      new Headers({ "Content-Type": "application/json" }),
      `{"returnSecureToken":true}`,
      { ensureSuccess: false },
    );

    const tokenInfo = parseJson<FirebaseRegisterDto>(googleIdentityResponse.text());

    return tokenInfo.localId;
  }
}
