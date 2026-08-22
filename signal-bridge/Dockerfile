FROM eclipse-temurin:21-jre-jammy

RUN apt-get update && apt-get install -y wget unzip curl && rm -rf /var/lib/apt/lists/*

ARG SIGNAL_CLI_VERSION=0.13.12

RUN wget "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" \
    && tar xf "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" -C /opt \
    && ln -s "/opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli" /usr/local/bin/signal-cli \
    && rm "signal-cli-${SIGNAL_CLI_VERSION}.tar.gz"

RUN mkdir -p /data/signal-cli-config

EXPOSE 8090

CMD ["signal-cli", "--config", "/data/signal-cli-config", "daemon", "--http", "0.0.0.0:8090"]
