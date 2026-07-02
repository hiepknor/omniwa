# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.references.json ./
COPY apps ./apps
COPY packages ./packages
COPY sdk ./sdk
COPY tooling ./tooling
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec tsc -b tsconfig.references.json --force

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages

USER node
EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
