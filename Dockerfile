# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Cài dumb-init để handle process signals đúng (tránh zombie processes)
RUN apk add --no-cache dumb-init

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production --ignore-scripts
# Tách riêng devDeps để build
RUN npm ci
RUN npx prisma generate
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production

# Copy production node_modules + generated prisma client
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Copy entrypoint script
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

# dumb-init làm PID 1 → forward signals đúng cách
ENTRYPOINT ["dumb-init", "--"]
CMD ["/entrypoint.sh"]
