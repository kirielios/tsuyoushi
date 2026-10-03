// Port of keiyoushi/extensions-source src/all/xcomic/Queries.kt

// ============================= Variables =============================
// Built inline in index.ts: kotlinx drops default-valued fields (encodeDefaults = false), so only non-defaults are sent.

// ============================= Queries ==============================
export const TITLE_BROWSE_QUERY = `
    query get_title_browse($select: Title_Browse_Select) {
        get_title_browse_items(select: $select) {
            id
            data {
                title
                native_title
                romanized_title
                original_language
                translated_languages
                type
                cover_local_url
                cover_url
                comic_ids
                chap_last_public_at
            }
        }
    }
`;

export const TITLE_NODE_QUERY = `
    query get_title_titleNode($id: ID!) {
        get_title_titleNode(id: $id) {
            id
            data {
                title
                alt_titles
                native_title
                romanized_title
                original_language
                translated_languages
                authors
                artists
                year
                type
                status
                description
                cover_local_url
                cover_local
                cover_url
                urlPath
                total_comics
                total_chapters
                total_follows
                total_reviews
                total_comments
                vote_avg
                vote_users
                vote_bay
                vote_val
                chap_last_public_at
                created_at
                updated_at
                is_merged
                merged_to
                comic_ids
                content_rating_id
                type_id
                demographic_ids
                genre_ids
                format_ids
                tracking_sites {
                    anilist
                    myanimelist
                    mangaupdates
                    kitsu
                    animeplanet
                    shikimori
                    mangabaka
                }
            }
        }
    }
`;

export const COMIC_NODE_QUERY = `
    query get_comicNode($id: ID!) {
        get_comicNode(id: $id) {
            id
            data {
                id
                name
                subName
                altNames
                authors
                artists
                originalLanguage
                translatedLanguage
                originalStatus
                uploadStatus
                type
                demographics
                contentRating
                genres
                tags
                publishers
                dbStatus
                isPublic
                follows
                reviews
                comments_total
                score_val
                is_hot
                is_new
                originalPubFrom { y m d }
                originalPubTill { y m d }
                originalPubZone
                chaps_normal
                dateUpload
                chapterNode_up_to {
                    id
                    data {
                        dname
                        datePublic
                    }
                }
                summary {
                    text
                }
                extraInfo {
                    text
                }
                readDirection
                urlPath
                urlCover
            }
        }
    }
`;

export const CHAPTER_LIST_QUERY = `
    query get_comic_chapterList_fullList($select: Select_Comic_ChapterList) {
        get_comic_chapterList_fullList(select: $select) {
            paging {
                next
                total
            }
            items {
                id
                data {
                    id
                    comicId
                    dbStatus
                    isFinal
                    volume
                    serial
                    dname
                    title
                    urlPath
                    dateCreate
                    datePublic
                    dateModify
                    chaNum
                    volNum
                    count_images
                    is_new
                    srcName
                    srcTitle
                    srcColor
                    comments_topic
                    comments_total
                    views_login
                    views_guest
                    profileNodes {
                        data {
                            name
                        }
                    }
                }
            }
        }
    }
`;

export const CHAPTER_UNIQ_LIST_QUERY = `
    query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
        get_comic_chapterList_uniqList(select: $select) {
            paging {
                next
                total
            }
            items {
                id
                data {
                    id
                    comicId
                    dbStatus
                    isFinal
                    volume
                    serial
                    dname
                    title
                    urlPath
                    dateCreate
                    datePublic
                    dateModify
                    chaNum
                    volNum
                    count_images
                    is_new
                    srcName
                    srcTitle
                    srcColor
                    comments_topic
                    comments_total
                    views_login
                    views_guest
                    profileNodes {
                        data {
                            name
                        }
                    }
                }
            }
        }
    }
`;

export const CHAPTER_PAGES_QUERY = `
    query($id: ID!) {
        get_chapterNode(id: $id) {
            id
            data {
                imageUrls
            }
        }
    }
`;

export const COMIC_PROBE_QUERY = `
    query get_comicNode($id: ID!) {
        get_comicNode(id: $id) {
            id
            data {
                name
                subName
                dbStatus
                isPublic
                translatedLanguage
                chaps_normal
                urlPath
                urlCover
            }
        }
    }
`;
