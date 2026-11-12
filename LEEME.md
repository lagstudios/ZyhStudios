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
