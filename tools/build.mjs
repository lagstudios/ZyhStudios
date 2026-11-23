// ZyhStudios — arma el manifiesto leyendo las carpetas. Se corre solo en Cloudflare (npm run build).
//   public/videos/                      -> videos del inicio (+ config.json opcional)
//   public/productos/<producto>/config.json
//   public/productos/<producto>/<version>/{imagenes,videos,paquete}/ y notas.txt
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");

// ---- paquetes comprimidos: todo .zip de la carpeta /paquetes (en el repo) se abre dentro de /public antes de armar la web.
// Así en GitHub subes pocos .zip en vez de cientos de archivos. Se abren en orden alfabético (01_, 02_…) y lo de después reemplaza a lo de antes.
// Cada .zip trae las rutas tal como van dentro de public (por ejemplo productos/business/1.5/notas.txt); si trae una carpeta "public/" arriba, se ignora.
function abrirZip(file, dest) {
  const buf = fs.readFileSync(file);
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error(path.basename(file) + ": no es un .zip válido");
  const n = buf.readUInt16LE(e + 10);
  let off = buf.readUInt32LE(e + 16), count = 0, total = 0;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error(path.basename(file) + ": zip dañado");
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
    let name = buf.toString("utf8", off + 46, off + 46 + nlen).replace(/\\/g, "/");
    off += 46 + nlen + elen + clen;
    name = name.replace(/^public\//, "");
    if (!name || name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(name)) continue;
    const out = path.resolve(dest, name);
    if (!out.startsWith(path.resolve(dest) + path.sep)) throw new Error(path.basename(file) + ": ruta no permitida " + name);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28), raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data || data.length !== usize) throw new Error(path.basename(file) + ": no pude abrir " + name);
    total += data.length; if (total > 300 * 1048576) throw new Error(path.basename(file) + ": demasiado grande");
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data); count++;
  }
  return count;
}
fs.mkdirSync(PUB, { recursive: true });
const PAQ = path.join(ROOT, "paquetes");
if (fs.existsSync(PAQ)) for (const f of fs.readdirSync(PAQ).filter((x) => /\.zip$/i.test(x)).sort()) console.log("paquetes/" + f + ": " + abrirZip(path.join(PAQ, f), PUB) + " archivos");

const PROD = path.join(PUB, "productos");
const IMG = /\.(jpe?g|png|webp|gif|avif)$/i, VID = /\.(mp4|webm|mov|m4v)$/i;
const exists = (p) => fs.existsSync(p);
const dirs = (p) => exists(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[_.]/.test(e.name)).map((e) => e.name) : [];   // carpetas que empiezan con _ o . se ignoran (plantillas)
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
const updates = {};   // para /api/update/<producto>: solo si la versión trae "versionCode" en version.json
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
    if (meta.versionCode != null && pk.length) {
      const hash = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(vd, "paquete", f))).digest("hex");
      const dl = (f) => ({ url: url("productos", slug, ver, "paquete", f), sha256: hash(f), sizeBytes: fs.statSync(path.join(vd, "paquete", f)).size });
      const apk = pk.find((f) => /\.apk$/i.test(f)), py = pk.find((f) => /\.py$/i.test(f)), downloads = {};
      if (apk) downloads.android = dl(apk);
      if (py) { downloads.windows = dl(py); downloads.linux = downloads.windows; }
      const cur = updates[slug];
      if (!cur || meta.versionCode >= cur.versionCode) updates[slug] = { version: meta.version || ver, versionCode: meta.versionCode, releaseDate: meta.fecha || "", ...(meta.pc && meta.pc.versionCode != null ? { pc: { version: String(meta.pc.version || meta.version || ver), versionCode: meta.pc.versionCode } } : {}),
        changelog: notas.split("\n").map((l) => l.replace(/^[-•\s]+/, "").trim()).filter((l) => l && !/^novedades/i.test(l)).slice(0, 30), downloads };
    }
  }
  if (!versiones.length) continue;
  fs.writeFileSync(path.join(base, "index.html"), shell(slug, ""));
  productos.push({ slug, nombre: cfg.nombre || slug, descripcion: cfg.descripcion || "", orden: cfg.orden ?? 99, gratis: !!cfg.gratis,
    compatible: cfg.compatible || ["Windows", "Linux"], zyhos: !!cfg.zyhos, planes: cfg.planes || [], extras: cfg.extras || [], planGratis: cfg.planGratis || null,
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
// ---- planes para el servidor (licencias y pagos): salen de config.json de cada app
const planes = {};
const nDev = (pl) => Number.isFinite(pl.equipos) ? pl.equipos : /m[aá]s|ilimit/i.test(pl.dispositivos || "") ? 999 : parseInt((String(pl.dispositivos || "").match(/\d+/) || [1])[0], 10);
for (const p of productos) if (p.planes.length && !p.gratis) planes[p.slug] = { name: p.nombre, cycle: p.planes[0].ciclo || "mes",
  plans: Object.fromEntries(p.planes.map((pl) => [pl.id, [pl.nombre, pl.usd, nDev(pl)]])) };
fs.writeFileSync(path.join(path.dirname(PUB), "src", "update.json"), JSON.stringify(updates, null, 1));
fs.writeFileSync(path.join(path.dirname(PUB), "src", "planes.json"), JSON.stringify(planes, null, 1));
const pagos = readJson(path.join(PUB, "pagos.json"), {});
fs.writeFileSync(path.join(PUB, "manifiesto.json"), JSON.stringify({ generado: new Date().toISOString(), pagos, videos, productos, tienda }, null, 1));
console.log(`manifiesto: ${productos.length} productos, ${videos.items.length} videos, ${Object.keys(tienda).length} apps de tienda`);
