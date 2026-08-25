FROM eclipse-temurin:25-jre-jammy

RUN apt-get update && apt-get install -y wget tar gzip curl gnupg libstdc++6 && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# >= 0.14.6 é o mínimo: é a versão que introduziu o comando `sendStory`
# (attachment story pra "My Story" ou grupo via --group-id).
ARG SIGNAL_CLI_VERSION=0.14.6

RUN wget "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" \
    && tar xf "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" -C /opt \
    && ln -s "/opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli" /usr/local/bin/signal-cli \
    && rm "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz"

RUN mkdir -p /data/signal-cli-config

WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js .
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
