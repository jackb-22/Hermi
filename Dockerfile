# One image for both App Platform components (api, worker); the run command picks the entry point.
# trixie ships ffmpeg 7.1, which decodes HEIC (iPhone photos); bookworm's 5.1 cannot.
FROM node:22-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@12.5.1
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @itp/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "@itp/api", "start"]
