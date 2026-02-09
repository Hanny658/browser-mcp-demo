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
  await page.waitForTimeout(1200);

  for (let i = 0; i < scrolls; i += 1) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1000);
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
    const match = value.match(/[0-9.]+/);
    if (!match) return null;
    const num = Number.parseFloat(match[0]);
    if (!Number.isFinite(num)) return null;
    const hasWan = value.includes("万");
    return Math.round(hasWan ? num * 10000 : num);
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

    const liked = findCount(cardText, ["赞", "点赞"]);
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
      comments: null
    });

    if (results.length >= maxCount) break;
  }

  return results;
})()
`;

  const notes = await page.evaluate(script);

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
