# Weyn API — standalone backend image. Build/run from the REPO ROOT:
#   docker build -f server/Dockerfile -t weyn-api .
#   docker run -p 4000:4000 -e PORT=4000 -v weyn-data:/data -e DATA_DIR=/data weyn-api
FROM node:20-alpine

WORKDIR /app

# only the backend's own deps are needed at runtime (cors/express/multer) —
# but this repo has one package.json for both web+api, so install everything
# and let the frontend deps sit unused; simplest correct option for a monorepo.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts || npm install --ignore-scripts

COPY server ./server

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 4000

CMD ["node", "server/index.js"]
