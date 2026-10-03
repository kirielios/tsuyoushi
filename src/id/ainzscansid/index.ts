// Port of keiyoushi/extensions-source src/id/ainzscansid/AinzScansID.kt
import { Page, toHttpUrlOrNull } from "../../../sdk/index.ts";
import { LoneSeal, UrlLayout, type ChapterPagesResponseDto } from "../../../themes/loneseal/index.ts";

const adDomainRegex = /^999(?:-\d+)?\.jpe?g$/;
const adDonationRegex = /^997(?:-\d+)?\.jpe?g$/;
const adVotePreRegex = /^00\.0\.jpg$/;
const adReadOnRegex = /^00\.1\.jpg$/;
const adVotePostRegex = /^995\.jpg$/;

export default class AinzScansID extends LoneSeal {
  protected override urlLayout = UrlLayout.LEGACY_COMIC;
  protected override includeProjectOnlyFilter = true;
  protected override get overloadedGenres(): Set<string> {
    return new Set([...super.overloadedGenres, "adventure"]);
  }

  protected override toPageList(dto: ChapterPagesResponseDto): Page[] {
    const out: Page[] = [];
    const pages = dto.chapter.pages ?? [];
    const lastIndex = pages.length - 1;
    pages.forEach((page, i) => {
      const url = cleanUp(page.image_url);
      const filename = toHttpUrlOrNull(url)?.pathSegments.at(-1);
      let isAd = false;
      if (i === lastIndex) isAd = filename != null && adDomainRegex.test(filename);
      else if (i === lastIndex - 2) isAd = filename != null && (adDonationRegex.test(filename) || adVotePostRegex.test(filename));
      else if (i === 0) isAd = filename != null && adVotePreRegex.test(filename);
      else if (i === 1) isAd = filename != null && adReadOnRegex.test(filename);
      if (!isAd) out.push(new Page(i, "", url));
    });
    return out;
  }
}

function cleanUp(s: string): string {
  let url = s.startsWith("http") ? s : `https://api.ainzscans01.com${s}`;
  // Fix for older chapters using Blogger/Googleusercontent compressed images
  if (url.includes("googleusercontent.com") || url.includes("bp.blogspot.com")) {
    url = url.replace(/=[swh]\d+[^/?]*($|\?)/i, "=s0$1").replace(/\/[swh]\d+[^/]*\//i, "/s0/");
  }
  // Clean up common CMS resizing query parameters
  const httpUrl = toHttpUrlOrNull(url);
  if (httpUrl != null && ["w", "width", "resize"].some((it) => new URL(httpUrl.toString()).searchParams.has(it))) {
    url = httpUrl.newBuilder().removeAllQueryParameters("w").removeAllQueryParameters("width").removeAllQueryParameters("resize").build().toString();
  }
  return url;
}
