FROM node:20-alpine AS build
RUN apk add --no-cache git
WORKDIR /repo

COPY package.json yarn.lock ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY docs/package.json docs/
RUN yarn install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web
COPY docs docs

ARG ENVIRONMENT
ARG VERSION
ENV VITE_ENVIRONMENT=${ENVIRONMENT}
ENV VITE_VERSION=${VERSION}

RUN echo "$VERSION" > apps/web/public/version.txt
RUN yarn workspace @biip-finansai/web build
RUN yarn workspace @biip-finansai/docs build

FROM caddy:2-alpine
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

COPY apps/web/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv-web
COPY --from=build /repo/docs/.vitepress/dist /srv-docs
