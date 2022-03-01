FROM node:14-alpine
WORKDIR /app
EXPOSE 3000

COPY package.json package-lock.json ./
RUN npm i

COPY . .
RUN npm run build

CMD [ "node", "dist/examples/index.js" ]
