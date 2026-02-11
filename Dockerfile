FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS builder

WORKDIR /app
COPY package.json package-lock.json ./
# Use the Playwright base image browsers; skip extra downloads.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build

WORKDIR /app/demo_frontend
COPY demo_frontend/package.json demo_frontend/package-lock.json ./
RUN npm ci
COPY demo_frontend ./
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS runtime

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV DEBIAN_FRONTEND=noninteractive \
  TZ=Etc/UTC
RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    x11-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/demo_frontend/dist ./demo_frontend/dist
COPY docker/start.sh ./docker/start.sh
RUN chmod +x ./docker/start.sh

ENV HOST=0.0.0.0 \
  PORT=3000 \
  HEADLESS=false \
  MAX_SESSIONS=1 \
  UI_DIST_DIR=/app/demo_frontend/dist \
  VIEW_MODE=novnc \
  NOVNC_URL_TEMPLATE=http://localhost:7900/vnc.html?autoconnect=1&resize=scale&path=websockify \
  DISPLAY=:99

EXPOSE 3000 7900
CMD ["./docker/start.sh"]
