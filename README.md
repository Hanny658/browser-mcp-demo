# Remote Browser + MCP Tool Gateway (Multi-Site MVP)

This project provides a minimal HITL (human-in-the-loop) remote browser session and an MCP tool gateway for restricted search/extraction. It currently supports XHS and includes real search adapters for Yelp and TripAdvisor.

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

## Docker (single-user + noVNC)
This path is intended for a single user (or `MAX_SESSIONS=1`). It runs the browser inside Xvfb and streams the desktop via noVNC.

Build:
```bash
docker build -t browser-mcp-demo .
```

Run:
```bash
docker run --rm \
  -p 3000:3000 -p 7900:7900 \
  -e HOST=0.0.0.0 \
  -e HEADLESS=false \
  -e MAX_SESSIONS=1 \
  -e VIEW_MODE=novnc \
  -e PUBLIC_BASE_URL=http://YOUR_SERVER_IP:3000 \
  -e NOVNC_URL_TEMPLATE="http://YOUR_SERVER_IP:7900/vnc.html?autoconnect=1&resize=scale&path=websockify" \
  -e PROFILES_DIR=/data/profiles \
  -e AUDIT_LOG_PATH=/data/logs/audit.log \
  -e DELETE_PROFILE=false \
  -v "$PWD/profiles:/data/profiles" \
  -v "$PWD/logs:/data/logs" \
  browser-mcp-demo
```

Notes:
- `VIEW_MODE=novnc` makes `/session/view/:id` embed the live browser stream.
- Update `PUBLIC_BASE_URL` and `NOVNC_URL_TEMPLATE` with your public host or domain.

## HITL Login Flow
1. Call MCP tool `create_session` -> `{ sessionId, viewUrl }`
2. Open `viewUrl` in your browser.
   - Default mode: a local Chromium window is opened for login.
   - noVNC mode (`VIEW_MODE=novnc`): the remote browser stream is embedded in the page.
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
- `UI_DIST_DIR` (serve built UI from the same server)
- `VIEW_MODE` (`info` | `novnc`)
- `NOVNC_URL_TEMPLATE` (supports `{sessionId}` placeholder)
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `AGENT_RUN_TTL_MINUTES`
- `MAX_SESSIONS`, `SESSION_TTL_MINUTES`
- `PROFILES_DIR`, `DELETE_PROFILE`
- `HEADLESS`
- `XHS_BASE_URL`
- `AUDIT_LOG_PATH`

## Notes
 - XHS, Yelp, and TripAdvisor all support search in the current adapter layer. Detail extraction for Yelp/TripAdvisor is still stubbed.
 - The DOM selectors for each site may change. Update `src/browser/xhs.ts` or `src/sites/*.ts` if extraction breaks.
 - This MVP does not implement large-scale crawling or anti-bot bypass.
