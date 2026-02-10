import type { SiteAdapter, SiteId } from "./types.js";
import { xhsAdapter } from "./xhs.js";
import { yelpAdapter } from "./yelp.js";
import { tripAdvisorAdapter } from "./tripadvisor.js";

const adapters: Record<SiteId, SiteAdapter> = {
  xhs: xhsAdapter,
  yelp: yelpAdapter,
  tripadvisor: tripAdvisorAdapter
};

export const normalizeSite = (site?: string): SiteId => {
  if (!site) return "xhs";
  const lower = site.toLowerCase();
  if (lower === "yelp") return "yelp";
  if (lower === "tripadvisor" || lower === "trip_advisor" || lower === "trip-advisor") return "tripadvisor";
  return "xhs";
};

export const getAdapter = (site?: string): SiteAdapter => {
  const id = normalizeSite(site);
  return adapters[id] ?? adapters.xhs;
};
