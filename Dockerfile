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
# Le projet Supabase du compte, injecté dans le bundle du Studio : l'URL et la clé publique
# (anon/publishable), jamais la clé de service. Vides, le Studio n'offre aucun compte.
ARG FACTURX_SUPABASE_URL=""
ARG FACTURX_SUPABASE_KEY=""
ENV FACTURX_SUPABASE_URL=$FACTURX_SUPABASE_URL \
    FACTURX_SUPABASE_KEY=$FACTURX_SUPABASE_KEY
# Télécharge le runtime Saxon-JS (saxonica.com) et les schematrons officiels (France_RFE, XSD
# mustangproject), les compile, puis produit site/validateur/. Nécessite un accès réseau pendant
# la construction.
RUN pnpm site:dist

# --- Étape 2 : servir
FROM nginx:1.27-alpine
ENV TZ=Europe/Paris
# goaccess : rapport de fréquentation ; apache2-utils : htpasswd ; tzdata : horodatage local.
RUN apk add --no-cache goaccess apache2-utils tzdata
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# La CSP : le gabarit, puis le script qui en tire /etc/nginx/csp.conf (voir plus bas).
COPY docker/csp.conf /etc/nginx/csp.gabarit
COPY docker/entrypoint.sh docker/goaccess-report.sh docker/compteurs-report.sh docker/ecrire-csp.sh \
    /usr/local/bin/
# Le complément du rapport : un lien vers la page des compteurs. /var/lib/goaccess, servi sur
# /stats/, n'est pas un volume : le fichier de l'image y est à chaque démarrage.
COPY docker/rapport.js /var/lib/goaccess/
# Le même projet Supabase que dans l'étape précédente, pour la CSP : son URL est la seule origine
# extérieure que connect-src autorise. Elle est écrite ici, à la construction, et non au démarrage
# par l'entrypoint : une variable d'exécution pourrait différer de l'URL gravée dans le bundle du
# Studio, qui n'aurait plus le droit d'appeler son propre projet. Vide, pas d'origine en plus. Une
# valeur qui n'est pas une origine arrête la construction (voir docker/ecrire-csp.sh).
ARG FACTURX_SUPABASE_URL=""
# Dans l'image nginx, access.log est un lien vers /dev/stdout : GoAccess a besoin d'un vrai fichier.
# Le stats.conf écrit ici est une valeur de repli : la configuration nginx reste valide même si
# l'entrypoint ne s'exécutait pas. Le « nginx -t » final fait échouer la construction plutôt que
# le démarrage du site — une erreur de configuration ne peut donc pas atteindre la production.
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/goaccess-report.sh \
        /usr/local/bin/compteurs-report.sh /usr/local/bin/ecrire-csp.sh \
    && rm -f /var/log/nginx/access.log \
    && mkdir -p /var/lib/goaccess \
    && echo '*/5 * * * * /usr/local/bin/goaccess-report.sh' >/etc/crontabs/root \
    && echo 'location /stats/ { return 404; }' >/etc/nginx/stats.conf \
    && /usr/local/bin/ecrire-csp.sh "$FACTURX_SUPABASE_URL" \
    && nginx -t
COPY --from=build /app/site /usr/share/nginx/html
# Documentation de développement : pas de raison de la publier.
RUN rm -f /usr/share/nginx/html/README.md
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
