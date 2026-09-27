FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    PUBLIC_URL=https://zbi.baby

COPY package.json ./
COPY docs ./docs
COPY api ./api

USER node

EXPOSE 3000

CMD ["node", "api/server.js"]
