// Port of keiyoushi/extensions-source src/en/allanime/Queries.kt
export const POPULAR_QUERY = `
    query (
        $type: VaildPopularTypeEnumType!
        $size: Int!
        $page: Int
        $dateRange: Int
        $allowAdult: Boolean
        $allowUnknown: Boolean
    ) {
        queryPopular(
            type: $type
            size: $size
            dateRange: $dateRange
            page: $page
            allowAdult: $allowAdult
            allowUnknown: $allowUnknown
        ) {
            recommendations {
                anyCard {
                    _id
                    name
                    thumbnail
                    englishName
                }
            }
        }
    }
`;

export const SEARCH_QUERY = `
    query (
        $search: SearchInput
        $size: Int
        $page: Int
        $translationType: VaildTranslationTypeMangaEnumType
        $countryOrigin: VaildCountryOriginEnumType
    ) {
        mangas(
            search: $search
            limit: $size
            page: $page
            translationType: $translationType
            countryOrigin: $countryOrigin
        ) {
            edges {
                _id
                name
                thumbnail
                englishName
            }
        }
    }
`;

export const UPDATE_QUERY = `
    query ($id: String!, $showId: String!, $search: SearchInput) {
        manga(_id: $id, search: $search) {
            _id
            name
            thumbnail
            description
            authors
            genres
            tags
            status
            altNames
            englishName
            malId
            aniListId
            relatedMangas
            availableChaptersDetail
        }
        episodeInfos(
            showId: $showId
            episodeNumStart: 0
            episodeNumEnd: 9999
        ) {
            episodeIdNum
            notes
            uploadDates
        }
    }
`;

export const RELATED_QUERY = `
    query (
        $ids: [String!]!
        $search: SearchInput
        $fewerGenresSearch: SearchInput
        $size: Int
        $translationType: VaildTranslationTypeMangaEnumType
    ) {
      mangas(
          search: $search
          limit: $size
          translationType: $translationType
      ) {
        edges {
          _id
          name
          thumbnail
          englishName
        }
      }
      fewerGenresSearch: mangas(
          search: $fewerGenresSearch
          limit: $size
          translationType: $translationType
      ) {
        edges {
          _id
          name
          thumbnail
          englishName
        }
      }
      mangasWithIds(ids: $ids) {
        _id
        name
        thumbnail
        englishName
      }
    }
`;
