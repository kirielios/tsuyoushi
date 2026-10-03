// Port of keiyoushi/extensions-source src/all/jjcos/Dto.kt
import { SManga } from "../../../sdk/index.ts";

export interface IndexDto {
  posts: PostDto[];
}

export interface PostDto {
  title: string;
  link: string;
  feature?: string | null;
  content?: string | null;
  dateFormat?: string | null;
}

export function toSManga(post: PostDto, encodedPath: string): SManga {
  const mangaTitle = post.title.trim();
  if (mangaTitle.length === 0) throw new Error(`Missing title in ${post.link}`);

  const manga = SManga.create();
  manga.title = mangaTitle;
  manga.thumbnail_url = post.feature ?? undefined;
  manga.status = SManga.COMPLETED;
  manga.url = encodedPath;
  manga.initialized = true;
  return manga;
}
