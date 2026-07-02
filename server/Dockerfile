# Weyn — single image serving both the API and the built frontend.
# Build/run from the REPO ROOT:
#   docker build -f server/Dockerfile -t weyn-api .
#   docker run -p 4000:4000 -e PORT=4000 -v weyn-data:/data -e DATA_DIR=/data weyn-api
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts

COPY prisma ./prisma
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY public ./public

# Prisma's generated client (src/generated/prisma) must exist at runtime —
# generate it as part of the image build, not just locally.
RUN npx prisma generate
# builds the frontend into dist/ — server/index.js serves it directly when
# dist/ exists, so this one image is the whole app, one deployment, one URL.
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 4000

CMD ["node", "server/index.js"]
