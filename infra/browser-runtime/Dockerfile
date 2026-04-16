FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Shanghai
ENV BROWSER_LOCALE=zh-CN
ENV BROWSER_TIMEZONE=Asia/Shanghai

RUN sed -i 's@http://archive.ubuntu.com/ubuntu@https://mirrors.ustc.edu.cn/ubuntu@g' /etc/apt/sources.list \
    && sed -i 's@http://security.ubuntu.com/ubuntu@https://mirrors.ustc.edu.cn/ubuntu@g' /etc/apt/sources.list \
    && sed -i '/jammy-backports/s/^/# /' /etc/apt/sources.list \
    && apt-get update -o Acquire::Retries=5 \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        locales \
        tzdata \
        xvfb \
        x11vnc \
        fluxbox \
        websockify \
        novnc \
        fonts-dejavu-core \
        fonts-freefont-ttf \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && chmod a+r /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update -o Acquire::Retries=5 \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && sed -i 's/^# *zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/; s/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen \
    && ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime \
    && echo "${TZ}" > /etc/timezone \
    && mkdir -p /data/browser-state \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=zh_CN.UTF-8
ENV LANGUAGE=zh_CN:zh:en_US:en
ENV LC_ALL=zh_CN.UTF-8
ENV BROWSER_CHROMIUM_CHANNEL=chrome

COPY infra/browser-runtime/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY infra/browser-runtime/server.py /app/server.py
COPY infra/browser-runtime/entrypoint.sh /app/entrypoint.sh
COPY infra/browser-runtime/embedded_vnc.html /usr/share/novnc/embedded_vnc.html

RUN chmod +x /app/entrypoint.sh \
    && chown -R pwuser:pwuser /app /data

EXPOSE 18100 6080

ENV DISPLAY=:99

USER pwuser

CMD ["/app/entrypoint.sh"]
