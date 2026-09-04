FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/ai-server/package.json apps/ai-server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile --filter @ucdavis/caes-ai-server... --filter @ucdavis/caes-ai-protocol...
COPY apps/ai-server apps/ai-server
COPY packages/protocol packages/protocol
COPY contracts contracts
RUN pnpm --filter @ucdavis/caes-ai-protocol build && pnpm --filter @ucdavis/caes-ai-server build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/ai-server ./apps/ai-server
COPY --from=build /app/packages/protocol ./packages/protocol
EXPOSE 4310
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:4310/ready >/dev/null || exit 1
CMD ["node", "apps/ai-server/dist/server.js"]
