FROM node:22-alpine AS builder

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY Knowledge_Base_LippeLift.txt /app/../Knowledge_Base_LippeLift.txt
RUN npx tsc

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY Knowledge_Base_LippeLift.txt ../Knowledge_Base_LippeLift.txt

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
