# Stage 1: Build the React/Vite frontend
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production runtime — only what's needed
FROM node:20-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist
COPY branding.config.json .
COPY shared ./shared
# All server-side modules (server.js requires several *.cjs helpers)
COPY *.js *.cjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
