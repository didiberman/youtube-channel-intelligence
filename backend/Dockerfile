FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json backend/
RUN npm ci --workspace backend
COPY backend backend
RUN npm run build --workspace backend

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json backend/
RUN npm ci --omit=dev --workspace backend
COPY --from=build /app/backend/dist backend/dist
USER node
CMD ["node", "backend/dist/index.js"]

