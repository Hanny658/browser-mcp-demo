import type { SiteAdapter } from "./types.js";

export const tripAdvisorAdapter: SiteAdapter = {
  id: "tripadvisor",
  name: "TripAdvisor",
  waitForLogin: async () => ({ status: "READY" }),
  search: async (_session, query, maxNotes) => {
    const notes = Array.from({ length: Math.min(maxNotes, 3) }).map((_, idx) => ({
      id: `tripadvisor-demo-${idx + 1}`,
      url: `https://www.tripadvisor.com/Search?q=${encodeURIComponent(query)}`,
      title: `TripAdvisor demo result ${idx + 1}`,
      desc: "Stub data. Replace with real TripAdvisor scraping logic.",
      author: null,
      snippet: "Stub data for TripAdvisor adapter.",
      liked_count: null,
      collected_count: null,
      comments_count: null,
      shared_count: null,
      publish_time: null,
      images_list: null,
      comments: null,
      rating: 4.0,
      location: "Singapore"
    }));
    return { status: "READY", notes };
  },
  openAndExtract: async () => ({
    status: "READY",
    note: {
      id: "tripadvisor-demo-detail",
      url: "https://www.tripadvisor.com/",
      title: "TripAdvisor demo detail",
      desc: "Stub detail data.",
      author: null,
      snippet: null,
      liked_count: null,
      collected_count: null,
      comments_count: null,
      shared_count: null,
      publish_time: null,
      images_list: null,
      comments: null,
      rating: 4.0,
      location: "Singapore"
    }
  })
};
