FROM node:24-bookworm-slim AS base

RUN apt-get update \
    && apt-get install --no-install-recommends -y poppler-utils python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM base AS production
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]

FROM base AS test
ENV NODE_ENV=test
CMD ["npm", "test"]
