// ZyhStudios — arma el manifiesto leyendo las carpetas. Se corre solo en Cloudflare (npm run build).
//   public/videos/                      -> videos del inicio (+ config.json opcional)
//   public/productos/<producto>/config.json
//   public/productos/<producto>/<version>/{imagenes,videos,paquete}/ y notas.txt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const PROD = path.join(PUB, "productos");
const IMG = /\.(jpe?g|png|webp|gif|avif)$/i, VID = /\.(mp4|webm|mov|m4v)$/i;
const exists = (p) => fs.existsSync(p);
const dirs = (p) => exists(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
const files = (p, re) => exists(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name).sort() : [];
const readJson = (p, def) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return def; } };
const vkey = (v) => v.split(".").map((x) => parseInt(x, 10) || 0);
const vcmp = (a, b) => { const x = vkey(a), y = vkey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const nice = (f) => f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
const url = (...parts) => "/" + parts.map((p) => p.split("/").map(encodeURIComponent).join("/")).join("/");

const shell = (slug, ver) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZyhStudios</title><link rel="icon" href="/logo.png"><link rel="stylesheet" href="/styles.css"></head>
<body><header class="top"><a class="brand" href="/"><img src="/logo.png" alt="" width="34" height="34"><span>Zyh<b>Studios</b></span></a>
<button id="menu-btn" class="menu-btn" aria-label="Menú">☰</button><nav id="nav"></nav></header>
<main id="view" tabindex="-1" data-slug="${slug}" data-version="${ver}"><p class="muted">Cargando…</p></main>
<footer>© ZyhStudios · <a href="/#/terminos">Términos</a></footer><div id="toast" role="status" aria-live="polite"></div>
<noscript>Esta página necesita JavaScript.</noscript><script src="/producto.js"></script></body></html>
`;

// ---- videos del inicio
const vcfg = readJson(path.join(PUB, "videos", "config.json"), {});
const videos = { config: { titulo: "Mira ZYH en acción", autoplay: true, loop: true, muted: true, ...vcfg },
  items: files(path.join(PUB, "videos"), VID).map((f) => ({ archivo: f, titulo: vcfg.titulos?.[f] || nice(f), url: url("videos", f) })) };
delete videos.config.titulos;

// ---- productos
const productos = [];
for (const slug of dirs(PROD)) {
  const base = path.join(PROD, slug);
  const cfg = readJson(path.join(base, "config.json"), {});
  const versiones = [];
  for (const ver of dirs(base).filter((d) => /^\d/.test(d)).sort(vcmp)) {
    const vd = path.join(base, ver), meta = readJson(path.join(vd, "version.json"), {});
    const notas = exists(path.join(vd, "notas.txt")) ? fs.readFileSync(path.join(vd, "notas.txt"), "utf8").trim() : (meta.notas || "");
    const pk = files(path.join(vd, "paquete"), /./).filter((f) => !f.startsWith("."));
    const paquete = pk.length ? { nombre: pk[0], url: url("productos", slug, ver, "paquete", pk[0]), size: fs.statSync(path.join(vd, "paquete", pk[0])).size,
      otros: pk.slice(1).map((f) => ({ nombre: f, url: url("productos", slug, ver, "paquete", f), size: fs.statSync(path.join(vd, "paquete", f)).size })) } : null;
    versiones.push({ version: ver, notas, fecha: meta.fecha || "", paquete,
      imagenes: files(path.join(vd, "imagenes"), IMG).map((f) => url("productos", slug, ver, "imagenes", f)),
      videos: files(path.join(vd, "videos"), VID).map((f) => ({ titulo: meta.titulos?.[f] || nice(f), url: url("productos", slug, ver, "videos", f) })) });
    fs.writeFileSync(path.join(vd, "index.html"), shell(slug, ver));
  }
  if (!versiones.length) continue;
  fs.writeFileSync(path.join(base, "index.html"), shell(slug, ""));
  productos.push({ slug, nombre: cfg.nombre || slug, descripcion: cfg.descripcion || "", orden: cfg.orden ?? 99, gratis: !!cfg.gratis,
    compatible: cfg.compatible || ["Windows", "Linux"], zyhos: !!cfg.zyhos, planes: cfg.planes || [], extras: cfg.extras || [],
    logo: exists(path.join(base, "logo.png")) ? url("productos", slug, "logo.png") : "/logo.png", versiones });
}
productos.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
fs.writeFileSync(path.join(PROD, "index.html"), shell("", ""));
// ---- tienda de apps ZYHT32: public/tienda/<slug>/{icono.png, imagenes/, videos/}  (solo medios; la app vive en la base de datos)
const tienda = {};
for (const slug of dirs(path.join(PUB, "tienda"))) {
  const b = path.join(PUB, "tienda", slug), m = readJson(path.join(b, "medios.json"), {});
  tienda[slug] = { icono: exists(path.join(b, "icono.png")) ? url("tienda", slug, "icono.png") : "",
    imagenes: files(path.join(b, "imagenes"), IMG).map((f) => url("tienda", slug, "imagenes", f)),
    videos: files(path.join(b, "videos"), VID).map((f) => ({ titulo: m.titulos?.[f] || nice(f), url: url("tienda", slug, "videos", f) })) };
}
const pagos = readJson(path.join(PUB, "pagos.json"), {});
fs.writeFileSync(path.join(PUB, "manifiesto.json"), JSON.stringify({ generado: new Date().toISOString(), pagos, videos, productos, tienda }, null, 1));
console.log(`manifiesto: ${productos.length} productos, ${videos.items.length} videos, ${Object.keys(tienda).length} apps de tienda`);
