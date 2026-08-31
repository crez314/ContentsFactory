# 세 서비스(api·orchestrator·worker)가 같은 이미지를 쓰고 SERVICE 로 갈라진다.
# ECS Task Definition 에서 command 를 다르게 준다.
FROM node:20-bookworm-slim AS base
# 렌더 워커가 ffmpeg 을 쓴다. API·오케스트레이터에는 불필요하지만 이미지를 하나로 유지한다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# SERVICE=api|orchestrator|worker
ENV SERVICE=api
CMD ["sh", "-c", "node dist/apps/${SERVICE}/src/main.js"]
