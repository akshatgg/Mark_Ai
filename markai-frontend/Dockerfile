# ------------------ Build Stage ------------------
    FROM node:20-alpine AS builder

    WORKDIR /app

    # Install deps using better caching
    COPY package*.json ./
    RUN npm install --production=false

    # Build-time env vars for NEXT_PUBLIC_* (baked into the JS bundle)
    ARG NEXT_PUBLIC_BACKEND_URL=https://api.mark-ai.tech/api
    ARG NEXT_PUBLIC_XIBO_URL=https://saas.screenox.in
    ARG NEXT_PUBLIC_RAZORPAY_TEST_API_KEY=rzp_test_RlYlvZe48Ip4od
    ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=388332365810-i1j7ihkm46e67rqirhcrgojsalfi60tr.apps.googleusercontent.com
    ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
    ENV NEXT_PUBLIC_XIBO_URL=$NEXT_PUBLIC_XIBO_URL
    ENV NEXT_PUBLIC_RAZORPAY_TEST_API_KEY=$NEXT_PUBLIC_RAZORPAY_TEST_API_KEY
    ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID

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