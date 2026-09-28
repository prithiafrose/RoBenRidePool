# syntax=docker/dockerfile:1
# ---------- base ----------
FROM node:22-alpine

WORKDIR /usr/src/app

# ---------- dependencies ----------
# Copied separately so Docker can cache the install layer. The Prisma CLI is a
# devDependency and is required by the `prisma generate` step below.
COPY package*.json ./
RUN npm ci

# ---------- source ----------
COPY prisma ./prisma
COPY src ./src

# A throwaway URL is enough here: the Prisma client only opens a real
# connection at runtime, when DATABASE_URL comes from the environment.
RUN DATABASE_URL="postgresql://user:password@localhost:5432/placeholder" npx prisma generate

# ---------- runtime ----------
ENV NODE_ENV=production
ENV PORT=5000

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
