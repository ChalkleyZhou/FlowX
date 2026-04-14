FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY prisma ./prisma
COPY apps ./apps
COPY docs ./docs
COPY README.md ./README.md

ARG VITE_API_BASE_URL="http://localhost:3000"
ENV VITE_API_BASE_URL="${VITE_API_BASE_URL}"

RUN pnpm prisma:generate
RUN pnpm build

FROM base AS runtime
WORKDIR /app

ENV NODE_ENV="production"
ENV PORT="3000"
ENV WEB_PORT="4173"
ENV DATABASE_URL="file:/data/dev.db"
ENV AI_EXECUTOR_PROVIDER="mock"
ENV AI_EXECUTOR_DEFAULT_PROVIDER="codex"
ENV OPENAI_API_KEY=""
ENV CURSOR_API_KEY=""
ENV FLOWX_CREDENTIAL_MASTER_KEY=""
ENV FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL="false"
ENV FLOWX_CODEX_REQUIRE_USER_CREDENTIAL="false"
ENV CODEX_HOME="/data/.codex"
ENV PATH="/root/.local/bin:${PATH}"
ENV GIT_AUTHOR_NAME=""
ENV GIT_AUTHOR_EMAIL=""
ENV GIT_COMMITTER_NAME=""
ENV GIT_COMMITTER_EMAIL=""

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @openai/codex serve@14.2.4 \
  && curl https://cursor.com/install -fsS | bash \
  && mkdir -p /data /data/.codex

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/apps ./apps
COPY docker/start.sh /start.sh

RUN chmod +x /start.sh

EXPOSE 3000 4173

CMD ["/start.sh"]
