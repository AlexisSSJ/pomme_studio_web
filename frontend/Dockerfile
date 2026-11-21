FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Railway injects matching service variables as build args when declared.
# Next.js bakes rewrites() into the routes manifest at build time, so the
# proxy target must be present here, not only at runtime.
ARG API_PROXY_TARGET
ENV NEXT_TELEMETRY_DISABLED=1 \
    API_PROXY_TARGET=${API_PROXY_TARGET}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
