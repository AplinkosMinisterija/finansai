FROM node:20-alpine AS base
RUN apk add --no-cache git

FROM base AS builder
WORKDIR /repo
COPY package.json yarn.lock ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN yarn install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN yarn workspace @biip-finansai/shared build
RUN yarn workspace @biip-finansai/api build

FROM base
WORKDIR /app
COPY package.json yarn.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /repo/packages/shared/dist packages/shared/dist
COPY --from=builder /repo/apps/api/dist apps/api/dist

ARG VERSION
ARG ENVIRONMENT
ENV VERSION=${VERSION}
ENV ENVIRONMENT=${ENVIRONMENT}
ENV NODE_ENV=production
ENV TZ=Etc/GMT
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/apps/api

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/finansai/ping || exit 1

CMD ["node", "dist/runner.js"]
