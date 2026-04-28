# ── Stage 1: instalar dependências ──────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: build Next.js (standalone) ─────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: imagem final ────────────────────────────────────────────────────
FROM node:20-slim AS runner

# ffmpeg como fallback caso ffmpeg-static não consiga rodar (raramente necessário)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Standalone output inclui server.js + node_modules mínimos
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3004
ENV PORT=3004
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
