FROM node:20-slim

RUN apt-get update && apt-get install -y build-essential python3 wget curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production

# install snarkjs globally for runtime proof generation
RUN npm install -g snarkjs

COPY . .

# /inputs and /outputs will be mounted by orchestrator or nilCC job system
ENV INPUT_DIR=/inputs
ENV OUTPUT_DIR=/outputs
CMD ["node", "run_compute.js"]
