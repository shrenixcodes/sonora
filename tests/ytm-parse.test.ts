import { describe, it, expect } from "vitest";
import {
  artworkUrl,
  parseAccountProfile,
  parseArtistPage,
  parseDuration,
  parseContinuation,
  parseHomeChips,
  parseHomeShelves,
  parseLibraryAlbums,
  parseLibraryArtists,
  parseLibraryPlaylists,
  parseWatchPlaylist,
  parsePlaylistTracks,
  parseSearchCollections,
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

  it("parses Top Result video cards, user channels, and unfiltered rows while skipping episodes", () => {
    const channel = (text: string, browseId: string) => ({
      text,
      navigationEndpoint: browse(browseId, "MUSIC_PAGE_TYPE_USER_CHANNEL"),
    });
    const unfilteredResponse = {
      contents: {
        tabbedSearchResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicCardShelfRenderer: {
                          thumbnail: {
                            musicThumbnailRenderer: {
                              thumbnail: {
                                thumbnails: [{ url: "https://i.ytimg.com/vi/MkPSo2GJJDs/hqdefault.jpg", width: 400, height: 225 }],
                              },
                            },
                          },
                          title: {
                            runs: [
                              {
                                text: "Fitrat ke naray (Official Audio)",
                                navigationEndpoint: { watchEndpoint: { videoId: "MkPSo2GJJDs" } },
                              },
                            ],
                          },
                          subtitle: {
                            runs: [
                              { text: "Video" },
                              SEP,
                              channel("Rao Hamza Hayat", "UCd-W_kIGR-G6Yq0mlJDPEww"),
                              SEP,
                              { text: "6.6K views" },
                              SEP,
                              { text: "3:54" },
                            ],
                          },
                          onTap: { watchEndpoint: { videoId: "MkPSo2GJJDs" } },
                        },
                      },
                      {
                        itemSectionRenderer: {
                          contents: [
                            songRow("19I5500B4sA", "Fitrat Ke Naray - Rao Hamza Hayat", [
                              { text: "Video" },
                              SEP,
                              channel("XNOR", "UCYf05XPe3cfFp3tEocKLrlA"),
                              SEP,
                              { text: "597 views" },
                            ]),
                            // Unlinked video row without channel browseEndpoint should still pick uploader over "Video"
                            songRow("unlinked111", "Live Acoustic", [
                              { text: "Video" },
                              SEP,
                              { text: "Indie Uploader" },
                              SEP,
                              { text: "1.2K views" },
                              SEP,
                              { text: "2:45" },
                            ]),
                            // Podcast episode carrying a videoId should not appear as playable music
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  column({
                                    text: "Podcast Episode",
                                    navigationEndpoint: browse("MPEDep1", "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE"),
                                  }),
                                  column({ text: "Episode" }, SEP, { text: "Nov 1" }),
                                ],
                                playlistItemData: { videoId: "epVideo1" },
                              },
                            },
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

    const parsed = parseSearchSongs(unfilteredResponse);
    expect(parsed).toEqual([
      {
        id: "MkPSo2GJJDs",
        title: "Fitrat ke naray (Official Audio)",
        artist: "Rao Hamza Hayat",
        artistId: "UCd-W_kIGR-G6Yq0mlJDPEww",
        duration: 234,
        artworkUrl: "https://i.ytimg.com/vi/MkPSo2GJJDs/hqdefault.jpg",
      },
      {
        id: "19I5500B4sA",
        title: "Fitrat Ke Naray - Rao Hamza Hayat",
        artist: "XNOR",
        artistId: "UCYf05XPe3cfFp3tEocKLrlA",
        duration: 0,
        artworkUrl: "https://lh3.googleusercontent.com/19I5500B4sA=w544-h544-l90-rj",
      },
      {
        id: "unlinked111",
        title: "Live Acoustic",
        artist: "Indie Uploader",
        duration: 165,
        artworkUrl: "https://lh3.googleusercontent.com/unlinked111=w544-h544-l90-rj",
      },
    ]);
  });

  it("returns nothing for an unexpected shape instead of throwing", () => {
    expect(parseSearchSongs({})).toEqual([]);
    expect(parseSearchSongs(null)).toEqual([]);
  });
});

describe("parseSearchCollections", () => {
  it("parses albums, playlists, and artists from search results", () => {
    const response = {
      contents: {
        musicShelfRenderer: {
          contents: [
            {
              musicResponsiveListItemRenderer: {
                thumbnail: thumbs("https://lh3.googleusercontent.com/album1"),
                flexColumns: [
                  column({
                    text: "Greatest Hits",
                    navigationEndpoint: {
                      browseEndpoint: {
                        browseId: "MPREb_123",
                        browseEndpointContextSupportedConfigs: {
                          browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" },
                        },
                      },
                    },
                  }),
                  column({ text: "Album • Artist • 2021" }),
                ],
              },
            },
            {
              musicResponsiveListItemRenderer: {
                thumbnail: thumbs("https://lh3.googleusercontent.com/artist1"),
                flexColumns: [
                  column({
                    text: "Queen",
                    navigationEndpoint: {
                      browseEndpoint: {
                        browseId: "UC123",
                        browseEndpointContextSupportedConfigs: {
                          browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" },
                        },
                      },
                    },
                  }),
                  column({ text: "Artist • 10M subscribers" }),
                ],
              },
            },
            {
              musicResponsiveListItemRenderer: {
                thumbnail: thumbs("https://lh3.googleusercontent.com/pl1"),
                flexColumns: [
                  column({
                    text: "Rock Classics",
                    navigationEndpoint: {
                      browseEndpoint: {
                        browseId: "VLPL_rock",
                        browseEndpointContextSupportedConfigs: {
                          browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_PLAYLIST" },
                        },
                      },
                    },
                  }),
                  column({ text: "Playlist • YouTube Music" }),
                ],
              },
            },
          ],
        },
      },
    };

    const results = parseSearchCollections(response);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      kind: "album",
      title: "Greatest Hits",
      playlistId: "MPREb_123",
    });
    expect(results[1]).toMatchObject({
      kind: "artist",
      title: "Queen",
    });
    expect(results[2]).toMatchObject({
      kind: "playlist",
      title: "Rock Classics",
      playlistId: "PL_rock",
    });
  });

  it("handles empty or malformed collections gracefully", () => {
    expect(parseSearchCollections({})).toEqual([]);
    expect(parseSearchCollections(null)).toEqual([]);
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
      { kind: "artist", title: "Arijit Singh", subtitle: "", artworkUrl: "", artistId: "UC1" },
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
    expect(artworkUrl([{ url: "//www.gstatic.com/ytm/liked.png", width: 192 }])).toBe(
      "https://www.gstatic.com/ytm/liked.png",
    );
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

describe("parseAccountProfile", () => {
  it("reads the account name, handle and a sharper photo", () => {
    const response = {
      actions: [
        {
          openPopupAction: {
            popup: {
              multiPageMenuRenderer: {
                header: {
                  activeAccountHeaderRenderer: {
                    accountName: { runs: [{ text: "Alex Rivera" }] },
                    channelHandle: { runs: [{ text: "@alex" }] },
                    accountPhoto: { thumbnails: [{ url: "https://yt3.ggpht.com/abc=s108-c-k-c0x00ffffff-no-rj", width: 108 }] },
                  },
                },
              },
            },
          },
        },
      ],
    };
    expect(parseAccountProfile(response)).toEqual({
      name: "Alex Rivera",
      handle: "@alex",
      photoUrl: "https://yt3.ggpht.com/abc=s176-c-k-c0x00ffffff-no-rj",
    });
    expect(parseAccountProfile({})).toBeNull();
  });
});

describe("library albums and artists", () => {
  it("reads saved albums with the playlist that plays them", () => {
    const album = (title: string, playlistId?: string) => ({
      musicTwoRowItemRenderer: {
        title: { runs: [{ text: title }] },
        subtitle: { runs: [{ text: "Album" }, SEP, { text: "2016" }] },
        navigationEndpoint: browse("MPREb_" + title, "MUSIC_PAGE_TYPE_ALBUM"),
        ...(playlistId
          ? { thumbnailOverlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId } } } } } } }
          : {}),
      },
    });
    expect(parseLibraryAlbums({ items: [album("Starboy", "OLAK1"), album("NoPlay")] })).toEqual([
      { id: "OLAK1", title: "Starboy", subtitle: "Album • 2016", artworkUrl: "" },
    ]);
  });

  it("reads artist rows and skips rows that aren't artists", () => {
    const row = (title: string, pageType: string) => ({
      musicResponsiveListItemRenderer: {
        navigationEndpoint: browse("UC" + title, pageType),
        flexColumns: [column({ text: title }), column({ text: "12 songs" })],
        thumbnail: thumbs("https://lh3.googleusercontent.com/" + title),
      },
    });
    const artists = parseLibraryArtists({ items: [row("Talwiinder", "MUSIC_PAGE_TYPE_ARTIST"), row("Song", "MUSIC_PAGE_TYPE_ALBUM")] });
    expect(artists).toHaveLength(1);
    expect(artists[0]).toMatchObject({ title: "Talwiinder", subtitle: "12 songs" });
    expect(artists[0].artworkUrl).toContain("=w544-h544");
  });
});

describe("artist & album ids + parseArtistPage", () => {
  it("extracts artistId and albumId on song rows when browseIds are present", () => {
    const response = {
      contents: {
        musicShelfRenderer: {
          contents: [
            songRow("trk1", "Yellow", [
              {
                text: "Coldplay",
                navigationEndpoint: browse("UC_COLDPLAY", "MUSIC_PAGE_TYPE_ARTIST"),
              },
              SEP,
              {
                text: "Parachutes",
                navigationEndpoint: browse("MPREb_PARA", "MUSIC_PAGE_TYPE_ALBUM"),
              },
              SEP,
              { text: "4:27" },
            ]),
          ],
        },
      },
    };
    const [song] = parseSearchSongs(response);
    expect(song).toMatchObject({
      id: "trk1",
      title: "Yellow",
      artist: "Coldplay",
      artistId: "UC_COLDPLAY",
      album: "Parachutes",
      albumId: "MPREb_PARA",
      duration: 267,
    });
  });

  it("fills missing artist, album and artwork on album tracklists from the responsive header", () => {
    const response = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicResponsiveHeaderRenderer: {
                          title: { runs: [{ text: "Parachutes" }] },
                          straplineTextOne: {
                            runs: [{ text: "Coldplay", navigationEndpoint: browse("UC_COLDPLAY", "MUSIC_PAGE_TYPE_ARTIST") }],
                          },
                          thumbnail: thumbs("https://lh3.googleusercontent.com/parachutes"),
                        },
                      },
                      {
                        musicShelfRenderer: {
                          contents: [
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  column({ text: "Sparks", navigationEndpoint: { watchEndpoint: { videoId: "trk2" } } }),
                                ],
                                playlistItemData: { videoId: "trk2" },
                              },
                            },
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
    const tracks = parsePlaylistTracks(response);
    expect(tracks).toEqual([
      {
        id: "trk2",
        title: "Sparks",
        artist: "Coldplay",
        artistId: "UC_COLDPLAY",
        album: "Parachutes",
        duration: 0,
        artworkUrl: "https://lh3.googleusercontent.com/parachutes=w544-h544-l90-rj",
      },
    ]);
  });

  it("parses artist header metadata, top songs, show-all id, and release shelves", () => {
    const response = {
      header: {
        musicImmersiveHeaderRenderer: {
          title: { runs: [{ text: "Coldplay" }] },
          description: { runs: [{ text: "British rock band." }] },
          subscriptionButton: {
            subscribeButtonRenderer: { subscriberCountText: { runs: [{ text: "27M subscribers" }] } },
          },
          thumbnail: thumbs("https://lh3.googleusercontent.com/coldplay"),
        },
      },
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicShelfRenderer: {
                          bottomEndpoint: { browseEndpoint: { browseId: "VLPL_TOP" } },
                          contents: [
                            songRow("trk1", "Yellow", [
                              {
                                text: "Coldplay",
                                navigationEndpoint: browse("UC_COLDPLAY", "MUSIC_PAGE_TYPE_ARTIST"),
                              },
                              SEP,
                              { text: "4:27" },
                            ]),
                          ],
                        },
                      },
                      {
                        musicCarouselShelfRenderer: {
                          header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: "Albums" }] } } },
                          contents: [
                            {
                              musicTwoRowItemRenderer: {
                                title: { runs: [{ text: "Parachutes" }] },
                                subtitle: { runs: [{ text: "2000" }] },
                                navigationEndpoint: browse("MPREb_PARA", "MUSIC_PAGE_TYPE_ALBUM"),
                                thumbnailOverlay: {
                                  musicItemThumbnailOverlayRenderer: {
                                    content: {
                                      musicPlayButtonRenderer: {
                                        playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: "OLAK_PARA" } },
                                      },
                                    },
                                  },
                                },
                              },
                            },
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
    const page = parseArtistPage(response, "UC_COLDPLAY");
    expect(page).toMatchObject({
      id: "UC_COLDPLAY",
      name: "Coldplay",
      description: "British rock band.",
      subscribers: "27M subscribers",
      topSongsPlaylistId: "PL_TOP",
    });
    expect(page.artworkUrl).toContain("=w544-h544");
    expect(page.topSongs).toHaveLength(1);
    expect(page.topSongs[0]).toMatchObject({ id: "trk1", title: "Yellow", artistId: "UC_COLDPLAY" });
    expect(page.shelves).toHaveLength(1);
    expect(page.shelves[0].items[0]).toMatchObject({
      kind: "album",
      title: "Parachutes",
      playlistId: "OLAK_PARA",
    });
  });

  it("prefers longSubscriberCountText on channel pages whose subscriberCountText is bare digits", () => {
    const response = {
      header: {
        musicVisualHeaderRenderer: {
          title: { runs: [{ text: "Rao Hamza Hayat" }] },
          subscriptionButton: {
            subscribeButtonRenderer: {
              subscriberCountText: { runs: [{ text: "484" }] },
              longSubscriberCountText: { runs: [{ text: "484 subscribers" }] },
            },
          },
          foregroundThumbnail: thumbs("https://yt3.googleusercontent.com/rao"),
        },
      },
      contents: {},
    };
    const page = parseArtistPage(response, "UCd-W_kIGR-G6Yq0mlJDPEww");
    expect(page.name).toBe("Rao Hamza Hayat");
    expect(page.subscribers).toBe("484 subscribers");
  });
});
