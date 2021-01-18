FROM node:12-alpine

VOLUME /downloads

WORKDIR /app

COPY . .

RUN npm install --production

RUN npm run build-prod

CMD ["npm", "start"]



