FROM node:20-alpine

VOLUME /downloads

WORKDIR /app

COPY . .

RUN npm install

RUN npm install pm2 -g

RUN npm run build

CMD ["pm2-runtime", "--exp-backoff-restart-delay=100", "dist/index.js"]



