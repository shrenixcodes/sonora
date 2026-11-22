import { describe, it, expect } from "vitest";
import {
  artworkUrl,
  parseDuration,
  parseContinuation,
  parseHomeChips,
  parseHomeShelves,
  parseLibraryPlaylists,
  parseWatchPlaylist,
  parsePlaylistTracks,
  parseSearchSongs,
} from "../src/lib/ytm/parse";

// Fixtures follow the structure of real responses captured from music.youtube.com,
// trimmed to the fields the parsers read.

const SEP = { text: " • " };
const artist = (text: string) => ({
  text,
  navigationEndpoint: {
    browseEndpoint: {
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } },
    },
  },
});
const album = (text: string) => ({
  text,
  navigationEndpoint: {
    browseEndpoint: {
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } },
    },
  },
});
const column = (...runs: object[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } });
const thumbs = (base: string) => ({
  musicThumbnailRenderer: {
    thumbnail: {
      thumbnails: [
        { url: `${base}=w60-h60-l90-rj`, width: 60, height: 60 },
        { url: `${base}=w120-h120-l90-rj`, width: 120, height: 120 },
      ],
    },
  },
});

function songRow(videoId: string, title: string, detailRuns: object[], extra: object[] = []) {
  return {
    musicResponsiveListItemRenderer: {
      thumbnail: thumbs(`https://lh3.googleusercontent.com/${videoId}`),
      flexColumns: [
        column({ text: title, navigationEndpoint: { watchEndpoint: { videoId } } }),
        column(...detailRuns),
        ...extra,
      ],
      playlistItemData: { videoId },
      menu: { menuRenderer: { items: [] } },
    },
  };
}

const searchResponse = {
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  { chipCloudRenderer: {} },
                  {
                    musicShelfRenderer: {
                      contents: [
                        songRow("FXovf5dsRTw", "Despacito", [
                          artist("Luis Fonsi"), { text: " & " }, artist("Daddy Yankee"), SEP, album("Despacito"), SEP, { text: "3:49" },
                        ], [column({ text: "10B plays" })]),
                        // Real results include artists without a link.
                        songRow("-yLiEXVZTHs", "Despacito (Bollywood Version)", [
                          artist("Vivek Agrawal"), { text: " & Tanvi Shah" }, SEP, album("Despacito"), SEP, { text: "3:41" },
                        ]),
                        songRow("FXovf5dsRTw", "Despacito", [artist("Luis Fonsi")]),
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

describe("parseSearchSongs", () => {
  it("reads title, artists, album, duration and sharp artwork", () => {
    const [first, second] = parseSearchSongs(searchResponse);

    expect(first).toEqual({
      id: "FXovf5dsRTw",
      title: "Despacito",
      artist: "Luis Fonsi & Daddy Yankee",
      album: "Despacito",
      duration: 229,
      artworkUrl: "https://lh3.googleusercontent.com/FXovf5dsRTw=w544-h544-l90-rj",
    });
    expect(second.artist).toBe("Vivek Agrawal & Tanvi Shah");
    expect(second.duration).toBe(221);
  });

  it("drops duplicate songs and rows without a video", () => {
    const withBroken = structuredClone(searchResponse);
    const shelf = (withBroken.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer
      .contents[1] as { musicShelfRenderer: { contents: object[] } }).musicShelfRenderer;
    shelf.contents.push({ musicResponsiveListItemRenderer: { flexColumns: [column({ text: "No video" })] } });

    expect(parseSearchSongs(withBroken).map((t) => t.id)).toEqual(["FXovf5dsRTw", "-yLiEXVZTHs"]);
  });

  it("returns nothing for an unexpected shape instead of throwing", () => {
    expect(parseSearchSongs({})).toEqual([]);
    expect(parseSearchSongs(null)).toEqual([]);
  });
});

const browse = (browseId: string, pageType: string) => ({
  browseEndpoint: {
    browseId,
    browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
  },
});

describe("parseHomeShelves", () => {
  const shelf = (title: string, contents: object[]) => ({
    musicCarouselShelfRenderer: {
      header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] } } },
      contents,
    },
  });
  const homeResponse = {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    shelf("Song mixes", [
                      songRow("WlTlUseVt7E", "Beat It", [artist("Michael Jackson"), SEP, { text: "2.3B plays" }], [
                        column(album("HIStory: PAST, PRESENT AND FUTURE, BOOK I")),
                      ]),
                    ]),
                    shelf("Divine Tunes", [
                      {
                        musicTwoRowItemRenderer: {
                          title: { runs: [{ text: "Bhajan Clubbing" }] },
                          subtitle: { runs: [{ text: "Playlist" }] },
                          navigationEndpoint: browse("VLxyz", "MUSIC_PAGE_TYPE_PLAYLIST"),
                        },
                      },
                      {
                        musicTwoRowItemRenderer: {
                          title: { runs: [{ text: "Thriller" }] },
                          navigationEndpoint: browse("MPREb_1", "MUSIC_PAGE_TYPE_ALBUM"),
                          thumbnailOverlay: {
                            musicItemThumbnailOverlayRenderer: {
                              content: {
                                musicPlayButtonRenderer: {
                                  playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: "OLAK5uy_1" } },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        musicTwoRowItemRenderer: {
                          title: { runs: [{ text: "Arijit Singh" }] },
                          navigationEndpoint: browse("UC1", "MUSIC_PAGE_TYPE_ARTIST"),
                        },
                      },
                      // An album with no way to play it is left out.
                      {
                        musicTwoRowItemRenderer: {
                          title: { runs: [{ text: "Unplayable" }] },
                          navigationEndpoint: browse("MPREb_2", "MUSIC_PAGE_TYPE_ALBUM"),
                        },
                      },
                    ]),
                    shelf("Music videos for you", [
                      {
                        musicTwoRowItemRenderer: {
                          title: { runs: [{ text: "Heart" }] },
                          subtitle: { runs: [artist("Pet Shop Boys"), SEP, { text: "7M views" }] },
                          navigationEndpoint: { watchEndpoint: { videoId: "uduy2mebnOk" } },
                          thumbnailRenderer: thumbs("https://i.ytimg.com/vi/uduy2mebnOk"),
                        },
                      },
                    ]),
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };

  it("keeps song, album, playlist and artist shelves in order", () => {
    const shelves = parseHomeShelves(homeResponse);

    expect(shelves.map((s) => s.title)).toEqual(["Song mixes", "Divine Tunes", "Music videos for you"]);
    expect(shelves.map((s) => s.layout)).toEqual(["list", "cards", "cards"]);
    expect(shelves[1].items).toEqual([
      { kind: "playlist", title: "Bhajan Clubbing", subtitle: "Playlist", artworkUrl: "", playlistId: "xyz" },
      { kind: "album", title: "Thriller", subtitle: "", artworkUrl: "", playlistId: "OLAK5uy_1" },
      { kind: "artist", title: "Arijit Singh", subtitle: "", artworkUrl: "" },
    ]);
    expect(shelves[1].tracks).toEqual([]);
    shelves.splice(1, 1);
    expect(shelves[0].tracks[0]).toMatchObject({
      id: "WlTlUseVt7E",
      title: "Beat It",
      artist: "Michael Jackson",
      album: "HIStory: PAST, PRESENT AND FUTURE, BOOK I",
      duration: 0,
    });
    expect(shelves[1].tracks[0]).toMatchObject({ id: "uduy2mebnOk", title: "Heart", artist: "Pet Shop Boys" });
  });
});

describe("helpers", () => {
  it("parses minute and hour durations and rejects other text", () => {
    expect(parseDuration("3:49")).toBe(229);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("10B plays")).toBe(0);
  });

  it("leaves artwork URLs without a size suffix alone", () => {
    expect(artworkUrl([{ url: "https://i.ytimg.com/vi/x/hqdefault.jpg", width: 480 }])).toBe(
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
    );
    expect(artworkUrl([])).toBe("");
  });
});

describe("parsePlaylistTracks", () => {
  it("reads songs from a playlist shelf and its continuation token", () => {
    const response = {
      contents: {
        musicPlaylistShelfRenderer: {
          contents: [
            songRow("abc", "First", [artist("A"), SEP, { text: "2:01" }]),
            songRow("def", "Second", [artist("B")]),
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "NEXT" } } } },
          ],
        },
      },
    };
    expect(parsePlaylistTracks(response).map((t) => t.id)).toEqual(["abc", "def"]);
    expect(parseContinuation(response)).toBe("NEXT");
  });

  it("finds older continuation tokens and reports none when the list ends", () => {
    expect(parseContinuation({ continuations: [{ nextContinuationData: { continuation: "OLD" } }] })).toBe("OLD");
    expect(parseContinuation({ contents: [] })).toBeNull();
  });
});

describe("parseLibraryPlaylists", () => {
  const card = (title: string, browseId?: string) => ({
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: title }] },
      subtitle: { runs: [{ text: "Playlist" }, SEP, { text: "12 songs" }] },
      thumbnailRenderer: thumbs(`https://lh3.googleusercontent.com/${title}`),
      navigationEndpoint: browseId ? { browseEndpoint: { browseId } } : { createPlaylistEndpoint: {} },
    },
  });

  it("keeps saved playlists and skips the new-playlist card and duplicates", () => {
    const response = { items: [card("New playlist"), card("Liked Music", "VLLM"), card("Mix", "VLPL1"), card("Mix", "VLPL1")] };
    const playlists = parseLibraryPlaylists(response);
    expect(playlists.map((p) => p.id)).toEqual(["LM", "PL1"]);
    expect(playlists[1]).toMatchObject({ title: "Mix", subtitle: "Playlist • 12 songs" });
    expect(playlists[1].artworkUrl).toContain("=w544-h544");
  });
});

describe("parseHomeChips", () => {
  it("reads chips that filter Home and skips ones without a filter", () => {
    const chip = (text: string, params?: string) => ({
      chipCloudChipRenderer: {
        text: { runs: [{ text }] },
        navigationEndpoint: { browseEndpoint: { browseId: "FEmusic_home", ...(params ? { params } : {}) } },
      },
    });
    expect(parseHomeChips({ chips: [chip("Relax", "ggM%3D"), chip("Broken")] })).toEqual([
      { title: "Relax", params: "ggM%3D" },
    ]);
  });
});

describe("parseWatchPlaylist", () => {
  it("reads songs from a mix's watch queue", () => {
    const response = {
      contents: [
        {
          playlistPanelVideoRenderer: {
            videoId: "abc",
            title: { runs: [{ text: "Tum Hi Ho" }] },
            longBylineText: { runs: [artist("Arijit Singh"), SEP, album("Aashiqui 2"), SEP, { text: "2013" }] },
            lengthText: { runs: [{ text: "4:22" }] },
            thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/a=w60-h60", width: 60 }] },
          },
        },
        { playlistPanelVideoRenderer: { title: { runs: [{ text: "No id" }] } } },
      ],
    };
    expect(parseWatchPlaylist(response)).toEqual([
      {
        id: "abc",
        title: "Tum Hi Ho",
        artist: "Arijit Singh",
        album: "Aashiqui 2",
        duration: 262,
        artworkUrl: "https://i.ytimg.com/a=w544-h544",
      },
    ]);
  });
});
