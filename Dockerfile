FROM eclipse-temurin:21-jre-jammy

RUN apt-get update && apt-get install -y wget tar gzip curl && rm -rf /var/lib/apt/lists/*

ARG SIGNAL_CLI_VERSION=0.13.12

RUN wget "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" \
    && tar xf "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" -C /opt \
    && ln -s "/opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli" /usr/local/bin/signal-cli \
    && rm "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz"

RUN mkdir -p /data/signal-cli-config

COPY entrypoint.sh /entrypoint.sh
COPY backup-state.sh /backup-state.sh
RUN chmod +x /entrypoint.sh /backup-state.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
