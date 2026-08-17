FROM caddy:2-alpine
COPY index.html obrigado.html /srv/
COPY assets /srv/assets
CMD ["sh","-c","caddy file-server --root /srv --listen :${PORT:-8080}"]
