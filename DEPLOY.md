# DEPLOY — Rest Client en el VPS (https://rest.tekliveplus.com)

Patrón idéntico a Market/SPA/Abogados: contenedor nginx propio que sirve el
build de Vite y proxya `/api/` hacia `bs-api` en la red compose de Docker.
**Mismo origen → sin CORS.** El frontend se hornea con `VITE_API_BASE_URL`
vacío (llamadas relativas) y la API key como build-arg.

> Los coordinadores ejecutan esto en el VPS. No hay SSH directo desde esta
> máquina: el repo se clona/clona-actualiza en el servidor y se edita el
> compose allí (o vía web terminal como se hizo con Abogados).

## Checklist de deploy

### 1. Código en el VPS

- [ ] Commit del trabajo demo en `TekLive.Rest.Client` (lo hace el
      coordinador; este repo queda con los cambios sin commitear a propósito).
- [ ] Push a `origin/master` y verificar: `git ls-remote origin master`.
- [ ] En el VPS, junto a los otros repos (`/opt/TekLive.Rest.Client`):

      ```bash
      cd /opt && git clone <URL_DEL_REPO> TekLive.Rest.Client
      cd TekLive.Rest.Client && git log --oneline -1   # verificar HEAD esperado
      ```

      (Si ya existía: `git fetch && git reset --hard origin/master` — nunca
      `pull` sobre un checkout sucio.)

### 2. Servicio en `docker-compose.yml` de BusinessSuite

- [ ] Añadir junto a `abogados-client-web` (puerto siguiente: 5085):

      ```yaml
      rest-client-web:
        build:
          context: ../TekLive.Rest.Client
          dockerfile: Dockerfile
          args:
            VITE_APP_API_KEY: ${REST_APP_API_KEY}
            VITE_API_BASE_URL: "" # vacío = relativo, nginx proxya /api/
        container_name: rest-client-web
        restart: unless-stopped
        depends_on: [bs-api]
        environment:
          API_UPSTREAM: bs-api:5171
        ports: ["127.0.0.1:5085:80"] # solo loopback, lo expone nginx
        networks: [bs-frontend]
      ```

- [ ] Añadir `REST_APP_API_KEY=<clave real del módulo Rest>` al `.env` del
      compose (mismo mecanismo que `MARKET_APP_API_KEY` / `ABOG_APP_API_KEY`;
      NO commitear la clave).
- [ ] Verificar que `bs-api` está en la red `bs-frontend` (lo está: market/
      spa/abogados ya la usan).

### 3. Build y arranque

- [ ] `docker compose build rest-client-web` — debe compilar (npm ci + build
      dentro de node:20-alpine) y terminar sin errores.
- [ ] `docker compose up -d rest-client-web`
- [ ] Smoke interno: `docker compose exec rest-client-web wget -qO- http://127.0.0.1/ | head -5`
      (devuelve el `index.html`).

### 4. Nginx del host + HTTPS

- [ ] Añadir el vhost `rest.tekliveplus.com` (copia del de
      `abogados.tekliveplus.com` cambiando server_name y puerto → 5085).
- [ ] Certificado:

      ```bash
      certbot --nginx -d rest.tekliveplus.com
      ```

- [ ] `nginx -t && systemctl reload nginx`
- [ ] DNS: confirmar que `rest.tekliveplus.com` apunta a la IP del VPS
      (Cloudflare, registro A; el resto de subdominios ya existen).

### 5. Verificación final (desde internet)

- [ ] `curl -s https://rest.tekliveplus.com/ | head -3` → HTML de la app.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://rest.tekliveplus.com/manifest.webmanifest` → 200.
- [ ] Login real desde el navegador: número de empleado + password (pasa por
      `/api/` proxyado — si falla, revisar `docker compose logs bs-api` y
      que `REST_APP_API_KEY` coincida con la clave del módulo Rest en el API).
- [ ] Flujo completo desde el teléfono (HTTPS real): login → módulos →
      Piso 1 → venta con wizard → checkout → Órdenes. En el teléfono:
      "Añadir a pantalla de inicio" (PWA instalable, manifest ya tiene iconos).
- [ ] `docker compose logs --tail=50 rest-client-web` sin errores repetidos.

## Notas

- **No hay service worker** en Rest: cada deploy es visible con una recarga
  normal (el manifest/símbolos PWA sí se sirven con `no-cache`).
- La imagen del catálogo viene del API (`/api/rest/catalog/templates/{id}/image`)
  → same-origin, sin reglas CSP extra.
- Los sub-diálogos del wizard y el arqueo usan `proxy_read_timeout 300s`
  (bcrypt del login / transacciones del cierre de caja).
