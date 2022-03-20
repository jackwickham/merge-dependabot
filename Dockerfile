# syntax=docker/dockerfile:1

FROM node:16

ENV NODE_ENV=production
WORKDIR /app

# Only copy package and package-lock, so npm ci can be cached
COPY package.json package-lock.json ./
RUN ["npm", "ci", "--only=production"]

# Now copy compiled code over
COPY ./lib ./lib

CMD ["npm", "run", "start"]
