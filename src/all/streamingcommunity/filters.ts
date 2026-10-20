// Port of yuzono/anime-extensions src/all/streamingcommunity/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";

type Pair = [string, string];

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: Pair[],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
  isEmpty() {
    return this.vals[this.state][1] === "";
  }
  isDefault() {
    return this.state === 0;
  }
}

export class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> {
  constructor(
    name: string,
    private readonly param: string,
    vals: Pair[],
  ) {
    super(
      name,
      vals.map(([n, v]) => new UriMultiSelectOption(n, v)),
    );
  }
  addToUri(builder: HttpUrlBuilder) {
    for (const it of this.state.filter((o) => o.state)) builder.addQueryParameter(this.param, it.value);
  }
}

export class FeaturedFilter extends UriPartFilter {
  readonly uri = "genre[]";
  constructor(intl: Intl) {
    super(intl.get("featured"), [
      ["<select>", ""],
      [intl.get("action"), "4"],
      [intl.get("action_adventure"), "13"],
      [intl.get("adventure"), "11"],
      [intl.get("animation"), "19"],
      [intl.get("comedy"), "12"],
      [intl.get("crime"), "2"],
      [intl.get("documentary"), "24"],
      [intl.get("drama"), "1"],
      [intl.get("family"), "16"],
      [intl.get("fantasy"), "8"],
      [intl.get("history"), "22"],
      [intl.get("horror"), "7"],
      [intl.get("korean_drama"), "26"],
      [intl.get("music"), "14"],
      [intl.get("mystery"), "6"],
      [intl.get("news"), "37"],
      [intl.get("romance"), "15"],
      [intl.get("science_fiction"), "10"],
      [intl.get("thriller"), "5"],
      [intl.get("tvmovie"), "21"],
      [intl.get("war"), "9"],
      [intl.get("western"), "20"],
    ]);
  }
}

export class GenresFilter extends UriMultiSelectFilter {
  constructor(intl: Intl, uri = "genre[]") {
    super(intl.get("genres"), uri, [
      ["<select>", ""],
      [intl.get("action"), "4"],
      [intl.get("action_adventure"), "13"],
      [intl.get("adventure"), "11"],
      [intl.get("animation"), "19"],
      [intl.get("comedy"), "12"],
      [intl.get("crime"), "2"],
      [intl.get("documentary"), "24"],
      [intl.get("drama"), "1"],
      [intl.get("family"), "16"],
      [intl.get("fantasy"), "8"],
      [intl.get("history"), "22"],
      [intl.get("horror"), "7"],
      [intl.get("kids"), "25"],
      [intl.get("korean_drama"), "26"],
      [intl.get("music"), "14"],
      [intl.get("mystery"), "6"],
      [intl.get("news"), "37"],
      [intl.get("reality"), "18"],
      [intl.get("romance"), "15"],
      [intl.get("scifi_fantasy"), "3"],
      [intl.get("science_fiction"), "10"],
      [intl.get("soap"), "23"],
      [intl.get("thriller"), "5"],
      [intl.get("tvmovie"), "21"],
      [intl.get("war"), "9"],
      [intl.get("war_politics"), "17"],
      [intl.get("western"), "20"],
    ]);
  }
}

export class SortFilter extends UriPartFilter {
  readonly uri = "sort";
  constructor(intl: Intl) {
    super(intl.get("sort_by"), [
      [intl.get("release_date"), ""],
      [intl.get("last_air_date"), "last_air_date"],
      [intl.get("date_added"), "created_at"],
      [intl.get("score"), "score"],
      [intl.get("views"), "views"],
      [intl.get("name"), "name"],
    ]);
  }
}

export class YearFilter extends UriPartFilter {
  readonly uri = "year";
  constructor(intl: Intl) {
    const years: Pair[] = [];
    for (let y = new Date().getFullYear(); y >= 2000; y--) years.push([String(y), String(y)]);
    super(intl.get("year"), [["<select>", ""], ...years, ...["1990", "1980", "1970", "1960", "1950", "1940", "1930", "1920", "1910"].map((y): Pair => [y, y])]);
  }
}

export class ScoreFilter extends UriPartFilter {
  readonly uri = "score";
  constructor(intl: Intl) {
    super(intl.get("score"), [["<select>", ""], ...Array.from({ length: 10 }, (_, i): Pair => [String(i + 1), String(i + 1)])]);
  }
}

export class ServiceFilter extends UriPartFilter {
  readonly uri = "service";
  constructor(intl: Intl) {
    super(intl.get("service"), [
      ["<select>", ""],
      ["Netflix", "netflix"],
      ["PrimeVideo", "prime"],
      ["Disney+", "disney"],
      ["AppleTV+", "apple"],
      ["NowTV", "now"],
    ]);
  }
}

export class QualityFilter extends UriPartFilter {
  readonly uri = "quality";
  constructor(intl: Intl) {
    super(intl.get("quality"), [
      ["<select>", ""],
      ["HD", "HD"],
      ["SD", "SD"],
      ["TS", "TS"],
      ["CAM", "CAM"],
    ]);
  }
}

export class AgeFilter extends UriPartFilter {
  readonly uri = "age";
  constructor(intl: Intl) {
    super(intl.get("age"), [
      ["<select>", ""],
      ["7+", "7"],
      ["12+", "12"],
      ["14+", "14"],
      ["16+", "16"],
      ["18+", "18"],
    ]);
  }
}
