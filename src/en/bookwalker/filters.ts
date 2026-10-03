// Port of keiyoushi/extensions-source src/en/bookwalker/BookWalkerFilters.kt
import { Filter } from "../../../sdk/index.ts";
import { SortDto, TagInclusionMode, encodeSearchFilterOptionsRequest, encodeSearchHeaderRequest, SearchFilterOptionsResponseSchema, SearchHeaderResponseSchema, type FilterInfoDto, type SearchFilterOptionsDto, type SearchFilterOptionsResponseDto, type SearchHeaderResponseDto, type SearchRequestDto, type TagFilterDto } from "./dto.ts";
import { decodeProto } from "../../../sdk/protobuf.ts";
import type { BookWalker } from "./index.ts";

export class BookWalkerFilters {
  // There are an enormous amount of tags and while it's not hard to fetch the complete list,
  // Tachiyomi clients typically do not handle large lists of tags well at the moment.
  // BookWalker handles it by allowing users to search for tags by name, but that capability
  // is not supported by the Tachiyomi API.
  // For now, all of the secondary filters will be disabled, but some with a smaller number of
  // items like status (currently broken on BW's side) and launch year can be supported later.
  constructor(private readonly bookwalker: BookWalker) {}

  async fetchGenres(): Promise<FilterInfoDto[]> {
    const response = decodeProto<SearchHeaderResponseDto>(
      (await this.bookwalker.protoPost("ContentService/SearchHeader", encodeSearchHeaderRequest())).bytes(),
      SearchHeaderResponseSchema,
    );
    return this.getAllFilters(response.genres);
  }

  private async getAllFilters(initialList: SearchFilterOptionsDto): Promise<FilterInfoDto[]> {
    if (initialList._hasMore !== 1) return initialList.options;

    const results: FilterInfoDto[] = [];
    let lastResponse: SearchFilterOptionsResponseDto | undefined;
    do {
      lastResponse = decodeProto<SearchFilterOptionsResponseDto>(
        (
          await this.bookwalker.protoPost("CollectionService/SearchFilterOptionsV2", encodeSearchFilterOptionsRequest(initialList.filterType, { limit: 100, offset: lastResponse?.countInfo.offset ?? 0 }))
        ).bytes(),
        SearchFilterOptionsResponseSchema,
      );
      results.push(...lastResponse.results);
    } while ((lastResponse.countInfo.limit ?? 0) + (lastResponse.countInfo.offset ?? 0) <= lastResponse.countInfo.totalCount);

    return results;
  }
}

export interface SearchFilter {
  process(request: SearchRequestDto): SearchRequestDto;
}

export class SortFilter extends Filter.Sort implements SearchFilter {
  constructor() {
    super("Sort", ["Relevance", "Popular", "Updated Latest", "Alphabetical", "Newest"], { index: 0, ascending: true });
  }
  process(request: SearchRequestDto): SearchRequestDto {
    let sort: SortDto;
    switch (this.state?.index) {
      case 0: sort = SortDto.RELEVANCE; break;
      case 1: sort = SortDto.POPULAR; break;
      case 2: sort = SortDto.LAST_UPDATED; break;
      case 3: sort = SortDto.ALPHABETICAL_ASC; break;
      case 4: sort = SortDto.NEWEST; break;
      default: sort = SortDto.RELEVANCE;
    }
    if (this.state?.ascending === false) sort = sort.reverse();
    return { ...request, sort };
  }
}

export class TaggedTriState<T> extends Filter.TriState {
  constructor(
    name: string,
    readonly id: T,
    state = Filter.TriState.STATE_IGNORE,
  ) {
    super(name, state);
  }
}

export class TriStateFilter extends Filter.Group<TaggedTriState<string>> implements SearchFilter {
  constructor(
    name: string,
    readonly filterType: string,
    options: TaggedTriState<string>[],
  ) {
    super(name, options);
  }
  process(request: SearchRequestDto): SearchRequestDto {
    const include = this.state.flatMap((it): TagFilterDto[] => {
      if (it.state === Filter.TriState.STATE_INCLUDE) return [{ id: it.id, mode: TagInclusionMode.INCLUDE }];
      if (it.state === Filter.TriState.STATE_EXCLUDE) return [{ id: it.id, mode: TagInclusionMode.EXCLUDE }];
      return [];
    });
    return { ...request, filters: [...request.filters, { type: this.filterType, include }] };
  }
}
