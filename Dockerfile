FROM node:12-alpine

VOLUME /downloads

WORKDIR /app

COPY . .

RUN npm install --production

CMD ["npm", "start"]



