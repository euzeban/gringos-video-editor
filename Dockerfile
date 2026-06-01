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

# Vars necessárias para Next.js inicializar módulos durante o build
ARG SUPABASE_URL
ARG SUPABASE_SERVICE_ROLE_KEY
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG OPENAI_API_KEY
ARG NODE_ENV=production
ARG PORT=3004
ARG HOSTNAME=0.0.0.0
ENV SUPABASE_URL=$SUPABASE_URL
ENV SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV NODE_ENV=$NODE_ENV
ENV PORT=$PORT
ENV HOSTNAME=$HOSTNAME

RUN npm run build

# ── Stage 3: imagem final ────────────────────────────────────────────────────
FROM node:20-slim AS runner

# ffmpeg como fallback caso ffmpeg-static não consiga rodar (raramente necessário)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Usa o ffmpeg do sistema (instalado acima) — o ffmpeg-static não sobrevive ao
# build standalone do Next (binário não rastreado). Resolve o erro ENOENT no /process.
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Standalone output inclui server.js + node_modules mínimos
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Necessário para o render do Remotion (bundle do entryPoint src/index.ts em runtime)
COPY --from=builder /app/src ./src
COPY --from=builder /app/remotion.config.ts ./remotion.config.ts
COPY --from=builder /app/package.json ./package.json
# Remotion (bundler/renderer/webpack/esbuild) NÃO é rastreado pelo build standalone
# do Next → a rota /render crashava na importação (500 puro). Sobrepõe o node_modules
# completo (superset do mínimo do standalone) para o Remotion carregar em runtime.
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3004
ENV PORT=3004
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
