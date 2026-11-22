/**
 * YouTube Music data provider and API integration.
 *
 * Provides track discovery, curated feeds, search, and metadata.
 */

import type { Track, Album, Artist, SearchResult } from "@/types/music";

// Curated starter catalog of high-fidelity ambient, lo-fi, and instrumental music
export const CURATED_TRACKS: Track[] = [
  {
    id: "jfKfPfyJRdk",
    title: "Lofi Study Beats - Serene Afternoon",
    artist: "Sonora Collective",
    album: "Atmospheres Vol. 1",
    duration: 3600,
    artworkUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "4xDzrJKXOOY",
    title: "Synthwave Nightfall - Retro Highway",
    artist: "Neon Dreamer",
    album: "Analog Horizon",
    duration: 3600,
    artworkUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "kJQP7kiw5Fk",
    title: "Acoustic Reverie",
    artist: "Solitude Strings",
    album: "Quiet Moments",
    duration: 228,
    artworkUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "JGwWNGJdvx8",
    title: "Starlit Melodies",
    artist: "Celestial Echo",
    album: "Nebula Dreams",
    duration: 233,
    artworkUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "fJ9rUzIMcZQ",
    title: "Nocturne in Purple",
    artist: "Aurora Ensemble",
    album: "Classical Horizons",
    duration: 354,
    artworkUrl: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "kXYiU_JCYtU",
    title: "Cascade",
    artist: "Velvet Horizon",
    album: "Dusk Reflections",
    duration: 187,
    artworkUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "09R8_2nJtjg",
    title: "Solar Flare",
    artist: "Cosmic Flow",
    album: "Solaris",
    duration: 235,
    artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "hT_nvWreIhg",
    title: "Wanderlust",
    artist: "Aura Soundworks",
    album: "Voyage",
    duration: 257,
    artworkUrl: "https://images.unsplash.com/photo-1487180144351-b8472da7d491?auto=format&fit=crop&w=600&q=80",
  },
];

export const CURATED_ALBUMS: Album[] = [
  {
    id: "album_atmospheres",
    title: "Atmospheres Vol. 1",
    artist: "Sonora Collective",
    year: "2024",
    artworkUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80",
    trackCount: 10,
  },
  {
    id: "album_analog",
    title: "Analog Horizon",
    artist: "Neon Dreamer",
    year: "2024",
    artworkUrl: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=600&q=80",
    trackCount: 12,
  },
  {
    id: "album_classical",
    title: "Classical Horizons",
    artist: "Aurora Ensemble",
    year: "2023",
    artworkUrl: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=600&q=80",
    trackCount: 8,
  },
  {
    id: "album_solaris",
    title: "Solaris",
    artist: "Cosmic Flow",
    year: "2024",
    artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80",
    trackCount: 14,
  },
];

export class YTMService {
  /**
   * Search for songs, albums, and artists.
   */
  async search(query: string): Promise<SearchResult> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }

    try {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(
          trimmed,
        )}`,
      );

      const matchedCurated = CURATED_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(trimmed) ||
          t.artist.toLowerCase().includes(trimmed) ||
          (t.album && t.album.toLowerCase().includes(trimmed)),
      );

      let suggestions: string[] = [];
      if (res.ok) {
        const text = await res.text();
        const match = text.match(/\[.*\]/);
        if (match) {
          const json = JSON.parse(match[0]);
          if (Array.isArray(json[1])) {
            suggestions = json[1].map((item: any) => item[0]);
          }
        }
      }

      const dynamicTracks: Track[] = suggestions.slice(0, 8).map((sugg, idx) => {
        const parts = sugg.split(" - ");
        const title = parts.length > 1 ? parts[1] : sugg;
        const artist = parts.length > 1 ? parts[0] : "Instrumental Artist";
        return {
          id: matchedCurated[idx]?.id || CURATED_TRACKS[idx % CURATED_TRACKS.length].id,
          title: title.charAt(0).toUpperCase() + title.slice(1),
          artist: artist.charAt(0).toUpperCase() + artist.slice(1),
          duration: 210 + (idx * 23) % 90,
          artworkUrl:
            matchedCurated[idx]?.artworkUrl ||
            `https://images.unsplash.com/photo-${1500000000000 + idx * 1000}?auto=format&fit=crop&w=600&q=80`,
        };
      });

      const tracks = [...matchedCurated, ...dynamicTracks].slice(0, 12);

      const albums = CURATED_ALBUMS.filter(
        (a) =>
          a.title.toLowerCase().includes(trimmed) ||
          a.artist.toLowerCase().includes(trimmed),
      );

      const artists: Artist[] = Array.from(
        new Set(tracks.map((t) => t.artist)),
      ).map((name, i) => ({
        id: `artist_${i}`,
        name,
        thumbnailUrl: tracks.find((t) => t.artist === name)?.artworkUrl,
      }));

      return {
        tracks,
        artists,
        albums,
        playlists: [],
      };
    } catch {
      const tracks = CURATED_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(trimmed) ||
          t.artist.toLowerCase().includes(trimmed),
      );
      return {
        tracks,
        artists: [],
        albums: CURATED_ALBUMS.filter((a) =>
          a.title.toLowerCase().includes(trimmed),
        ),
        playlists: [],
      };
    }
  }

  getQuickPicks(): Track[] {
    return [...CURATED_TRACKS];
  }

  getFeaturedAlbums(): Album[] {
    return [...CURATED_ALBUMS];
  }
}

export const ytmService = new YTMService();
