# =============================================================================
# Etapa 1 — compilación
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Se copian primero los manifiestos: mientras no cambien, Docker reutiliza la capa de
# `npm ci` y una modificación del código fuente no reinstala todas las dependencias.
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build

# =============================================================================
# Etapa 2 — dependencias de producción
# =============================================================================
FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# =============================================================================
# Etapa 3 — imagen final
# =============================================================================
FROM node:22-alpine AS production

# `wget` para el HEALTHCHECK; `dumb-init` para que las señales lleguen a Node y el
# contenedor pueda cerrarse de forma ordenada en lugar de morir por SIGKILL.
RUN apk add --no-cache dumb-init wget

ENV NODE_ENV=production
WORKDIR /app

# Usuario sin privilegios: si alguien consigue ejecución remota, no la consigue como root.
# La imagen de Node ya trae el usuario `node` (uid 1000).
COPY --chown=node:node package*.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
