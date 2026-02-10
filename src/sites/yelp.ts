import type { SiteAdapter } from "./types.js";

export const yelpAdapter: SiteAdapter = {
  id: "yelp",
  name: "Yelp",
  waitForLogin: async () => ({ status: "READY" }),
  search: async (_session, query, maxNotes) => {
    const notes = Array.from({ length: Math.min(maxNotes, 3) }).map((_, idx) => ({
      id: `yelp-demo-${idx + 1}`,
      url: `https://www.yelp.com/search?find_desc=${encodeURIComponent(query)}`,
      title: `Yelp demo result ${idx + 1}`,
      desc: "Stub data. Replace with real Yelp scraping logic.",
      author: null,
      snippet: "Stub data for Yelp adapter.",
      liked_count: null,
      collected_count: null,
      comments_count: null,
      shared_count: null,
      publish_time: null,
      images_list: null,
      comments: null,
      rating: 4.2,
      location: "San Francisco, CA"
    }));
    return { status: "READY", notes };
  },
  openAndExtract: async () => ({
    status: "READY",
    note: {
      id: "yelp-demo-detail",
      url: "https://www.yelp.com/",
      title: "Yelp demo detail",
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
      rating: 4.2,
      location: "San Francisco, CA"
    }
  })
};
