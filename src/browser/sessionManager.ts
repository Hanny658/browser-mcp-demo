import { chromium, type BrowserContext, type Page } from "playwright";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { config } from "../config.js";

export interface Session {
  id: string;
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  createdAt: number;
  lastActiveAt: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private janitor?: NodeJS.Timeout | undefined;

  startJanitor(): void {
    if (this.janitor) return;
    const interval = Math.min(config.sessionTtlMs / 2, 30_000);
    this.janitor = setInterval(() => {
      void this.cleanup();
    }, interval);
    this.janitor.unref?.();
  }

  async createSession(): Promise<Session> {
    if (this.sessions.size >= config.maxSessions) {
      throw new Error("MAX_SESSIONS_REACHED");
    }

    const id = randomUUID();
    const userDataDir = path.join(config.profilesDir, id);
    await fs.mkdir(userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      viewport: { width: 1280, height: 720 },
      locale: "zh-CN"
    });
    context.setDefaultTimeout(15_000);

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(config.xhsBaseUrl, { waitUntil: "domcontentloaded" });

    const now = Date.now();
    const session: Session = {
      id,
      context,
      page,
      userDataDir,
      createdAt: now,
      lastActiveAt: now
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  requireSession(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    return session;
  }

  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.lastActiveAt = Date.now();
  }

  async destroySession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    try {
      await session.context.close();
    } catch (err) {
      console.error("[session] close failed", err);
    }
    if (config.deleteProfile) {
      try {
        await fs.rm(session.userDataDir, { recursive: true, force: true });
      } catch (err) {
        console.error("[session] remove profile failed", err);
      }
    }
    return true;
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (now - session.lastActiveAt > config.sessionTtlMs) {
        await this.destroySession(session.id);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.janitor) {
      clearInterval(this.janitor);
      this.janitor = undefined;
    }
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.destroySession(id);
    }
  }
}

export const sessionManager = new SessionManager();
