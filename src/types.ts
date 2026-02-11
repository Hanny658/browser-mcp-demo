export type ToolStatus = "READY" | "NEED_LOGIN" | "TIMEOUT" | "ERROR" | "NOT_IMPLEMENTED";

export interface CommentNode {
  id?: string | null;
  author?: string | null;
  content?: string | null;
  liked_count?: number | null;
  reply_to?: string | null;
  children?: CommentNode[] | null;
}

export interface Note {
  id: string;
  url: string;
  title?: string | null;
  desc?: string | null;
  author?: string | null;
  snippet?: string | null;
  liked_count?: number | null;
  collected_count?: number | null;
  comments_count?: number | null;
  shared_count?: number | null;
  publish_time?: string | null;
  images_list?: string[] | null;
  comments?: CommentNode[] | null;
  rating?: number | null;
  location?: string | null;
}

export interface SearchResult {
  status: ToolStatus;
  notes: Note[];
  reason?: string;
  debug?: { url?: string; title?: string };
}
