# ------------------ Build Stage ------------------
    FROM node:20-alpine AS builder

    WORKDIR /app

    # Install deps using better caching
    COPY package*.json ./
    RUN npm install --production=false

    # Copy source code
    COPY . .

    # Build Next.js in standalone mode
    RUN npm run build

    # ------------------ Production Stage ------------------
    FROM node:20-alpine AS runner

    WORKDIR /app

    ENV NODE_ENV=production
    ENV PORT=8080

    # Copy standalone build
    COPY --from=builder /app/.next/standalone ./
    COPY --from=builder /app/.next/static ./.next/static
    COPY --from=builder /app/public ./public

    EXPOSE 8080

    # Run server.js from standalone build
    CMD ["node", "server.js"]