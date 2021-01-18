FROM node:12-alpine

VOLUME /downloads

WORKDIR /app

COPY . .

RUN npm install

RUN npm install pm2 -g

RUN npm run build

CMD ["pm2-runtime", "dist/index.js"]



