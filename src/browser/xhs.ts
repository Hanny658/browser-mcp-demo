import type { Page } from "playwright";
import { config } from "../config.js";
import type { Note, ToolStatus } from "../types.js";
import type { Session } from "./sessionManager.js";

const MAX_NOTES_LIMIT = 50;
const MAX_SCROLL_LIMIT = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export async function detectLogin(page: Page): Promise<boolean> {
  try {
    const script = String.raw`(() => {
      const avatar = document.querySelector(
        'img[class*="avatar"], img[alt*="头像"], [class*="avatar"]'
      );
      const loginButton = Array.from(document.querySelectorAll("a,button")).some((el) => {
        const text = (el.textContent || "").trim();
        return text.includes("登录") || text.includes("注册");
      });
      return Boolean(avatar) && !loginButton;
    })`;
    return await page.evaluate(script);
  } catch {
    return false;
  }
}

export async function waitForLogin(session: Session, timeoutSec: number): Promise<ToolStatus> {
  const page = session.page;
  const loggedIn = await detectLogin(page);
  if (loggedIn) return "READY";
  if (timeoutSec <= 0) return "NEED_LOGIN";

  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    if (await detectLogin(page)) return "READY";
  }
  return "TIMEOUT";
}

export async function xhsSearch(
  session: Session,
  query: string,
  maxNotes: number,
  scrollTimes: number
): Promise<{ status: ToolStatus; notes: Note[] }> {
  const page = session.page;
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

  const script = String.raw`(maxCount) => {
    const normalize = (text) => text.replace(/\\s+/g, " ").trim();
    const trimTo = (text, maxLen) => (text.length > maxLen ? text.slice(0, maxLen).trim() : text);

    const parseCount = (value) => {
      const match = value.match(/([0-9]+(?:\\.[0-9]+)?)(万)?/);
      if (!match) return null;
      const num = Number.parseFloat(match[1] || "");
      if (!Number.isFinite(num)) return null;
      return Math.round(match[2] ? num * 10000 : num);
    };

    const findCount = (text, labels) => {
      const lines = text.split(/\\n|\\r|\\t|·|•/).map((line) => line.trim());
      for (const label of labels) {
        for (const line of lines) {
          if (!line.includes(label)) continue;
          let match = line.match(new RegExp(label + "\\\\s*([0-9]+(?:\\\\.[0-9]+)?)(万)?"));
          if (!match) {
            match = line.match(new RegExp("([0-9]+(?:\\\\.[0-9]+)?)(万)?\\\\s*" + label));
          }
          if (match) {
            const count = parseCount(match[0]);
            if (count !== null) return count;
          }
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

    for (const link of anchors) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\\/(?:explore|discovery\\/item)\\/([0-9a-zA-Z]+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const url = href.startsWith("http") ? href : `${location.origin}${href}`;
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
  }`;

  const notes = await page.evaluate(script, max);

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
