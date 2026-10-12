FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w apps/web
FROM nginx:1.29-alpine
COPY infraestructura/web/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/out /usr/share/nginx/html
EXPOSE 3000
