# tizen-m7d: m7d compiled into one binary (bun build --compile) + apps2samsung-cli.
# Run with host networking (see deploy/docker-compose.yml): the TV is recognised by its source IP,
# and the TV connects back to this box (YouTube proxy, setup reports).

# ---- 1. Compile m7d -------------------------------------------------------------------------
FROM oven/bun:1.4.5 AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src ./src
# Type check, then compile server + UI + fonts + userscript into binaries/m7d-linux-x64.
RUN bun run build

# ---- 2. apps2samsung-cli (official release, checksum pinned) --------------------------------
FROM debian:bookworm-slim AS a2s
ARG A2S_VERSION=3.3.1
ARG A2S_SHA256=385cffe090e76ae956160fc20bef339608e7564dd404e793b4f95616ae448375
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/cli.tar.gz \
      "https://github.com/Apps2Samsung/Apps2Samsung/releases/download/v${A2S_VERSION}/Apps2Samsung.Cli-v${A2S_VERSION}-linux-x64.tar.gz" \
 && echo "${A2S_SHA256}  /tmp/cli.tar.gz" | sha256sum -c - \
 && mkdir /out && tar xzf /tmp/cli.tar.gz -C /out && chmod 755 /out/apps2samsung-cli

# ---- 3. Runtime -----------------------------------------------------------------------------
FROM debian:bookworm-slim
# openssl: the YouTube proxy's CA and host certificates. zip: the YouTube m7d package.
# libicu: apps2samsung-cli (.NET). ca-certificates: HTTPS to YouTube, GitHub (catalog).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl zip libicu72 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 m7d && useradd --uid 1000 --gid 1000 --create-home --home-dir /home/m7d m7d \
 && mkdir -p /data /home/m7d/.config/Apps2Samsung && chown -R m7d:m7d /data /home/m7d

COPY --from=build /src/binaries/m7d-linux-x64 /app/m7d
COPY --from=a2s /out/apps2samsung-cli /app/apps2samsung-cli
RUN ln -s /app/apps2samsung-cli /usr/local/bin/apps2samsung-cli

ENV NODE_ENV=production \
    DATA_DIR=/data \
    A2S_CLI_PATH=/app/apps2samsung-cli \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8787 \
    YT_PROXY_PORT=8101 \
    HOME=/home/m7d

# /data: CA (the TV trusts it), remote pairing token, settings, app lists, setup report.
# /home/m7d/.config/Apps2Samsung: signing certificates and Apps2Samsung settings.
VOLUME ["/data", "/home/m7d/.config/Apps2Samsung"]
USER m7d
WORKDIR /data
EXPOSE 8787 8101
ENTRYPOINT ["/app/m7d"]
