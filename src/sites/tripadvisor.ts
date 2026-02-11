import type { Page } from "playwright";
import type { SiteAdapter } from "./types.js";
import type { Session } from "../browser/sessionManager.js";
import type { Note } from "../types.js";

const getSessionPage = async (session: Session, baseUrl: string): Promise<Page> => {
  if (session.page && !session.page.isClosed()) return session.page;
  const page = await session.context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  session.page = page;
  return page;
};

export const tripAdvisorAdapter: SiteAdapter = {
  id: "tripadvisor",
  name: "TripAdvisor",
  waitForLogin: async () => ({ status: "READY" }),
  search: async (session, query, maxNotes, scrollTimes) => {
    const page = await getSessionPage(session, "https://www.tripadvisor.com");
    const url = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(1500);

    const pageInfo = await page.evaluate(() => ({
      title: document.title || "",
      text: (document.body?.innerText || "").slice(0, 800)
    }));
    const blockSignals = `${pageInfo.title} ${pageInfo.text}`.toLowerCase();
    if (
      blockSignals.includes("unusual") ||
      blockSignals.includes("robot") ||
      blockSignals.includes("captcha") ||
      blockSignals.includes("verify") ||
      blockSignals.includes("access denied") ||
      blockSignals.includes("consent")
    ) {
      return {
        status: "READY",
        notes: [],
        reason: "blocked_or_consent",
        debug: { url: page.url(), title: pageInfo.title }
      };
    }

    const resultSelector =
      'a[href*="/Restaurant_Review-"], a[href*="/Attraction_Review-"], a[href*="/Hotel_Review-"]';
    try {
      await page.waitForSelector(resultSelector, { timeout: 15_000 });
    } catch {
      // ignore if no results yet
    }
    try {
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length > 0,
        resultSelector,
        { timeout: 10_000 }
      );
    } catch {
      // ignore if no results yet
    }

    const locator = page.locator(resultSelector);
    let lastCount = await locator.count();
    const scrolls = Math.max(0, Math.min(6, Math.floor(scrollTimes || 0)));
    for (let i = 0; i < scrolls; i += 1) {
      await page.mouse.wheel(0, 2200);
      await page.waitForTimeout(900);
      const count = await locator.count();
      if (count === lastCount) {
        await page.waitForTimeout(600);
      }
      lastCount = count;
    }

    if ((await locator.count()) === 0) {
      return {
        status: "READY",
        notes: [],
        reason: "loading_timeout_or_no_results",
        debug: { url: page.url(), title: pageInfo.title }
      };
    }

    const script = String.raw`
(() => {
  const maxCount = ${Math.max(1, Math.min(maxNotes, 20))};
  const normalize = (text) => text.replace(/\\s+/g, " ").trim();
  const parseRating = (text) => {
    const match = text.match(/([0-9]+(?:\\.[0-9]+)?)/);
    if (!match) return null;
    const num = Number.parseFloat(match[1]);
    return Number.isFinite(num) ? num : null;
  };
  const pickTitle = (card, link) => {
    const text = normalize(link.textContent || "");
    if (text && text.length <= 140) return text;
    const heading = card ? card.querySelector("h2,h3") : null;
    return normalize((heading && heading.textContent) || "");
  };
  const pickSnippet = (card) => {
    if (!card) return "";
    const snippet = card.querySelector('[class*="snippet"], [class*="summary"]');
    return normalize((snippet && snippet.textContent) || "");
  };
  const pickRating = (card) => {
    if (!card) return null;
    const ratingEl = card.querySelector('[aria-label*="bubbles"], [aria-label*="rating"]');
    const ratingText = ratingEl ? (ratingEl.getAttribute("aria-label") || ratingEl.textContent || "") : "";
    return parseRating(ratingText);
  };
  const pickLocation = (card) => {
    if (!card) return "";
    const addr = card.querySelector('[data-test-target*="address"], [class*="address"], [class*="location"]');
    return normalize((addr && addr.textContent) || "");
  };

  const anchors = Array.from(
    document.querySelectorAll('a[href*="/Restaurant_Review-"], a[href*="/Attraction_Review-"], a[href*="/Hotel_Review-"]')
  );
  const results = [];
  const seen = new Set();
  for (const link of anchors) {
    const href = link.getAttribute("href") || "";
    if (!href) continue;
    const id = href.split("/")[1] || href;
    if (seen.has(id)) continue;
    seen.add(id);
    const card = link.closest("li, div");
    const title = pickTitle(card, link);
    if (!title) continue;
    const url = href.startsWith("http") ? href : "https://www.tripadvisor.com" + href;
    const rating = pickRating(card);
    const location = pickLocation(card);
    const snippet = pickSnippet(card);
    results.push({
      id,
      url,
      title,
      desc: snippet || null,
      author: null,
      snippet: snippet || null,
      liked_count: null,
      collected_count: null,
      comments_count: null,
      shared_count: null,
      publish_time: null,
      images_list: null,
      comments: null,
      rating,
      location: location || null
    });
    if (results.length >= maxCount) break;
  }
  return results;
})()
`;

    const notes = (await page.evaluate(script)) as Note[];
    return { status: "READY", notes };
  },
  openAndExtract: async () => ({ status: "NOT_IMPLEMENTED", note: null })
};
