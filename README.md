# Tsuyoushi Extensions

### Please give the repo a :star:

| Build | Need Help? |
|-------|---------|
| [![Publish](https://github.com/kirielios/tsuyoushi/actions/workflows/publish.yml/badge.svg)](https://github.com/kirielios/tsuyoushi/actions/workflows/publish.yml) | [Open an issue](https://github.com/kirielios/tsuyoushi/issues/new) |

[Keiyoushi](https://github.com/keiyoushi/extensions-source) manga extensions (English and Indonesian) ported from Kotlin to TypeScript, for **web-based readers**.

Keiyoushi's extensions are Android APKs: outside Mihon they only run inside Suwayomi-Server, a JVM app you have to install and keep running. Tsuyoushi builds each extension into a small JavaScript bundle instead, so any JavaScript reader (Node.js, Next.js, Deno, Bun) can load it straight from a URL, with no Kotlin, JVM or Suwayomi-Server.

> Extensions still need a JavaScript **server-side** runtime, not a browser tab: manga sites send no CORS headers, so a page cannot fetch them directly.

## Usage

* In the reader, open **Settings → Browse → Extension stores**
* Copy & paste the following URL: https://kirielios.github.io/tsuyoushi/index.json

Every push to `main` rebuilds and republishes it (`.github/workflows/publish.yml`).

## Requests

To request a new source or a bug fix, [create an issue](https://github.com/kirielios/tsuyoushi/issues/new).

Please note that creating an issue does not mean that the source will be added or fixed in a timely
fashion, because the work is volunteer-based. Some sources may also be impossible to do or prohibitively
difficult to maintain (Cloudflare challenges, sites that need to run their own JavaScript).

If you would like to see a request fulfilled and have the necessary skills to do so, consider contributing!

## Contributing

Contributions are welcome! Fork, port or fix an extension on a branch, run
`npm run typecheck && npm test && npm run build && npm run check -- <pkg>`, and open a pull request with the
`check` output. Only maintainers merge to `main`; forks are welcome to publish their own builds under their own URL.

## Development

### Layout

| Path | What |
|---|---|
| `sdk/` | Mihon/Keiyoushi API in TypeScript (`KeiSource`, models, filters, Jsoup and OkHttp helpers). Names match the Kotlin so ports read line by line. |
| `src/<lang>/<name>/` | One port per upstream extension: `meta.json` + `icon.png` (generated), `index.ts` (hand-ported). |
| `tools/` | `generate`, `build`, `serve`, `check` |
| `dist/` | Build output: `index.json` and one bundle per extension. This is what gets published. |

### Porting an extension

```sh
npm run generate -- en/mangapill      # meta.json + icon from upstream build.gradle.kts
# write src/en/mangapill/index.ts from the upstream Kotlin (the generator prints the link)
npm run build
npm run check -- en.mangapill         # popular, latest, search, details, chapters, pages, first image against the live site
```

Bump `port` in `meta.json` when you change a port without an upstream `versionCode` change, so installed copies update.

### Testing a change before you push

Serve your local build and paste its URL into your reader instead of the published one:

```sh
npm run build && npm run serve        # http://localhost:4600/index.json
```

### Using it in your own reader

`index.json` lists every source (`"format": "mangareader-kei/1"`) with its bundle and icon paths. Each `dist/<pkg>/index.js` is an IIFE that defines `__tsuyoushi.create(host, meta)`, returning a `KeiSource` with Mihon's methods (`getPopularManga`, `getLatestUpdates`, `getSearchManga`, `fetchMangaUpdate` for details and chapters, `getPageList`, `getImage`, …).

`host` (see `sdk/host.ts`) is everything an extension gets from your reader: `fetch` (redirects, timeout, cookies), cheerio's `load`, a user agent, preferences and an optional image API for descrambling. `tools/node-host.ts` is a complete Node.js implementation you can copy; `tools/check.ts` shows how to load a bundle and call it.

## License

    Copyright 2015 Javier Tomás
    Copyright 2026 the Tsuyoushi contributors

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

See `LICENSE` and `NOTICE` for the full text and the list of changes from upstream.

## Disclaimer

This project does not have any affiliation with the content providers available. It hosts no manga: each
extension only tells the reader how to fetch a site's public pages, and runs on the reader's own machine.
Site owners or rights holders who want an extension removed can open an issue; it will be taken down.

This project is not affiliated with Keiyoushi or Mihon/Tachiyomi. Don't ask for help about these extensions at
their official support means. All credits for the original extensions go to the Keiyoushi contributors.
