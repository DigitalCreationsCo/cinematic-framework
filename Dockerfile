# STAGE 1: Builder
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies (cached if package.json doesn't change)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build 
# ^ This runs your new build.ts (Vite + TSC)

# STAGE 2: Runner
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

# Copy strictly what we need
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Default command (can be overridden in compose for worker/pipeline)
CMD ["node", "dist/server/index.js"]