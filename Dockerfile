# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Repo ships no static assets; ensure the dir exists for the runner stage COPY
RUN mkdir -p public

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (need dummy DATABASE_URL for page data collection)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV NEXTAUTH_SECRET="build-time-secret"
ENV NEXTAUTH_URL="https://galang.fundforindonesia.org"
ENV NEXT_PUBLIC_BASE_URL="https://galang.fundforindonesia.org"
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/generated ./src/generated

# Create uploads directory
RUN mkdir -p public/uploads && chown -R nextjs:nodejs public/uploads

# chown the WHOLE public tree, not just uploads. Next scans public/ recursively
# at startup (recursiveReadDir inside setupFsCheck), so one unreadable
# subdirectory is fatal rather than degraded -- the server exits with
#   EACCES: permission denied, scandir '/app/public/images'
# and the container restart-loops. COPY --from=builder preserves the build
# context's file modes, and this repo's working tree is drwxrwx--- / -rw-rw----
# with no other-read, so any asset directory added to public/ is unreadable to
# the nextjs user (uid 1001, neither owner nor group) unless chowned here.
RUN chown -R nextjs:nodejs public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
