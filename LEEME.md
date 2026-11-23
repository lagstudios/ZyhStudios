# ZYH Web — tu servidor gratis

Esta carpeta es la web de ZYH Studios: cuentas ZYH, paquetes y licencias. También es la
que responde a las apps cuando preguntan si tienes plan.

Corre en **Cloudflare Workers**, que tiene un plan **gratis de verdad** (no es una prueba de
30 días y no pide tarjeta para empezar). Con la base de datos D1, también gratis, no hay que
pagar nada para arrancar.

## Qué incluye el plan gratis (al 10 de noviembre de 2026)

| | Gratis |
|---|---|
| Peticiones al servidor | 100 000 al día |
| Tiempo de CPU | 10 ms por petición |
| Base de datos D1 | 5 GB · 5 millones de filas leídas y 100 000 escritas al día |
| La web en sí (HTML, CSS, imágenes) | gratis e ilimitada |

Para una tienda que empieza, eso sobra. Si algún día se queda corto, el plan de pago
arranca en US$5 al mes.

---

## 1. Conseguir el servidor (10 minutos)

1. Crea una cuenta en <https://dash.cloudflare.com/sign-up>. Es gratis.
2. Instala Node.js (versión 20 o más nueva) desde <https://nodejs.org>.
3. Abre una terminal en esta carpeta y escribe:

   ```bash
   npm install
   npx wrangler login
   ```

   Se abre el navegador para que autorices tu cuenta.

4. Publica:

   ```bash
   npm run deploy
   ```

   Wrangler crea sola la base de datos D1 y te da una dirección tipo
   `https://zyh-web.TU-USUARIO.workers.dev`. Esa es tu web.

> Si tu versión de wrangler pide el `database_id`, créala a mano con
> `npx wrangler d1 create zyh-web` y pega el id que te dé en `wrangler.jsonc`.

### Probar antes, en tu propio equipo

```bash
npm run dev
```

Abre <http://localhost:8787>. Todo funciona igual, con una base de datos local.

---

## 2. La primera cuenta es la tuya

Entra a tu web y crea una cuenta en **Entrar → Crear una cuenta ZYH**.

**La primera cuenta que se registra queda como administrador.** Créala tú antes de
compartir la dirección con nadie. Desde "Administrar" puedes:

- darle un plan a cualquier usuario (producto, plan, días y dispositivos extra),
- liberar los equipos de una licencia o quitarla,
- publicar o rechazar los paquetes que suba la gente,
- bloquear cuentas o hacer administrador a alguien más.

Cómo cobras: el cliente paga con los botones de PayPal de la página del producto, indicando su usuario
ZYH y el plan; tú le activas el plan en "Administrar". La app lo detecta sola.

---

## 3. Conectar las apps con tu web

Cada app trae un botón **"Entrar con cuenta ZYH"** en su pantalla de planes. Abajo de ese
cuadro hay un campo **Servidor**: pega ahí la dirección de tu web y pulsa Guardar.

Para que las apps salgan ya apuntando a tu web (y no haya que escribirla), cambia esta
línea antes de repartirlas, en `apps/_core/zyhcore/account.py`:

```python
BASE_DEFAULT = "https://zyh-web.TU-USUARIO.workers.dev"
```

Lo que viaja entre la app y la web:

- la contraseña **nunca** sale del equipo: se deriva con PBKDF2 (200 000 vueltas) y solo
  viaja el resultado;
- del equipo solo se manda un **hash**, nunca la identificación del dispositivo;
- la sesión se guarda cifrada en el equipo (formato `.zyhd`).

Si te quedas sin internet, las apps siguen funcionando con la licencia guardada
(hasta 7 días de gracia).

---

## 4. Subir el código a GitHub (opcional pero recomendado)

```bash
git init
git add .
git commit -m "ZYH Web"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/zyh-web.git
git push -u origin main
```

Después, en el panel de Cloudflare → Workers & Pages → tu worker → **Settings → Builds**,
conecta el repositorio. A partir de ahí, cada `git push` publica la web sola.

---

## 5. Tu dominio propio (opcional)

Con un dominio (unos US$10 al año) puedes usar `zyhstudios.com` en vez de
`workers.dev`: panel de Cloudflare → tu worker → **Settings → Domains & Routes → Add**.
El certificado HTTPS es automático y gratis.

---

## Qué hay en cada archivo

```
src/worker.js      El servidor: cuentas, sesiones, paquetes, licencias y administración.
public/index.html  La página.
public/app.js      La interfaz (sin librerías externas).
public/styles.css  Los estilos.
wrangler.jsonc     La configuración de Cloudflare.
```

Las subidas (icono, imágenes y archivo del paquete) se guardan en la propia base de datos
en trozos de 512 KB. Límites: icono 512 KB, imagen 2 MB, paquete 15 MB. Si un paquete pesa
más, se pone un enlace de descarga `https://` (por ejemplo, a una release de GitHub).

## Cosas que conviene saber

- El plan gratis da 10 ms de CPU por petición, por eso la contraseña se deriva en el
  navegador y la app, no en el servidor.
- Si borras el worker, se borra la base de datos. Haz copias con
  `npx wrangler d1 export zyh-web --output respaldo.sql`.
- La primera cuenta es administrador: no publiques la dirección antes de crearla.

---

## Carpetas: tú solo subes archivos

La web se arma sola leyendo las carpetas. En Cloudflare, en Settings → Build configuration, el **Build command** es `node tools/build.mjs` (ya configurado).

```
public/videos/                       videos del inicio (cualquier .mp4)  + config.json (título, autoplay, loop, muted)
public/productos/<producto>/
    config.json                      nombre, descripción, orden, planes, extras, "compatible", "zyhos"
    logo.png
    <version>/                       ejemplo 1.0  (cada versión nueva es una carpeta nueva: 1.1, 2.0…)
        notas.txt                    qué trae esta versión
        imagenes/                    capturas (jpg/png/webp)
        videos/                      videos de esta versión
        paquete/                     el .zip que se descarga
```

- Una carpeta de producto nueva = página nueva (`/productos/<producto>/<version>/`) y su zona en el inicio.
- Una versión nueva = carpeta nueva; la web ofrece las versiones en un selector y deja la última por defecto.
- `"zyhos": true` en `config.json` añade "incluyendo ZYH OS" al texto de compatibilidad (hoy está en `false`).
- Los pagos están en `config.json` de cada producto: `boton` (enlace de pago de PayPal) y `carrito` (artículo del carrito).
- No pongas tu correo ni tu número en videos, imágenes ni textos: todo lo de `public/` es público.

---

## Añadir una app a la web (sin tocar código)
La web trae las 6 apps; para añadir otra una app copia `public/productos/_plantilla` con el nombre corto de tu app (sin `_`),
llena `config.json` (nombre, descripción, planes y botón de PayPal) y pon `logo.png`, `1.0/paquete/<app>.zip`, `1.0/imagenes/` y `1.0/videos/`.
Al desplegar, la app sale sola en el menú **Apps**, en la portada y con su página; sus planes y precios se activan en el servidor.

---

## Zyphora en la web (v1.5)
Entra a **#/zyphora** con tu Cuenta ZYH: sala general, chats privados, grupos, notificaciones (sin leer), 8 temas y 9 fondos
(los 6 de Zyphora, los 6 fondos de pantalla del ZYHT32 y tu propia imagen). El botón 🔗 da un código de 6 dígitos para vincular un ZYHT32.
La API para el aparato está en `ZYHT32_API.txt`.

## Zyphora v1.6 (compatible con ZYHT32 OS 1.0.14 "nuevo2")
- Notas de voz (la web graba y envía MP3 mono 16 kHz 64 kbps igual que el ZYHT32; se oyen en los dos lados), emojis, avisos del navegador con sonido, buscador de chats, borrar tus mensajes y separadores de día.
- El ZYHT32 manda los destinos sin @ ni #: el servidor lo entiende. Todo el protocolo está en `ZYHT32_API.txt`.
- Los audios usan el codificador lamejs (LGPL) incluido en `public/vendor/`.

## 1.7 — ZYH Business conectado
- Buzón /api/zr/* (chat PC<->celular cifrado, opiniones, solicitudes, avisos).
- Business 1.1 con el APK de Android y el .py nuevo (public/productos/business/1.1/paquete).
- Panel: Administrar > "ZYH Business (avisos y opiniones)".

## 1.8 — apps conectadas al servidor
- ZYH Business (PC y celular): /api/login, /api/license, /api/zr/* (chat, pedidos, opiniones, avisos, solicitudes) y /api/update/business.
  Las actualizaciones se arman solas: pon "versionCode" (y "version") en public/productos/business/<version>/version.json y deja en paquete/ el .py (PC) y el .apk (Android). El build calcula el SHA-256.
- ZYH Remote: relay por Internet en wss://TU-WEB/ws (Durable Object "ZyhRelay", ya declarado en wrangler.jsonc). En la app, Ajustes > Internet (relay): escribe  wss://zyhstudios.lagstudiosceo.workers.dev
  Opcional: crea el secreto RELAY_TOKEN en Cloudflare (Variables y secretos) y pon el mismo texto en «Token del relay» de la app para que solo tú lo uses.
- ZYHT32 IDE Android 3.2: usa /api/login, /api/logout y la Tienda ZYHT32 (/api/store/*), que ya existían.
- Productos nuevos en la web: ZYH Remote (1.0) y ZYHT32 IDE 3.2 (Android).

## Subir a GitHub con pocos archivos (carpeta /paquetes)
Todo .zip que pongas en la carpeta `paquetes/` del repo se abre solo dentro de `public/` cuando Cloudflare arma la web (lo hace `tools/build.mjs`).
- Los .zip llevan las rutas tal como van dentro de public (por ejemplo `productos/remote/1.0/notas.txt`). Se abren en orden alfabético y lo de un zip posterior reemplaza lo anterior.
- Para añadir o cambiar un producto: crea un .zip con su carpeta (`productos/<nombre>/…`), llámalo por ejemplo `04_remote.zip` y súbelo a `paquetes/`.
- Los .zip de este repo: 01_web (páginas, estilos, scripts), 02_videos, 03_productos.

## 1.9
- Business 1.6 (Android 1.6.2, PC 2.6.0 Plus) con plan Gratuito y lo que incluye cada plan.
- /api/update/<producto> responde la versión de PC al programa de PC (si version.json trae "pc": {version, versionCode}).
- Zyphora para Android 1.1 (producto nuevo, gratis) y ZYH Remote 1.0.1.
