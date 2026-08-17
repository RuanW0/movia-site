FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html obrigado.html /srv/
COPY assets /srv/assets
# O {$PORT:8080} do Caddyfile so cai no default quando PORT esta AUSENTE.
# Com PORT setado-e-vazio (variavel criada em branco no painel) o Caddy sobe
# em :80/:443 sem erro nenhum no log e o healthcheck na 8080 falha calado.
# Normaliza vazio -> 8080 antes do Caddy ler a config.
ENTRYPOINT ["/bin/sh","-c","export PORT=\"${PORT:-8080}\"; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
