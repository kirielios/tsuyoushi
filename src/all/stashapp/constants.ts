// Port of keiyoushi/extensions-source src/all/stashapp/StashConstants.kt

export const PREF_API_KEY = "api_key";

export const MANGA_BRIEF_PER_PAGE = 25;

export const MANGA_BRIEF_QUERY = `
    query MangaBrief($filter: FindFilterType) {
        findGalleries(filter: $filter) {
            galleries {
                id
                title
                folder {
                    path
                }
                cover {
                    paths {
                        thumbnail
                    }
                    visual_files {
                        __typename
                    }
                }
            }
        }
    }
`;

export const MANGA_DETAILS_QUERY = `
    query MangaDetails($id: ID!) {
        findGallery(id: $id) {
              id
              title
              folder {
                  path
              }
              photographer
              details
              tags {
                  name
              }
              cover {
                  paths {
                      thumbnail
                  }
                  visual_files {
                      __typename
                  }
              }
        }
    }
`;

export const CHAPTER_LIST_QUERY = `
    query ChapterList($id: ID!) {
        findGallery(id: $id) {
            id
            created_at
            photographer
        }
    }
`;

export const PAGE_LIST_QUERY = `
    query PageList($id: Int!) {
        findImages(
            filter: { per_page: -1, sort: "path" }
            image_filter: {
                galleries_filter: { id: { value: $id, modifier: EQUALS } }
                files_filter: { image_file_filter: { format: { value: "", modifier: NOT_EQUALS } } }
            }
        ) {
            images {
                id
            }
        }
    }
`;

