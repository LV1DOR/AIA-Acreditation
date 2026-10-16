FROM node:22-bookworm-slim
WORKDIR /synthetic-harness
RUN npm install --no-package-lock --no-save sharp@0.35.5 ioredis@6.0.0 @aws-sdk/client-s3@3.1138.0
COPY infra/linux-test/runtime.mjs ./runtime.mjs
USER node
CMD ["node", "runtime.mjs"]
