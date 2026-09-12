# syntax=docker/dockerfile:1
#
# Image du site : construit le validateur puis sert des fichiers statiques.
# Prévue pour Coolify (build pack « Dockerfile »), mais utilisable partout :
#   docker build -t facturx-site . && docker run --rm -p 8080:80 facturx-site

# --- Étape 1 : construire le SDK, récupérer les ressources, bundler le validateur
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Manifestes d'abord : la couche d'installation n'est refaite que si les dépendances changent.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/facturx/package.json packages/facturx/
COPY examples/deposit-node/package.json examples/deposit-node/
COPY examples/emit-node/package.json examples/emit-node/
COPY examples/http-handler/package.json examples/http-handler/
COPY examples/receive-node/package.json examples/receive-node/
RUN pnpm install --frozen-lockfile

COPY . .
# Télécharge le runtime Saxon-JS (saxonica.com) et les schematrons officiels (mustangproject),
# les compile, puis produit site/validateur/. Nécessite un accès réseau pendant la construction.
RUN pnpm site:dist

# --- Étape 2 : servir
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site /usr/share/nginx/html
# Documentation de développement : pas de raison de la publier.
RUN rm -f /usr/share/nginx/html/README.md
EXPOSE 80
