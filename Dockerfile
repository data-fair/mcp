# =============================
# Base Node image
# =============================
FROM node:24-alpine3.21 AS base

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
RUN npm ci --omit=dev --omit=optional --omit=peer --no-audit --no-fund

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
RUN npm ci --prefer-offline --omit=dev --omit=optional --omit=peer --no-audit --no-fund && \
    npx clean-modules --yes

# =============================
# Final Image
# =============================
FROM base AS main

COPY --from=server-installer /app/node_modules node_modules
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
