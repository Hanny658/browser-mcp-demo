import type { Page } from "playwright";
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
  const scrolls = clamp(Math.floor(scrollTimes || 2), 0, MAX_SCROLL_LIMIT);

  const url = `${config.xhsBaseUrl}/search_result?keyword=${encodeURIComponent(safeQuery)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
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
    await page.waitForTimeout(1000);
    const count = await resultLocator.count();
    if (count === lastCount) {
      await page.waitForTimeout(800);
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
    const collected = findCount(cardText, ["收藏"]);
    const comments = findCount(cardText, ["评论"]);
    const shared = findCount(cardText, ["分享"]);

    results.push({
      id,
      url,
      title: title || null,
      desc: desc || null,
      author: author || null,
      snippet: desc || title || null,
      liked_count: liked,
      collected_count: collected,
      comments_count: comments,
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
  _session: Session,
  _url: string
): Promise<{ status: ToolStatus; note: Note | null }> {
  void _session;
  void _url;
  return { status: "NOT_IMPLEMENTED", note: null };
}
