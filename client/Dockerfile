# Two stages: build the client with Vite, then copy only the static output
# into a small Caddy image. Build context is the repo root.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --include-workspace-root=false
COPY shared/src shared/src
COPY client client
RUN npm run build --workspace client

FROM caddy:2-alpine
# The stock binary carries the cap_net_bind_service file capability (for ports
# below 1024). We run as an unprivileged user with all capabilities dropped on
# port 8080, where the kernel refuses to exec a binary that asks for one. A
# plain copy drops the capability.
RUN cp /usr/bin/caddy /tmp/caddy && mv /tmp/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /srv
