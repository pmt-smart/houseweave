# HouseWeave's server, as Home Assistant's Supervisor builds the add-on (BUILD_FROM from build.yaml), or as a container beside Home Assistant
# Container (docker build, with the default below). One process, Node's, on two ports (server/release-server.mjs): the nodes' (8080), on the
# house's network, and the app's (8099), which only Home Assistant's ingress reaches.
ARG BUILD_FROM=node:22-alpine

# The app. In the add-on repository the package holds no compiled app (app/ holds only its placeholder): this stage compiles it from
# the source of the add-on's version, at its tag, v and BUILD_VERSION, which the Supervisor passes from config.yaml, in SOURCE. From the firmware
# submodule it takes only Tasmota's Berry library, which the simulated panel runs, at the commit the tag pins, by a sparse fetch of that folder. A
# package whose app/ holds the compiled app (the package script's, as a local add-on's) is taken as it is.
FROM node:22-alpine AS app
ARG BUILD_VERSION
ARG SOURCE=https://github.com/pmt-smart/houseweave
COPY app /out
RUN set -e; \
    if [ ! -f /out/index.html ]; then \
      apk add --no-cache git; \
      git clone --quiet --depth 1 --branch "v${BUILD_VERSION}" "${SOURCE}" /src; \
      cd /src/firmware/tasmota; \
      git init --quiet; \
      git remote add origin "$(git -C /src config -f .gitmodules submodule.firmware/tasmota.url)"; \
      git sparse-checkout set lib/libesp32/berry_tasmota/src/embedded; \
      git fetch --quiet --depth 1 --filter=blob:none origin "$(git -C /src ls-tree HEAD firmware/tasmota | cut -f1 | cut -d' ' -f3)"; \
      git checkout --quiet FETCH_HEAD; \
      cd /src/libs/nspanel-sim; \
      npm ci --no-audit --no-fund; \
      npm run build --workspace=@nspanel-sim/sim; \
      cp -r sim/dist/. /out/; \
    fi

FROM ${BUILD_FROM}
COPY server /app/server
# the integration it copies into Home Assistant's configuration at its start, beside the server as in the repository
COPY custom_components /app/custom_components
COPY --from=app /out /app/app
EXPOSE 8080
# the releases, in /share/houseweave, made on the first start, and its identity, its house and the nodes' backups in /data, the add-on's
# own, which it does not serve. The app's port listens on every address of the container, and answers the ingress alone,
# unless the container is given another APP_FROM (empty: any that reaches it, as a container beside Home Assistant Container maps it to 127.0.0.1)
CMD ["sh", "-c", "mkdir -p /share/houseweave && DATA_DIR=/data APP_HOST=${APP_HOST:-0.0.0.0} APP_FROM=${APP_FROM-172.30.32.2} exec node /app/server/release-server.mjs /share/houseweave 8080 8099"]
