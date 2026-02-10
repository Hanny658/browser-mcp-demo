import type { SiteAdapter } from "./types.js";
import { waitForLogin, xhsOpenAndExtract, xhsSearch } from "../browser/xhs.js";

export const xhsAdapter: SiteAdapter = {
  id: "xhs",
  name: "Xiaohongshu",
  waitForLogin: async (session, timeoutSec) => waitForLogin(session, timeoutSec),
  search: async (session, query, maxNotes, scrollTimes) => xhsSearch(session, query, maxNotes, scrollTimes),
  openAndExtract: async (session, url) => xhsOpenAndExtract(session, url)
};
