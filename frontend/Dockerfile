# Build: docker build -t gnezdo-web frontend
# Debian (glibc), as the CI frontend check: the Alpine image failed vite build on 18 Nov 2026
# ("Code is nested too deeply" in react-dom/client.js) with the same packages
FROM node:22-slim AS build
WORKDIR /src
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV VITE_USE_API=true
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
