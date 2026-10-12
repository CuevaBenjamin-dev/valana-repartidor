FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
COPY database database
RUN npm run build -w apps/api
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/database database
COPY pruebas pruebas
CMD ["sh", "-c", "node apps/api/dist/scripts/migrate.js && node apps/api/dist/scripts/seed.js && node apps/api/dist/main.js"]
