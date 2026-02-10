# Remote Browser + MCP Tool Gateway (Multi-Site MVP)

This project provides a minimal HITL (human-in-the-loop) remote browser session and an MCP tool gateway for restricted search/extraction. It currently supports XHS and includes stub adapters for Yelp and TripAdvisor.

## Requirements
- Node.js >= 18
- Playwright Chromium (`npx playwright install chromium`)

## Install
```bash
npm install
npx playwright install chromium
```

Copy the environment template and adjust as needed:
```bash
cp .env.example .env
```

## Run
```bash
npm run dev
```

This starts:
- HTTP server on `http://HOST:PORT`
- MCP server on stdio (connect with an MCP client)

## HITL Login Flow
1. Call MCP tool `create_session` -> `{ sessionId, viewUrl }`
2. Open `viewUrl` in your browser. A local Chromium window is opened for login.
3. Login on that window (QR/OTP/2FA handled by the user).
4. Call `wait_for_login` until status is `READY` (site-aware when `site` is provided).

## MCP Tools (stdio)
Tools:
 - `create_session`
 - `wait_for_login` (optional `site`)
 - `xhs_search` (site-aware via `site` param)
 - `xhs_open_and_extract` (site-aware via `site` param)
 - `destroy_session`

Example (pseudo):
```ts
const session = await client.callTool("create_session", {});
await client.callTool("wait_for_login", { sessionId: session.sessionId, timeoutSec: 120 });
const results = await client.callTool("xhs_search", {
  sessionId: session.sessionId,
  query: "camping",
  maxNotes: 10,
  scrollTimes: 2,
  site: "xhs" // xhs | yelp | tripadvisor
});
```

## Security Boundary
- Tools return sanitized structured JSON only.
- No cookies, localStorage, sessionStorage, storageState, or userDataDir exposure.
- No screenshot tool.
- Audit log is written to `logs/audit.log` with redaction.

## Agent HTTP Endpoints
 - `POST /agent/run` → start a run and execute until login required or done
 - `POST /agent/continue` → continue a run after user login
 - `GET /agent/run/:id` → fetch current run state

Example request body:
```json
{
  "query": "camping",
  "maxNotes": 10,
  "scrollTimes": 2,
  "site": "xhs"
}
```

## Configuration
Key environment variables:
- `HOST`, `PORT`, `PUBLIC_BASE_URL`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `AGENT_RUN_TTL_MINUTES`
- `MAX_SESSIONS`, `SESSION_TTL_MINUTES`
- `PROFILES_DIR`, `DELETE_PROFILE`
- `HEADLESS`
- `XHS_BASE_URL`
- `AUDIT_LOG_PATH`

## Notes
 - The XHS adapter is real; Yelp and TripAdvisor adapters are currently stub data.
 - The DOM selectors for XHS may change. Update `src/browser/xhs.ts` if search extraction breaks.
 - This MVP does not implement large-scale crawling or anti-bot bypass.
