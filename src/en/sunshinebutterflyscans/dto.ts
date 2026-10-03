// Port of keiyoushi/extensions-source src/en/sunshinebutterflyscans/Dto.kt
import { SChapter, SManga } from "../../../sdk/index.ts";

export interface EntryDto {
  series: string;
  timestamp: string;
  num: number;
  chname: string;
  AlbumID: string;
  projectname: string;
  projectdesc: string;
  projectaltname: string;
  projectauthor: string;
  projectartist: string;
  projectthumb: string;
  projectstatus: string;
  projecttags: string;
}

const nonEmpty = (s: string): string | undefined => (s.length > 0 ? s : undefined);

const toStatus = (s: string): number => {
  switch (s) {
    case "current":
      return SManga.ONGOING;
    case "complete":
      return SManga.COMPLETED;
    case "dropped":
      return SManga.CANCELLED;
    case "licensed":
      return SManga.LICENSED;
    default:
      return SManga.UNKNOWN;
  }
};

export function entryToSManga(entry: EntryDto, cdnUrl: string): SManga {
  const manga = SManga.create();
  manga.title = entry.series;
  manga.thumbnail_url = cdnUrl + entry.projectthumb;
  manga.url = `/projects?n=${entry.projectname}`;
  let description = nonEmpty(entry.projectdesc) ?? "";
  if (entry.projectaltname.length > 0) description += `\n\nAlternative name: ${entry.projectaltname}`;
  manga.description = description;
  manga.genre = nonEmpty(entry.projecttags)?.replaceAll(",", ", ");
  manga.status = toStatus(entry.projectstatus);
  manga.author = nonEmpty(entry.projectauthor);
  manga.artist = nonEmpty(entry.projectartist);
  manga.initialized = true;
  return manga;
}

export function entryToSChapter(entry: EntryDto): SChapter {
  const chapter = SChapter.create();
  chapter.name = entry.chname;
  chapter.chapter_number = entry.num;
  chapter.date_upload = nonEmpty(entry.timestamp) ? Number(entry.timestamp) * 1000 : 0;
  chapter.url = `/read?series=${entry.projectname}&num=${entry.num}`;
  return chapter;
}

export interface GoogleDriveResponseDto {
  files: { id: string; name: string; imageMediaMetadata: { width: number } }[];
}

export interface ImgurResponseDto {
  data: { link: string }[];
}
