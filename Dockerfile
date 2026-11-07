FROM node:22-alpine

WORKDIR /app

# Install packages first so Docker can cache this step
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js parser.js ./
COPY public ./public

ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000

# Run as a normal user, not root (compose can override this with user: "1001:100")
USER node

CMD ["node", "server.js"]
