# GT-ATS Asterisk 20 (Ubuntu 24.04). ავტორი: Giorgi Turmanidze "GT"
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      asterisk asterisk-moh-opsound-wav asterisk-core-sounds-en-wav \
      curl jq ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /etc/asterisk/* \
 && mkdir -p /var/spool/asterisk/monitor /var/lib/asterisk/sounds/custom
ENV TZ=Asia/Tbilisi
COPY conf/ /opt/gt-ats/conf/
COPY bin/ /usr/local/bin/
RUN chmod +x /usr/local/bin/*
ENTRYPOINT ["/usr/local/bin/pbx-entrypoint"]
