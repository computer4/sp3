# STAR PRODUCTION — production image (website + dashboard + admin + API in one service).
# Works on Render, Railway, Fly.io, DigitalOcean App Platform, or any VPS with Docker.
FROM node:22-bookworm-slim

# Prisma's database engine needs OpenSSL.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install packages first (cached until package files change).
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --no-fund --no-audit

COPY . .
RUN npm run build   # generates the Prisma client

# The SQLite database lives in /data — mount a persistent disk/volume there, or the data is lost on every deploy.
ENV NODE_ENV=production \
    PORT=4000 \
    TRUST_PROXY=1 \
    DATABASE_URL=file:/data/star.db
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Applies database migrations, makes sure the plans and the admin account exist, then starts the server.
CMD ["npm", "run", "start:prod"]
