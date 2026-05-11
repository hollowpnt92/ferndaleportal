FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config ./config
COPY public ./public
COPY src ./src
COPY views ./views

RUN mkdir -p data && chown -R node:node /app/data

USER node
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
