import type { Page, Response } from "playwright";
import { config } from "../config.js";
import type { Note, ToolStatus } from "../types.js";
import type { Session } from "./sessionManager.js";

const MAX_NOTES_LIMIT = 50;
const MAX_SCROLL_LIMIT = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const getActivePage = (session: Session): Page => {
  const pages = session.context.pages().filter((p) => !p.isClosed());
  if (pages.length === 0) return session.page;
  const latest = pages[pages.length - 1] ?? session.page;
  session.page = latest;
  return latest;
};

const XHS_HOST_SUFFIX = "xiaohongshu.com";
const MAX_DETAIL_DESC_LENGTH = 8000;

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const trimTo = (value: string, maxLen: number): string =>
  value.length > maxLen ? value.slice(0, maxLen).trim() : value;

const normalizeXhsNoteUrl = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, config.xhsBaseUrl);
    if (!url.hostname.endsWith(XHS_HOST_SUFFIX)) return null;
    if (!(url.pathname.includes("/explore/") || url.pathname.includes("/discovery/item/"))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const extractNoteIdFromUrl = (value: string): string => {
  try {
    const url = new URL(value, config.xhsBaseUrl);
    const match = url.pathname.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/);
    return normalizeText(match?.[1] ?? "");
  } catch {
    return "";
  }
};

const parseCount = (value: unknown): number | null => {
  const text = normalizeText(value);
  if (!text) return null;
  const compact = text.replace(/[,，\s]/g, "");
  const match = compact.match(/([0-9]+(?:\.[0-9]+)?)(万|w|k)?/i);
  if (!match) return null;
  const numericPart = match[1];
  if (!numericPart) return null;
  const num = Number.parseFloat(numericPart);
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] ?? "").toLowerCase();
  let multiplier = 1;
  if (unit === "万" || unit === "w") multiplier = 10000;
  if (unit === "k") multiplier = 1000;
  return Math.round(num * multiplier);
};

const pickFirstString = (...candidates: unknown[]): string | null => {
  for (const item of candidates) {
    const value = normalizeText(item);
    if (value) return value;
  }
  return null;
};

const pickLongerString = (a: string | null, b: string | null): string | null => {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
};

const pickFirstNumber = (...candidates: Array<number | null | undefined>): number | null => {
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractImagesFromUnknown = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const results: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.startsWith("http")) results.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const url = pickFirstString(item.url, item.urlDefault, item.link, item.origin);
    if (url && url.startsWith("http")) results.push(url);
  }
  return Array.from(new Set(results)).slice(0, 12);
};

const looksLikeNoteRecord = (value: Record<string, unknown>): boolean => {
  const id = pickFirstString(value.note_id, value.noteId, value.id);
  const title = pickFirstString(value.title, value.note_title);
  const desc = pickFirstString(value.desc, value.content, value.note_content);
  return Boolean(id || title || desc);
};

const findLikelyNoteRecord = (value: unknown, depth = 0): Record<string, unknown> | null => {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      const found = findLikelyNoteRecord(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (looksLikeNoteRecord(value)) return value;
  for (const key of Object.keys(value).slice(0, 60)) {
    const found = findLikelyNoteRecord(value[key], depth + 1);
    if (found) return found;
  }
  return null;
};

const extractNoteFromApiPayload = (payload: unknown): Partial<Note> | null => {
  const record = findLikelyNoteRecord(payload);
  if (!record) return null;

  const stats = isRecord(record.interact_info)
    ? record.interact_info
    : isRecord(record.statistics)
      ? record.statistics
      : null;
  const user = isRecord(record.user) ? record.user : isRecord(record.author) ? record.author : null;

  const id = pickFirstString(record.note_id, record.noteId, record.id);
  const title = pickFirstString(record.title, record.note_title, record.display_title);
  const desc = pickFirstString(record.desc, record.content, record.note_content, record.noteDesc);
  const author = pickFirstString(
    user?.nickname,
    user?.name,
    (record as Record<string, unknown>).nickname,
    (record as Record<string, unknown>).author
  );
  const imageCandidates = [
    ...extractImagesFromUnknown(record.image_list),
    ...extractImagesFromUnknown(record.images_list),
    ...extractImagesFromUnknown(record.images)
  ];
  const images = Array.from(new Set(imageCandidates)).slice(0, 12);

  const liked = pickFirstNumber(
    parseCount(stats?.liked_count),
    parseCount(stats?.likedCount),
    parseCount(record.liked_count),
    parseCount(record.likes)
  );
  const shared = pickFirstNumber(
    parseCount(stats?.share_count),
    parseCount(stats?.shared_count),
    parseCount(record.shared_count)
  );
  const publishTime = pickFirstString(
    record.time,
    record.publish_time,
    record.last_update_time,
    record.ip_location
  );

  return {
    id: id ?? "",
    url: "",
    title: title ?? null,
    desc: desc ? trimTo(desc, MAX_DETAIL_DESC_LENGTH) : null,
    author: author ?? null,
    snippet: desc ? trimTo(desc, 160) : title ?? null,
    liked_count: liked,
    shared_count: shared,
    publish_time: publishTime ?? null,
    images_list: images.length > 0 ? images : null
  };
};

const mergeDetailedNote = ({
  url,
  fallbackId,
  searchNote,
  apiNote,
  domNote
}: {
  url: string;
  fallbackId: string;
  searchNote: Partial<Note>;
  apiNote: Partial<Note> | null;
  domNote: Partial<Note> | null;
}): Note => {
  const desc = pickLongerString(
    pickFirstString(apiNote?.desc, domNote?.desc),
    pickFirstString(searchNote.desc)
  );
  const title = pickFirstString(apiNote?.title, domNote?.title, searchNote.title);
  const id =
    (pickFirstString(apiNote?.id, domNote?.id, searchNote.id, fallbackId) ?? fallbackId) || "unknown_note";
  const author = pickFirstString(apiNote?.author, domNote?.author, searchNote.author);
  const imagesList = (apiNote?.images_list ?? domNote?.images_list ?? searchNote.images_list) ?? null;
  const snippet = pickFirstString(searchNote.snippet, desc ? trimTo(desc, 180) : "", title);
  return {
    id,
    url,
    title: title ?? null,
    desc: desc ? trimTo(desc, MAX_DETAIL_DESC_LENGTH) : null,
    author: author ?? null,
    snippet: snippet ?? null,
    liked_count: pickFirstNumber(apiNote?.liked_count, domNote?.liked_count, searchNote.liked_count),
    shared_count: pickFirstNumber(apiNote?.shared_count, domNote?.shared_count, searchNote.shared_count),
    publish_time: pickFirstString(apiNote?.publish_time, domNote?.publish_time, searchNote.publish_time),
    images_list: imagesList,
    comments: searchNote.comments ?? null,
    rating: null,
    location: null
  };
};

type LoginSignals = {
  avatarFound: boolean;
  userLinkFound: boolean;
  creatorButtonFound: boolean;
  userMenuFound: boolean;
  loginButtonFound: boolean;
};

const detectLoginSignals = async (page: Page): Promise<LoginSignals> => {
  const script = String.raw`
(() => {
  const avatar = document.querySelector(
    'img[class*="avatar"], img[alt*="头像"], [class*="avatar"], [aria-label*="头像"]'
  );
  const loginButtonFound = Array.from(document.querySelectorAll("a,button")).some((el) => {
    const text = (el.textContent || "").trim();
    return text.includes("登录") || text.includes("注册");
  });
  const userLinkFound = Array.from(
    document.querySelectorAll('a[href^="/user/"], a[href*="/user/"]')
  ).some((el) => {
    const text = (el.textContent || "").trim();
    return text.length > 0 || !!el.querySelector("img");
  });
  const creatorButtonFound = Array.from(document.querySelectorAll("a,button")).some((el) => {
    const text = (el.textContent || "").trim();
    return text.includes("发布") || text.includes("创作") || text.includes("笔记");
  });
  const userMenuFound = Boolean(
    document.querySelector('[class*="user"], [class*="profile"], [aria-label*="个人"], [data-testid*="user"]')
  );
  return {
    avatarFound: Boolean(avatar),
    userLinkFound,
    creatorButtonFound,
    userMenuFound,
    loginButtonFound
  };
})()
`;
  return page.evaluate(script);
};

export async function detectLogin(page: Page): Promise<boolean> {
  try {
    const signals = await detectLoginSignals(page);
    return (
      !signals.loginButtonFound &&
      (signals.avatarFound || signals.userLinkFound || signals.creatorButtonFound || signals.userMenuFound)
    );
  } catch {
    return false;
  }
}

export async function waitForLogin(
  session: Session,
  timeoutSec: number
): Promise<{
  status: ToolStatus;
  debug?: { url: string; signals: LoginSignals; pages: number };
}> {
  let page = getActivePage(session);
  const ensureLanding = async () => {
    try {
      page = getActivePage(session);
      if (!page.url().includes("/explore")) {
        await page.goto(`${config.xhsBaseUrl}/explore`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(800);
      }
    } catch {
      // ignore navigation errors for login checks
    }
  };

  await ensureLanding();
  const signals =
    (await detectLoginSignals(page).catch(() => null)) ?? {
      avatarFound: false,
      userLinkFound: false,
      creatorButtonFound: false,
      userMenuFound: false,
      loginButtonFound: true
    };
  const loggedIn =
    !signals.loginButtonFound &&
    (signals.avatarFound || signals.userLinkFound || signals.creatorButtonFound || signals.userMenuFound);
  if (loggedIn) return { status: "READY", debug: { url: page.url(), signals, pages: session.context.pages().length } };
  if (timeoutSec <= 0)
    return { status: "NEED_LOGIN", debug: { url: page.url(), signals, pages: session.context.pages().length } };

  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    await ensureLanding();
    const loopSignals =
      (await detectLoginSignals(page).catch(() => null)) ?? {
        avatarFound: false,
        userLinkFound: false,
        creatorButtonFound: false,
        userMenuFound: false,
        loginButtonFound: true
      };
    const loopLoggedIn =
      !loopSignals.loginButtonFound &&
      (loopSignals.avatarFound ||
        loopSignals.userLinkFound ||
        loopSignals.creatorButtonFound ||
        loopSignals.userMenuFound);
    if (loopLoggedIn) {
      return { status: "READY", debug: { url: page.url(), signals: loopSignals, pages: session.context.pages().length } };
    }
  }
  const finalSignals =
    (await detectLoginSignals(page).catch(() => null)) ?? {
      avatarFound: false,
      userLinkFound: false,
      creatorButtonFound: false,
      userMenuFound: false,
      loginButtonFound: true
    };
  return { status: "TIMEOUT", debug: { url: page.url(), signals: finalSignals, pages: session.context.pages().length } };
}

export async function xhsSearch(
  session: Session,
  query: string,
  maxNotes: number,
  scrollTimes: number
): Promise<{ status: ToolStatus; notes: Note[] }> {
  const page = getActivePage(session);
  const loggedIn = await detectLogin(page);
  if (!loggedIn) return { status: "NEED_LOGIN", notes: [] };

  const safeQuery = query.trim();
  if (!safeQuery) throw new Error("QUERY_REQUIRED");

  const max = clamp(Math.floor(maxNotes || 20), 1, MAX_NOTES_LIMIT);
  const scrollInput =
    typeof scrollTimes === "number" && Number.isFinite(scrollTimes) ? scrollTimes : 2;
  const scrolls = clamp(Math.floor(scrollInput), 0, MAX_SCROLL_LIMIT);

  const url = `${config.xhsBaseUrl}/search_result?keyword=${encodeURIComponent(safeQuery)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const resultSelector = 'a[href*="/explore/"], a[href*="/discovery/item/"]';
  try {
    await page.waitForSelector(resultSelector, { timeout: 8000 });
  } catch {
    // ignore if no results yet
  }

  const resultLocator = page.locator(resultSelector);
  let lastCount = await resultLocator.count();

  for (let i = 0; i < scrolls; i += 1) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(600);
    const count = await resultLocator.count();
    if (count === lastCount) {
      await page.waitForTimeout(400);
    }
    lastCount = count;
  }

  const script = String.raw`
(() => {
  const maxCount = ${max};
  const normalize = (text) => text.replace(/\\s+/g, " ").trim();
  const trimTo = (text, maxLen) => {
    if (text.length > maxLen) return text.slice(0, maxLen).trim();
    return text;
  };

  const parseCount = (value) => {
    if (!value) return null;
    const cleaned = value.replace(/[,\\s]/g, "");
    const match = cleaned.match(/([0-9]+(?:\\.[0-9]+)?)(万|w|k)?/i);
    if (!match) return null;
    const num = Number.parseFloat(match[1]);
    if (!Number.isFinite(num)) return null;
    const unit = (match[2] || "").toLowerCase();
    let mult = 1;
    if (unit === "万" || unit === "w") mult = 10000;
    if (unit === "k") mult = 1000;
    return Math.round(num * mult);
  };

  const getAttr = (el, name) => normalize((el && el.getAttribute && el.getAttribute(name)) || "");
  const parseAdjacentCount = (el) => {
    if (!el) return null;
    const siblings = [el.nextElementSibling, el.previousElementSibling, el.parentElement].filter(Boolean);
    for (const node of siblings) {
      const count = parseCount(normalize((node && node.textContent) || ""));
      if (count !== null) return count;
    }
    return null;
  };

  const findLikeCount = (card, cardText) => {
    const fromText = findCount(cardText, ["赞", "点赞"]);
    if (fromText !== null) return fromText;
    if (!card) return null;
    const likeHints = ["like", "zan", "dianzan", "thumb", "praise"];
    const elements = card.querySelectorAll("span,div,em,i,button,a");
    for (const el of elements) {
      const text = normalize((el && el.textContent) || "");
      const aria = getAttr(el, "aria-label");
      const title = getAttr(el, "title");
      const dataCount = getAttr(el, "data-count") || getAttr(el, "data-num") || getAttr(el, "data-number");
      if (dataCount) {
        const parsed = parseCount(dataCount);
        if (parsed !== null) return parsed;
      }
      const candidates = [text, aria, title].filter((v) => v);
      for (const cand of candidates) {
        if (cand.includes("赞") || cand.includes("点赞")) {
          const parsed = parseCount(cand);
          if (parsed !== null) return parsed;
          const adjacent = parseAdjacentCount(el);
          if (adjacent !== null) return adjacent;
        }
      }
      const className = (el.getAttribute("class") || "").toLowerCase();
      if (likeHints.some((hint) => className.includes(hint))) {
        const merged = text + " " + aria + " " + title;
        const parsed = parseCount(merged);
        if (parsed !== null) return parsed;
        const adjacent = parseAdjacentCount(el);
        if (adjacent !== null) return adjacent;
      }
    }
    return null;
  };

  const findCount = (text, labels) => {
    const lines = text.split(/\\n|\\r|\\t|·|•/).map((line) => line.trim());
    for (const label of labels) {
      for (const line of lines) {
        if (!line.includes(label)) continue;
        const count = parseCount(line);
        if (count !== null) return count;
      }
    }
    return null;
  };

  const pickTitle = (card, link) => {
    const candidates = [];
    if (card) {
      candidates.push(...Array.from(card.querySelectorAll("h1,h2,h3,h4")));
      candidates.push(...Array.from(card.querySelectorAll("span")));
    }
    candidates.push(link);
    for (const el of candidates) {
      const text = normalize(el.textContent || "");
      if (text.length >= 2 && text.length <= 80) return trimTo(text, 80);
    }
    return "";
  };

  const pickDesc = (card) => {
    if (!card) return "";
    const paragraphs = Array.from(card.querySelectorAll("p"));
    for (const el of paragraphs) {
      const text = normalize(el.textContent || "");
      if (text.length >= 2) return trimTo(text, 140);
    }
    return "";
  };

  const pickAuthor = (card) => {
    if (!card) return "";
    const authorLink = card.querySelector('a[href*="/user/"]');
    const text = normalize((authorLink && authorLink.textContent) || "");
    if (text && text.length <= 40) return trimTo(text, 40);
    const fallback = card.querySelector('[class*="author"], [class*="user"]');
    const fallbackText = normalize((fallback && fallback.textContent) || "");
    if (fallbackText && fallbackText.length <= 40) return trimTo(fallbackText, 40);
    return "";
  };

  const anchors = Array.from(
    document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]')
  );
  const results = [];
  const seen = new Set();

  const extractId = (href) => {
    if (href.includes("/explore/")) {
      const part = href.split("/explore/")[1] || "";
      return part.split("?")[0].split("#")[0];
    }
    if (href.includes("/discovery/item/")) {
      const part = href.split("/discovery/item/")[1] || "";
      return part.split("?")[0].split("#")[0];
    }
    return "";
  };

  for (const link of anchors) {
    const href = link.getAttribute("href") || "";
    const id = extractId(href);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const url = href.startsWith("http") ? href : location.origin + href;
    const card = link.closest("section, article, div");
    const cardText = normalize((card && card.textContent) || "");

    const title = pickTitle(card, link);
    const desc = pickDesc(card);
    const author = pickAuthor(card);

    const liked = findLikeCount(card, cardText);
    const shared = findCount(cardText, ["分享"]);

    results.push({
      id,
      url,
      title: title || null,
      desc: desc || null,
      author: author || null,
      snippet: desc || title || null,
      liked_count: liked,
      shared_count: shared,
      publish_time: null,
      images_list: null,
      comments: null,
      rating: null,
      location: null
    });

    if (results.length >= maxCount) break;
  }

  return results;
})()
`;

  const notes = await page.evaluate(script) as Note[];

  return { status: "READY", notes };
}

export async function xhsOpenAndExtract(
  session: Session,
  url: string
): Promise<{ status: ToolStatus; note: Note | null }> {
  const normalizedUrl = normalizeXhsNoteUrl(url);
  if (!normalizedUrl) throw new Error("INVALID_NOTE_URL");

  const fallbackId = extractNoteIdFromUrl(normalizedUrl);
  const basePage = session.page && !session.page.isClosed() ? session.page : getActivePage(session);
  const loginOk = await detectLogin(basePage);
  if (!loginOk) return { status: "NEED_LOGIN", note: null };

  const detailPage = await session.context.newPage();

  let apiNote: Partial<Note> | null = null;
  const responseHandler = async (response: Response) => {
    try {
      const responseUrl = response.url();
      if (!responseUrl.includes("/api/sns/web/v1/")) return;
      const headers = response.headers();
      const contentType = normalizeText(headers["content-type"] ?? headers["Content-Type"]);
      if (!contentType.includes("json")) return;
      const payload = await response.json().catch(() => null);
      if (!payload) return;
      const parsed = extractNoteFromApiPayload(payload);
      if (!parsed) return;
      if (!apiNote) {
        apiNote = parsed;
        return;
      }
      const prevDescLength = normalizeText(apiNote.desc).length;
      const currentDescLength = normalizeText(parsed.desc).length;
      if (currentDescLength > prevDescLength) {
        apiNote = { ...apiNote, ...parsed };
      }
    } catch {
      // ignore parse failures from unrelated responses
    }
  };

  detailPage.on("response", responseHandler);

  try {
    await detailPage.goto(normalizedUrl, { waitUntil: "domcontentloaded" });
    await Promise.race([
      detailPage.waitForSelector("h1, article, main", { timeout: 2_800 }).catch(() => undefined),
      detailPage.waitForTimeout(800)
    ]);

    const stillLoggedIn = await detectLogin(detailPage);
    if (!stillLoggedIn) {
      return { status: "NEED_LOGIN", note: null };
    }

    const domNote = (await detailPage.evaluate(
      String.raw`
(() => {
  const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
  const trimTo = (text, maxLen) => (text.length > maxLen ? text.slice(0, maxLen).trim() : text);
  const parseCount = (value) => {
    const text = normalize(value).replace(/[,，\s]/g, "");
    if (!text) return null;
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)(万|w|k)?/i);
    if (!match) return null;
    const num = Number.parseFloat(match[1]);
    if (!Number.isFinite(num)) return null;
    const unit = (match[2] || "").toLowerCase();
    let multiplier = 1;
    if (unit === "万" || unit === "w") multiplier = 10000;
    if (unit === "k") multiplier = 1000;
    return Math.round(num * multiplier);
  };
  const findCountByLabel = (text, labels) => {
    const lines = normalize(text).split(/[\\n\\r\\t·•]/).map((line) => line.trim());
    for (const label of labels) {
      for (const line of lines) {
        if (!line.includes(label)) continue;
        const count = parseCount(line);
        if (count !== null) return count;
      }
    }
    return null;
  };
  const textBySelectors = (selectors) => {
    const chunks = [];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 30);
      for (const node of nodes) {
        const text = normalize(node.textContent || "");
        if (text) chunks.push(text);
      }
    }
    return chunks;
  };
  const pickLongest = (items, minLen = 2) => {
    let best = "";
    for (const item of items) {
      const text = normalize(item);
      if (text.length >= minLen && text.length > best.length) best = text;
    }
    return best;
  };
  const title = pickLongest(
    textBySelectors(["h1", "[class*=title]", "[data-testid*=title]", "[class*=note-title]"]),
    2
  );
  const descCandidates = textBySelectors([
    "[class*=note-content]",
    "[class*=content]",
    "[class*=desc]",
    "article",
    "main p",
    "[data-testid*=content]"
  ]).map((text) => trimTo(text, 8000));
  const desc = pickLongest(descCandidates, 6);
  const author = pickLongest(
    textBySelectors([
      'a[href*="/user/profile/"]',
      'a[href*="/user/"]',
      "[class*=author]",
      "[class*=nickname]"
    ]),
    1
  );
  const pageText = normalize(document.body?.innerText || "");
  const publishTime =
    pickLongest(textBySelectors(["time", "[class*=date]", "[class*=time]", "[class*=publish]"]), 1) || null;

  const images = Array.from(document.querySelectorAll("img"))
    .map((img) => img.getAttribute("src") || img.getAttribute("data-src") || "")
    .map((src) => src.trim())
    .filter((src) => src.startsWith("http"))
    .filter((src) => !/avatar|profile|icon|emoji/i.test(src))
    .slice(0, 12);
  const uniqueImages = Array.from(new Set(images));

  const liked = findCountByLabel(pageText, ["赞", "点赞"]);
  const shared = findCountByLabel(pageText, ["分享"]);

  return {
    id: "",
    url: "",
    title: title || null,
    desc: desc || null,
    author: author || null,
    snippet: desc ? trimTo(desc, 180) : title || null,
    liked_count: liked,
    shared_count: shared,
    publish_time: publishTime,
    images_list: uniqueImages.length > 0 ? uniqueImages : null
  };
})()
`,
      )
    ) as Partial<Note>;

    const note = mergeDetailedNote({
      url: normalizedUrl,
      fallbackId,
      searchNote: { id: fallbackId, url: normalizedUrl },
      apiNote,
      domNote
    });

    return { status: "READY", note };
  } catch (err) {
    console.error("[xhs] open_and_extract failed", err);
    return { status: "ERROR", note: null };
  } finally {
    detailPage.off("response", responseHandler);
    if (!detailPage.isClosed()) {
      await detailPage.close().catch(() => undefined);
    }
    // Keep session.page unchanged to avoid races when multiple detail extractions run concurrently.
  }
}
