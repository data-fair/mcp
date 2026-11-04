# =============================
# Base Node image
# =============================
FROM node:24.22.2-alpine3.24@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS base

# pick up alpine security fixes released after this base image was published
RUN apk upgrade --no-cache

WORKDIR /app
ENV NODE_ENV=production

# =============================
# Package preparation (stripping version for caching)
# =============================
FROM base AS package-strip

RUN apk add --no-cache jq moreutils
ADD package.json package-lock.json ./
# remove version from manifest for better caching when building a release
RUN jq '.version="build"' package.json | sponge package.json
RUN jq '.version="build"' package-lock.json | sponge package-lock.json

# =============================
# Full dependencies installation (for types and building)
# =============================
FROM base AS installer

RUN npm i -g clean-modules@3.0.4
COPY --from=package-strip /app/package.json package.json
COPY --from=package-strip /app/package-lock.json package-lock.json
# full deps install used for types and ui building
RUN npm ci --omit=optional --no-audit --no-fund

# =============================
# Build Types
# =============================
FROM installer AS types

ADD config config
RUN npm run build-types

# =============================
# Install production dependencies
# =============================
FROM installer AS server-installer

# remove other workspaces and reinstall, otherwise we can get rig have some peer dependencies from other workspaces
RUN npm ci --prefer-offline --omit=dev --omit=optional --no-audit --no-fund && \
    npx clean-modules --yes "!yaml/dist/doc/"

# =============================
# Final Image
# =============================
FROM base AS main

# npm and corepack are only needed by the build stages, never to run the service
# (the registry's skill packages are extracted without "npm rebuild": no build option)
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg

ADD /src src
ADD /index.ts index.ts
COPY --from=types /app/config config
COPY --from=server-installer /app/node_modules node_modules
ADD package.json README.md LICENSE BUILD.json* ./

EXPOSE 8080
EXPOSE 9090

USER node
WORKDIR /app

ENTRYPOINT ["node", "--max-http-header-size", "64000", "index.ts"]
