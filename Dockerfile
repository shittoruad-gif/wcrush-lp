FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

# お申し込みの控えの置き場所（Coolify の Persistent Storage を /app/data に付ける）
RUN mkdir -p /app/data
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/healthz || exit 1
CMD ["node", "server.js"]
