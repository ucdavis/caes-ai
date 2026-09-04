FROM node:22-alpine AS build
WORKDIR /app
RUN npm install --global npm@11.19.1
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/ai-server/package.json apps/ai-server/package.json
COPY apps/todo-app/web/package.json apps/todo-app/web/package.json
COPY packages/assistant-react/package.json packages/assistant-react/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY tests/e2e/package.json tests/e2e/package.json
RUN npm ci --workspace @ucdavis/caes-ai-protocol --workspace @ucdavis/caes-ai-assistant-react --workspace @ucdavis/caes-ai-todo-web --include-workspace-root
COPY apps/todo-app/web apps/todo-app/web
COPY packages/assistant-react packages/assistant-react
COPY packages/protocol packages/protocol
COPY contracts contracts
RUN npm run build --workspace @ucdavis/caes-ai-protocol \
    --workspace @ucdavis/caes-ai-assistant-react --workspace @ucdavis/caes-ai-todo-web

FROM nginx:1.29-alpine AS runtime
COPY apps/todo-app/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/todo-app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1
