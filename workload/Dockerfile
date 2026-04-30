FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit

COPY run_compute.js ./

ENV INPUT_DIR=/inputs
ENV OUTPUT_DIR=/outputs
CMD ["node", "run_compute.js"]
