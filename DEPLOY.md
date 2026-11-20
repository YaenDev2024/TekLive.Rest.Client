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

El tráfico real pasa por **dos** nginx, y **cada capa aplica su propio límite
de tamaño de cuerpo**:

```
Cloudflare → nginx HOST :443 → 127.0.0.1:5085 → nginx CONTENEDOR → bs-api:5171
```

El contenedor ya trae `client_max_body_size 8m` en su `location /api/`
(ver `nginx.conf` de este repo). **El nginx del host NO hereda ese valor.** El
default de nginx es **1 MB**, así que si el host no lo declara, una foto de
celular de 2-4 MB muere con **413 del nginx del host** antes de llegar al
contenedor.

- [ ] Añadir el vhost `rest.tekliveplus.com`. **Copiar el de
      `abogados.tekliveplus.com` NO basta**: ese vhost no declara
      `client_max_body_size` (verificado en `nginx-tekliveplus.conf` del repo
      del backend), así que una copia literal queda con el default de 1 MB y
      rompe la subida de imágenes de producto. Copia este bloque completo, que
      ya incluye la directiva:

      ```nginx
      server {
          listen 80;
          server_name rest.tekliveplus.com;

          # Subida de imágenes de producto (editor de productos).
          # El default de nginx es 1 MB: sin esta línea una foto de celular de
          # 2-4 MB recibe 413 en ESTE nginx, antes de llegar al contenedor.
          #
          # 8m y NO 4m, por dos razones:
          #  1. El contrato (4 MB de ARCHIVO) lo aplica bs-api, que responde el
          #     sobre { success:false, data:null, Message } con el mensaje
          #     exacto. Si el proxy corta antes, el navegador recibe un 413 sin
          #     cuerpo JSON y la UI muestra "excede el tamaño máximo de 4 MB"
          #     incluso para una foto de 2 MB: mensaje falso.
          #  2. Un archivo de 4 MB NO pesa 4 MB en el cable: el multipart añade
          #     boundary + cabeceras, así que con `4m` un archivo que el backend
          #     sí acepta sería rechazado por el proxy.
          # 8m coincide con el tope de transporte del endpoint
          # ([RequestSizeLimit] / MaxRequestBodySize = 8 MB en el controller),
          # así que el backend siempre llega a decidir y a explicar.
          # Aplica a TODAS las rutas de este vhost (holgado para el resto).
          client_max_body_size 8m;

          location / {
              proxy_pass http://127.0.0.1:5085;
              proxy_http_version 1.1;
              proxy_set_header Host $host;
              proxy_set_header X-Real-IP $remote_addr;
              proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
              proxy_set_header X-Forwarded-Proto $scheme;
              proxy_read_timeout 300s;
          }
      }
      ```

- [ ] Certificado:

      ```bash
      certbot --nginx -d rest.tekliveplus.com
      ```

      `certbot --nginx` **duplica el bloque `server` en una versión `listen 443
      ssl`**, y es esa versión la que atiende el tráfico real. Normalmente
      arrastra las directivas del bloque de :80, pero **confírmalo con el `grep`
      de abajo**: si el bloque de 443 quedó sin `client_max_body_size`, añádelo
      también ahí. Comprobar en los DOS bloques ({80 y 443}).

- [ ] `nginx -t && systemctl reload nginx`
- [ ] DNS: confirmar que `rest.tekliveplus.com` apunta a la IP del VPS
      (Cloudflare, registro A; el resto de subdominios ya existen).
- [ ] **Dónde va el vhost**: `nginx-tekliveplus.conf` del repo del backend
      declara todo en un solo archivo (los 4 vhosts existentes + el bloque
      `set_real_ip_from ... / real_ip_header CF-Connecting-IP` a nivel de
      archivo, líneas 27-50). Si añades el vhost **en ese mismo archivo**,
      hereda la IP real de Cloudflare y el rate limiting del API sigue
      funcionando por cliente. Si lo pones en un archivo aparte, **no** lo
      hereda: el API vería la IP de Cloudflare y todos los clientes
      compartirían los buckets de rate limit (login 5/min, refresh 30/min).
      No sé la ruta exacta del archivo en el VPS (su encabezado sugiere
      `/etc/nginx/sites-available/tekliveplus`, pero **verifícalo** con
      `grep -rn CF-Connecting-IP /etc/nginx/`).

#### 4.1 Verificación del límite en el host (obligatoria)

Sin esto, el deploy puede "verse bien" (la app carga, el login funciona) y
aun así **toda subida de imagen falla con 413**.

> **CASO REAL (2026-11-20, VPS de producción).** El deploy se hizo y todo
> parecía correcto: contenedores arriba, login funcionando, `image_url`
> guardado en BD, `/app/rest-images` con el volumen montado y una foto ya
> procesada a WebP de 64 KB (399x501). Aun así **la subida estaba rota**.
>
> La prueba de 6 MB devolvió **413** con cuerpo **HTML**. Causa: el bloque
> `server` de `rest` vive en **su propio archivo**
> `/etc/nginx/sites-available/rest.tekliveplus.com` (no en el
> `tekliveplus` compartido) y **le faltaba `client_max_body_size`**. Regía el
> default de 1 MB.
>
> Lo que hace este fallo traicionero: **el contenedor sí tenía el `8m`**
> (`/etc/nginx/conf.d/default.conf:58`), así que un `docker exec ... grep`
> daba por bueno el límite. El que cortaba era el nginx del **host**, que es
> otra capa.
>
> Comando que lo detecta sin ambigüedad (el único que mira la config
> **efectiva**, con includes y symlinks resueltos):
>
> ```bash
> sudo nginx -T 2>/dev/null | grep -c client_max_body_size    # 0 = ROTO
> sudo nginx -T 2>/dev/null | grep -A8 'server_name rest.tekliveplus.com'
> ```
>
> El fix fue **una línea** en el archivo propio de `rest` (con backup y
> `nginx -t` antes del reload); los otros 5 dominios no se tocaron:
>
> ```bash
> F=/etc/nginx/sites-available/rest.tekliveplus.com
> sudo cp $F $F.bak-$(date +%Y%m%d-%H%M%S)
> sudo sed -i 's|^    location / {|    client_max_body_size 8m;\n\n    location / {|' $F
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> Verificación posterior (obligatoria, ambas):
> `6 MB → 400/401` (llega al backend) y `9 MB → 413` (corta el límite).

- [ ] Confirmar que la directiva está **realmente en la config activa**. Ojo:
      `grep` sobre una ruta adivinada puede mirar el archivo equivocado (o uno
      que no está `include`ado). `nginx -T` imprime la configuración efectiva
      **ya con los `include` resueltos**, así que es la prueba buena.

      ```bash
      nginx -T 2>/dev/null | grep -n -B2 -A2 client_max_body_size
      ```

      Debe aparecer `8m` junto al `server_name rest.tekliveplus.com` (idealmente
      en los bloques :80 y :443). Si el `grep` sale vacío, el default de **1 MB**
      sigue activo y la subida de imágenes fallará aunque todo lo demás funcione.

      **Cuidado con el archivo de `rest`:** en el VPS de producción el bloque
      `rest` NO vive en `/etc/nginx/sites-available/tekliveplus` sino en
      `/etc/nginx/sites-available/rest.tekliveplus.com` (symlink en
      `sites-enabled/`). Editar el archivo compartido no sirve de nada y
      copiarlo entero sí puede romper los otros dominios. Localízalo primero:

      ```bash
      grep -rln 'server_name rest.tekliveplus.com' /etc/nginx/
      ```

      El mismo `nginx -T` sirve para localizar el archivo real del vhost:

      ```bash
      nginx -T 2>/dev/null | grep -n 'server_name rest.tekliveplus.com'
      grep -rln 'server_name rest.tekliveplus.com' /etc/nginx/
      ```

- [ ] Recargar y validar la sintaxis:

      ```bash
      nginx -t && systemctl reload nginx
      ```

- [ ] **Prueba funcional con una imagen de tamaño realista (2-3 MB)** — con una
      foto de <1 MB el defecto NO se manifiesta y la verificación no prueba nada.

      Usa una **foto real del teléfono** de 2-3 MB. **No generes el archivo con
      `urandom`**: bytes aleatorios no son una imagen y el backend los rechaza
      con `400 "El archivo no es una imagen válida."`, así que la prueba daría
      un falso negativo (400 legítimo, no 413) y parecería que el límite sigue
      mal. Tiene que ser una imagen decodificable.

      Desde el editor de productos (`/admin` → Editar productos → Editar →
      Imagen → Cambiar imagen), subir esa foto y comprobar en la pestaña
      Network la petición a `/api/rest/catalog/admin/products/{id}/image`:

      | Respuesta | Significado |
      |---|---|
      | **200** + toast "Producto actualizado exitosamente" | correcto: host y contenedor dejan pasar |
      | **400** JSON "La imagen excede el tamaño máximo de 4 MB." | correcto: el **contrato** del backend actuando (la foto pesa >4 MB). El proxy ya no corta; usa una de 2-3 MB para la prueba |
      | **413** con cuerpo **HTML** | corta un **nginx** (el default no manda JSON). Con 2-3 MB significa que **el host** sigue en 1 MB → revisar el `grep` de arriba |

      Si aparece un 413 **no se puede saber por el cuerpo** cuál de las dos capas
      nginx cortó (ninguna define `error_page`, así que ambas responden su HTML
      por defecto). Para distinguirlas: `grep` del host (arriba) y, si el host ya
      tiene `8m`, mirar el contenedor con
      `docker compose logs --tail=50 rest-client-web`.

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
- [ ] **Límite de subida en el host verificado** (`nginx -T | grep client_max_body_size`
      contiene `8m` para `rest.tekliveplus.com`) **y** subida real de una foto de
      2-3 MB devuelve 200. Sin este punto el deploy puede parecer correcto y
      romper todas las subidas de imagen (ver 4.1).

## Notas

- **No hay service worker** en Rest: cada deploy es visible con una recarga
  normal (el manifest/símbolos PWA sí se sirven con `no-cache`).
- La imagen del catálogo viene del API (`/api/rest/catalog/templates/{id}/image`)
  → same-origin, sin reglas CSP extra.
- Los sub-diálogos del wizard y el arqueo usan `proxy_read_timeout 300s`
  (bcrypt del login / transacciones del cierre de caja).

## Límite de subida (importante para futuros deploys)

El `client_max_body_size` **no se hereda entre capas ni entre vhosts**: cada
nginx aplica el suyo, y el default es **1 MB**. En Rest hay que declararlo en
las dos capas (contenedor + host). Si algún día se cambia el proxy, se añade
otra capa (otro CDN, un balanceador) o se mueve el vhost, **hay que volver a
verificarlo** con `nginx -T | grep client_max_body_size`.

**Alcance de la directiva.** Donde se declare, aplica al `server`/`location` y a
todo lo que cuelga de él. En el vhost de Rest la ponemos a nivel de `server`,
así que **todas las rutas de ese vhost aceptan hasta 8 MB**, no solo el upload.
Es intencional: 8 MB es holgado para el resto del tráfico y así no hay forma de
que una ruta nueva quede sin límite. Si algún día ese vhost sirviera contenido
estático grande y se quisiera un tope distinto por ruta, la alternativa es
moverla dentro de `location /api/` (nginx permite declararla en `server`,
`location` o `http`); **no la pongas en dos sitios a la vez sin querer**, porque
el de `server` es el que heredan los `location` que no la redeclaren.

**Aviso para otros productos.** El mismo defecto afecta a **cualquier otro vhost
que suba archivos**, porque el límite no se hereda de un vhost a otro. Hoy: el
vhost de `abogados` (documentos de casos, `[RequestSizeLimit(20_000_000)]` en el
backend) **tampoco declara `client_max_body_size`**, así que sus subidas de
documentos están limitadas a 1 MB por el nginx del host aunque el backend acepte
20 MB. No se corrige aquí (vive en el repo del backend), pero **hay que
revisarlo antes de dar por buena la subida de documentos de Abogados**. Regla
general: cada vez que un vhost nuevo suba archivos, `client_max_body_size` en
ese vhost + la verificación de 4.1.

