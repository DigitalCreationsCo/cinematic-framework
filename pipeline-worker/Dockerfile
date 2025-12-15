FROM node:20-alpine

WORKDIR /usr/src/app

# Copy package files from the project root build context
COPY package*.json ./

# Install dependencies based on the root package.json
# Relying on npm install here, assuming it resolves dependencies correctly in this context
RUN npm install --production
RUN npm install tsx

# Copy relevant source code for the pipeline worker
COPY pipeline-worker/ ./pipeline-worker/
COPY pipeline/ ./pipeline/
COPY audio/ ./audio/
COPY shared/ ./shared/

# Assuming the main entry point for the worker service will be index.ts in this directory
CMD ["tsx", "pipeline-worker/index.ts"]
