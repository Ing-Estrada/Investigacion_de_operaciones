# =============================================================================
# Etapa 1 — dependencias
# =============================================================================
FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

# =============================================================================
# Etapa 2 — compilación
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Las variables NEXT_PUBLIC_* se incrustan en el bundle del navegador en tiempo de
# compilación, no de ejecución: hay que pasarlas como build arg o el cliente apuntaría
# al valor por defecto.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# =============================================================================
# Etapa 3 — imagen final
# =============================================================================
FROM node:22-alpine AS runner

RUN apk add --no-cache wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# La salida `standalone` de Next trae solo las dependencias que el servidor usa en
# tiempo de ejecución: la imagen final no lleva node_modules completo.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
