FROM node:22-alpine AS build
WORKDIR /app
RUN npm install --global npm@11.19.1
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/ai-server/package.json apps/ai-server/package.json
COPY apps/todo-app/web/package.json apps/todo-app/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/assistant-react/package.json packages/assistant-react/package.json
COPY tests/e2e/package.json tests/e2e/package.json
RUN npm ci --workspace @ucdavis/caes-ai-server --workspace @ucdavis/caes-ai-protocol --include-workspace-root
COPY apps/ai-server apps/ai-server
COPY packages/protocol packages/protocol
COPY contracts contracts
RUN npm run build --workspace @ucdavis/caes-ai-protocol --workspace @ucdavis/caes-ai-server

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/ai-server ./apps/ai-server
COPY --from=build /app/packages/protocol ./packages/protocol
EXPOSE 4310
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:4310/ready >/dev/null || exit 1
CMD ["node", "apps/ai-server/dist/server.js"]
