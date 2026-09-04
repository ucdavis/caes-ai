FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/todo-app/web/package.json apps/todo-app/web/package.json
COPY packages/assistant-react/package.json packages/assistant-react/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile --filter @ucdavis/caes-ai-todo-web... --filter @ucdavis/caes-ai-assistant-react... --filter @ucdavis/caes-ai-protocol...
COPY apps/todo-app/web apps/todo-app/web
COPY packages/assistant-react packages/assistant-react
COPY packages/protocol packages/protocol
COPY contracts contracts
RUN pnpm --filter @ucdavis/caes-ai-protocol build \
    && pnpm --filter @ucdavis/caes-ai-assistant-react build \
    && pnpm --filter @ucdavis/caes-ai-todo-web build

FROM nginx:1.29-alpine AS runtime
COPY apps/todo-app/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/todo-app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1
