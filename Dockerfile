##########################
FROM node:22.14.0-alpine3.21 AS base

RUN npm install -g npm@11.1.0

WORKDIR /app
ENV NODE_ENV=production

##########################
FROM base AS package-strip

RUN apk add --no-cache jq moreutils
ADD package.json package-lock.json ./
# remove version from manifest for better caching when building a release
RUN jq '.version="build"' package.json | sponge package.json
RUN jq '.version="build"' package-lock.json | sponge package-lock.json

##########################
FROM base AS installer

RUN npm i -g clean-modules@3.0.4
COPY --from=package-strip /app/package.json package.json
COPY --from=package-strip /app/package-lock.json package-lock.json
# full deps install used for types and ui building
RUN npm ci --omit=optional --omit=peer --no-audit --no-fund

##########################
FROM installer AS types

ADD config config
RUN npm run build-types

##########################
FROM installer AS production-installer

RUN npm ci --prefer-offline --omit=dev --omit=optional --omit=peer --no-audit --no-fund && \
    npx clean-modules --yes "!ramda/src/test.js"
RUN mkdir -p /app/api/node_modules

##########################
FROM base AS main

COPY --from=production-installer /app/node_modules node_modules
ADD /src src
ADD /index.ts index.ts
COPY --from=types /app/config config
COPY --from=production-installer /app/node_modules node_modules
ADD package.json README.md LICENSE BUILD.json* ./

EXPOSE 8080
EXPOSE 9090

USER node
WORKDIR /app

ENTRYPOINT ["node", "--max-http-header-size", "65536", "--experimental-strip-types", "index.ts"]
