import type { Note, SearchResult, ToolStatus } from "../types.js";
import type { Session } from "../browser/sessionManager.js";

export type SiteId = "xhs" | "yelp" | "tripadvisor";

export interface SiteAdapter {
  id: SiteId;
  name: string;
  waitForLogin: (session: Session, timeoutSec: number) => Promise<{ status: ToolStatus; debug?: unknown }>;
  search: (session: Session, query: string, maxNotes: number, scrollTimes: number) => Promise<SearchResult>;
  openAndExtract: (session: Session, url: string) => Promise<{ status: ToolStatus; note: Note | null }>;
}
