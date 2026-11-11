# Build multi-stage: Node compila el frontend dentro del contenedor
# (en el VPS no hay Node; mismo principio que los Dockerfiles SDK del repo).
# Las VITE_* se hornean en el build -> pasar como --build-arg en compose.
# VITE_API_BASE_URL va VACÍO: mismo origen, nginx proxya /api/ (patrón Market).
ARG VITE_API_BASE_URL=""
ARG VITE_APP_API_KEY=""

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_APP_API_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_APP_API_KEY=$VITE_APP_API_KEY
# Salida: /app/dist (index.html + assets/ + manifest.webmanifest + iconos)
RUN npm run build

# Imagen final: solo nginx sirviendo el dist construido.
FROM nginx:alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/templates/nginx.conf.template
# Snippet con los headers de seguridad (nginx no hereda add_header
# entre niveles cuando el hijo define los suyos: se incluye donde toque).
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf

# API_UPSTREAM apunta al servicio del API en la red compose
# (por defecto bs-api:5171). Se sustituye en arranque vía envsubst.
ENV API_UPSTREAM=bs-api:5171

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
