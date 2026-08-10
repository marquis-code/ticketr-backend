# ── Build Stage ──
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install ALL dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

# ── Production Stage ──
FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Don't run as root
USER node

EXPOSE 3000

CMD ["node", "dist/main"]