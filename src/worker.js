// ZYH Web — servidor (Cloudflare Workers + D1). ZYH Studios.
import PRODUCT_PLANS from "./planes.json";
// Cuentas ZYH, sesiones, paquetes (icono, imágenes y archivo), licencias y API para las apps.
// La base de datos se crea sola la primera vez. La primera cuenta que se registra es la del dueño (admin).

const SESSION_DAYS_WEB = 30, SESSION_DAYS_APP = 180;
const CHUNK = 512 * 1024;
const LIMITS = { icon: 512 * 1024, image: 2 * 1024 * 1024, package: 15 * 1024 * 1024 };
const code = (id) => String(id).padStart(7, "0");   // ID visible de la cuenta: 0000001, 0000002…
// Permisos del equipo. El dueño (cuenta 0000001) lo puede todo; "admin" lo puede todo menos gestionar roles;
// cualquier otro rol lo crea el dueño con los permisos que quiera.
const PERMS = {
  "cuentas.ver": "Ver cuentas, sus planes y sus reportes",
  "planes.dar": "Dar y quitar planes, y soltar equipos",
  "usuarios.reportar": "Reportar usuarios",
  "usuarios.banear": "Banear y desbanear usuarios",
  "paquetes.revisar": "Revisar, publicar y rechazar paquetes",
  "roles.gestionar": "Crear roles y asignarlos al equipo",
  "dias.regalar": "Regalar días gratis a una cuenta",
  "sitio.editar": "Cambiar el enlace de TikTok y otros datos del inicio",
  "planes.verificar": "Identificador de planes: revisar pagos pedidos y si los planes están activos",
  "transferencias.ver": "Ver todas las transferencias (pagos) de los clientes",
  "tienda.publicar": "Publicar apps en la tienda de ZYHT32 (cuando el dueño abra la tienda)",
  "transferencias.numero": "Ver el número completo de cada transferencia (no se da solo al dueño ni al admin)",
};
const ALL_PERMS = Object.keys(PERMS);
// El número del cliente solo lo ve quien tenga ese permiso en su rol (por ejemplo Recursos humanos): ni el dueño ni el admin lo reciben solos.
const ROLE_ONLY = ["transferencias.numero"];
const OWNER_PERMS = ALL_PERMS.filter((p) => !ROLE_ONLY.includes(p));
const PRESET_ROLES = [
  ["developer", "Desarrollador", ["cuentas.ver", "paquetes.revisar"]],
  ["ceo", "CEO", OWNER_PERMS.filter((p) => p !== "roles.gestionar")],
  ["identificador", "Identificador de planes", ["cuentas.ver", "planes.verificar"]],
  ["rrhh", "Recursos humanos", ["cuentas.ver", "transferencias.ver", "transferencias.numero"]],
];
const TRIALS = { compressor: { uses: 5, days: 5, level_max: 1 } };      // plan Lite: 1 nivel de compresión, 5 usos o 5 días
const CYCLE_DAYS = { "mes": 30, "fin de semana": 3 };
const RESERVED_ROLES = ["user", "admin", "owner", "dueno", "dueño"];
const SITE_DEFAULTS = { tiktok_url: "https://www.tiktok.com/@zyh_studios", tiktok_text: "Síguenos en TikTok" };
const PLATFORMS = ["linux", "windows", "zyht32", "otro"];
// Los planes salen de public/productos/<app>/config.json (los arma tools/build.mjs en src/planes.json): para añadir una app solo se crea su carpeta.
const PLANS = PRODUCT_PLANS;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS attempts(key TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_attempts ON attempts(key, ts)`,
  `CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS file_chunks(file_id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(file_id, seq))`,
  `CREATE TABLE IF NOT EXISTS packages(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '1.0', platform TEXT NOT NULL DEFAULT 'otro', status TEXT NOT NULL DEFAULT 'pendiente', owner_id INTEGER NOT NULL, icon_file TEXT NOT NULL DEFAULT '', file_id TEXT NOT NULL DEFAULT '', external_url TEXT NOT NULL DEFAULT '', downloads INTEGER NOT NULL DEFAULT 0, review_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS package_images(package_id INTEGER NOT NULL, file_id TEXT NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY(package_id, file_id))`,
  `CREATE TABLE IF NOT EXISTS licenses(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, product TEXT NOT NULL, plan TEXT NOT NULL, devices INTEGER NOT NULL, expires_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id, product)`,
  `CREATE TABLE IF NOT EXISTS roles(key TEXT PRIMARY KEY, name TEXT NOT NULL, perms TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS user_reports(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, by_id INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_user ON user_reports(user_id)`,
  `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, product TEXT NOT NULL, plan TEXT NOT NULL, extra INTEGER NOT NULL DEFAULT 0, amount_usd REAL NOT NULL DEFAULT 0, reference TEXT NOT NULL UNIQUE, number_enc TEXT NOT NULL DEFAULT '', number_last4 TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendiente', note TEXT NOT NULL DEFAULT '', reviewed_by INTEGER NOT NULL DEFAULT 0, reviewed_at INTEGER NOT NULL DEFAULT 0, license_id INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, id)`,
  `CREATE TABLE IF NOT EXISTS store_apps(slug TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Otras', price_cents INTEGER NOT NULL DEFAULT 0, version TEXT NOT NULL DEFAULT '1.0', author_id INTEGER NOT NULL, paypal_id TEXT NOT NULL DEFAULT '', pack TEXT NOT NULL DEFAULT '', pack_size INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'publicada', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS store_purchases(id INTEGER PRIMARY KEY, slug TEXT NOT NULL, user_id INTEGER NOT NULL, payment_id INTEGER NOT NULL DEFAULT 0, price_cents INTEGER NOT NULL, creator_cents INTEGER NOT NULL, studio_cents INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(slug, user_id))`,
  `CREATE TABLE IF NOT EXISTS links(user_id INTEGER NOT NULL, provider TEXT NOT NULL, external TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, code_hash TEXT NOT NULL DEFAULT '', code_exp INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, provider))`,
  `CREATE TABLE IF NOT EXISTS trials(product TEXT NOT NULL, device_hash TEXT NOT NULL, user_id INTEGER NOT NULL, started_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(product, device_hash))`,
  `CREATE INDEX IF NOT EXISTS idx_trials_user ON trials(user_id, product)`,
  `CREATE TABLE IF NOT EXISTS devices(license_id INTEGER NOT NULL, device_hash TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY(license_id, device_hash))`,
];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const now = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const safeEqual = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

let schemaReady = null;
function ensureSchema(env) {
  if (!env.DB) throw new HttpError(500, "Falta la base de datos D1 (binding DB). Revisa la guía de instalación.");
  if (!schemaReady) schemaReady = env.DB.batch([...SCHEMA.map((q) => env.DB.prepare(q)),
    ...PRESET_ROLES.map(([k, n, pr]) => env.DB.prepare("INSERT OR IGNORE INTO roles(key, name, perms, created_at) VALUES(?,?,?,?)").bind(k, n, JSON.stringify(pr), now()))]).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ------------------------------------------------------------------ sesiones y cuentas
function readToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return { token: auth.slice(7).trim(), via: "bearer" };
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)zyh_session=([a-f0-9]{64})/);
  return m ? { token: m[1], via: "cookie" } : null;
}

async function currentUser(request, env) {
  const t = readToken(request);
  if (!t || !/^[a-f0-9]{64}$/.test(t.token)) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.username, u.email, u.role, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0",
  ).bind(await sha256(t.token), now()).first();
  if (!row) return null;
  // Con cookie, las peticiones que cambian datos deben venir de esta misma web (protección CSRF).
  if (t.via === "cookie" && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, "Origen no permitido.");
  }
  row.perms = await permsOf(env, row);
  return row;
}
async function permsOf(env, u) {
  if (u.id === 1) return OWNER_PERMS;
  if (u.role === "admin") return OWNER_PERMS.filter((p) => p !== "roles.gestionar");
  if (u.role === "user") return [];
  const r = await env.DB.prepare("SELECT perms FROM roles WHERE key = ?").bind(u.role).first();
  try { return (JSON.parse(r?.perms || "[]")).filter((p) => ALL_PERMS.includes(p)); } catch { return []; }
}
const can = (u, perm) => !!u && Array.isArray(u.perms) && u.perms.includes(perm);
const needPerm = (u, perm) => { needUser(u); if (!can(u, perm)) throw new HttpError(403, "No tienes permiso para esto."); return u; };
const needUser = (u) => { if (!u) throw new HttpError(401, "Inicia sesión con tu cuenta ZYH."); return u; };

async function rateLimit(env, key, max, windowSec) {
  const since = now() - windowSec;
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?").bind(key, since).first();
  if (r.n >= max) throw new HttpError(429, "Demasiados intentos. Espera unos minutos y vuelve a intentar.");
}
const hit = (env, key) => env.DB.prepare("INSERT INTO attempts(key, ts) VALUES(?, ?)").bind(key, now()).run();
const ipOf = (request) => request.headers.get("cf-connecting-ip") || "local";

function validCredentials(body) {
  const username = clean(body.username, 40).toLowerCase();
  const dk = clean(body.dk, 80).toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, "Usuario: 3 a 32 caracteres (letras, números, punto, guion o guion bajo).");
  if (!/^[a-f0-9]{64}$/.test(dk)) throw new HttpError(400, "Credenciales con formato incorrecto. Actualiza la app o recarga la página.");
  return { username, dk };
}

async function newSession(env, userId, kind, label) {
  const token = randomHex(32), days = kind === "app" ? SESSION_DAYS_APP : SESSION_DAYS_WEB;
  await env.DB.prepare("INSERT INTO sessions(token_hash, user_id, kind, label, created_at, expires_at) VALUES(?,?,?,?,?,?)")
    .bind(await sha256(token), userId, kind, clean(label, 60), now(), now() + days * 86400).run();
  return { token, maxAge: days * 86400 };
}
const sessionCookie = (token, maxAge) => `zyh_session=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

async function register(request, env) {
  const body = await request.json().catch(() => ({}));
  const { username, dk } = validCredentials(body);
  const email = clean(body.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Correo no válido.");
  const ip = ipOf(request);
  await rateLimit(env, "reg:" + ip, 5, 3600);
  if (await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) throw new HttpError(409, "Ese usuario ya existe.");
  const salt = randomHex(16), hash = await sha256(salt + ":" + dk);
  const first = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n === 0;
  let res;
  try {
    res = await env.DB.prepare("INSERT INTO users(username, email, salt, hash, role, created_at) VALUES(?,?,?,?,?,?)")
      .bind(username, email, salt, hash, first ? "admin" : "user", now()).run();
  } catch { throw new HttpError(409, "Ese usuario ya existe."); }
  await hit(env, "reg:" + ip);
  const kind = body.client === "app" ? "app" : "web";
  const s = await newSession(env, res.meta.last_row_id, kind, body.label);
  return json({ ok: true, token: kind === "app" ? s.token : undefined, user: { username, role: first ? "admin" : "user" } }, 201,
    kind === "web" ? { "set-cookie": sessionCookie(s.token, s.maxAge) } : {});
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const { username, dk } = validCredentials(body);
  const ip = ipOf(request);
  await rateLimit(env, "login:" + username, 8, 900);
  await rateLimit(env, "ip:" + ip, 40, 900);
  const u = await env.DB.prepare("SELECT id, username, role, salt, hash, disabled FROM users WHERE username = ?").bind(username).first();
  const ok = u && !u.disabled && safeEqual(await sha256(u.salt + ":" + dk), u.hash);
  if (!ok) {
    await env.DB.batch([env.DB.prepare("INSERT INTO attempts(key, ts) VALUES(?, ?)").bind("login:" + username, now()),
      env.DB.prepare("INSERT INTO attempts(key, ts) VALUES(?, ?)").bind("ip:" + ip, now()),
      env.DB.prepare("DELETE FROM attempts WHERE ts < ?").bind(now() - 86400)]);
    throw new HttpError(401, "Usuario o contraseña incorrectos.");
  }
  const kind = body.client === "app" ? "app" : "web";
  const s = await newSession(env, u.id, kind, body.label);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run();
  return json({ ok: true, token: kind === "app" ? s.token : undefined, user: { username: u.username, role: u.role } }, 200,
    kind === "web" ? { "set-cookie": sessionCookie(s.token, s.maxAge) } : {});
}

async function changePassword(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const oldDk = clean(body.old_dk, 80).toLowerCase(), newDk = clean(body.new_dk, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(oldDk) || !/^[a-f0-9]{64}$/.test(newDk)) throw new HttpError(400, "Datos incompletos.");
  await rateLimit(env, "login:" + user.username, 8, 900);
  const u = await env.DB.prepare("SELECT salt, hash FROM users WHERE id = ?").bind(user.id).first();
  if (!safeEqual(await sha256(u.salt + ":" + oldDk), u.hash)) { await hit(env, "login:" + user.username); throw new HttpError(401, "La contraseña actual no es correcta."); }
  const salt = randomHex(16);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").bind(salt, await sha256(salt + ":" + newDk), user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(user.id, user.token_hash),   // cierra las demás sesiones
  ]);
  return json({ ok: true });
}

// ------------------------------------------------------------------ archivos (icono, imágenes y paquete) guardados en D1 por trozos
function sniffImage(bytes) {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function deleteFiles(env, ids) {
  const stmts = [];
  for (const id of ids.filter(Boolean)) {
    stmts.push(env.DB.prepare("DELETE FROM file_chunks WHERE file_id = ?").bind(id), env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

async function upload(request, env, user, url) {
  const kind = url.searchParams.get("kind");
  if (!LIMITS[kind]) throw new HttpError(400, "Tipo de archivo desconocido.");
  await rateLimit(env, "up:" + user.id, 80, 86400);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > LIMITS[kind]) throw new HttpError(413, `Archivo demasiado grande (máximo ${Math.round(LIMITS[kind] / 1024 / 1024 * 10) / 10} MB).`);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) throw new HttpError(400, "El archivo está vacío.");
  if (buf.length > LIMITS[kind]) throw new HttpError(413, `Archivo demasiado grande (máximo ${Math.round(LIMITS[kind] / 1024 / 1024 * 10) / 10} MB).`);
  let mime = "application/octet-stream";
  if (kind !== "package") {
    mime = sniffImage(buf);
    if (!mime) throw new HttpError(400, "La imagen debe ser PNG, JPG, WEBP o GIF.");
  }
  const name = clean(url.searchParams.get("name") || "archivo", 100).replace(/[^\w.\- ()]/g, "_") || "archivo";
  const id = randomHex(16);
  await env.DB.prepare("INSERT INTO files(id, owner_id, kind, name, mime, size, created_at) VALUES(?,?,?,?,?,?,?)").bind(id, user.id, kind, name, mime, buf.length, now()).run();
  try {
    for (let seq = 0, off = 0; off < buf.length; seq++, off += CHUNK) {
      await env.DB.prepare("INSERT INTO file_chunks(file_id, seq, data) VALUES(?,?,?)").bind(id, seq, buf.slice(off, off + CHUNK)).run();
    }
  } catch (e) { await deleteFiles(env, [id]); throw e; }
  await hit(env, "up:" + user.id);
  return json({ ok: true, id, size: buf.length, mime, name }, 201);
}

function streamFile(env, file, headers) {
  let seq = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      const row = await env.DB.prepare("SELECT data FROM file_chunks WHERE file_id = ? AND seq = ?").bind(file.id, seq++).first();
      if (!row) { controller.close(); return; }
      controller.enqueue(new Uint8Array(row.data));
    },
  });
  return new Response(stream, { headers: { "content-type": file.mime, "content-length": String(file.size), "x-content-type-options": "nosniff", ...headers } });
}

async function serveImage(env, user, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, "No existe.");
  const file = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND kind IN ('icon','image')").bind(id).first();
  if (!file) throw new HttpError(404, "No existe.");
  const pub = await env.DB.prepare(
    "SELECT 1 FROM packages p WHERE p.status = 'publicado' AND (p.icon_file = ?1 OR EXISTS(SELECT 1 FROM package_images i WHERE i.package_id = p.id AND i.file_id = ?1))",
  ).bind(id).first();
  if (!pub && !(user && (can(user, "paquetes.revisar") || user.id === file.owner_id))) throw new HttpError(404, "No existe.");
  return streamFile(env, file, { "cache-control": pub ? "public, max-age=86400" : "private, no-store" });
}

// ------------------------------------------------------------------ paquetes
const pkgPublic = (p) => ({ id: p.id, slug: p.slug, name: p.name, summary: p.summary, version: p.version, platform: p.platform, status: p.status,
  icon: p.icon_file ? `/api/files/${p.icon_file}` : "", downloads: p.downloads, updated_at: p.updated_at, owner: p.owner, has_file: !!(p.file_id || p.external_url), size: p.size || 0 });

async function listPackages(env, user, url) {
  const where = [], args = [];
  const scope = url.searchParams.get("scope");
  if (scope === "mine") { needUser(user); where.push("p.owner_id = ?"); args.push(user.id); }
  else if (scope === "all") { needPerm(user, "paquetes.revisar"); }
  else where.push("p.status = 'publicado'");
  const platform = url.searchParams.get("platform");
  if (PLATFORMS.includes(platform)) { where.push("p.platform = ?"); args.push(platform); }
  const q = clean(url.searchParams.get("q"), 60);
  if (q) { where.push("(p.name LIKE ? OR p.summary LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
  const rows = await env.DB.prepare(
    `SELECT p.*, u.username AS owner, f.size AS size FROM packages p JOIN users u ON u.id = p.owner_id LEFT JOIN files f ON f.id = p.file_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY (p.status = 'pendiente') DESC, p.updated_at DESC LIMIT 200`,
  ).bind(...args).all();
  return json({ packages: rows.results.map(pkgPublic) });
}

async function getPackage(env, user, key) {
  const p = await env.DB.prepare(
    `SELECT p.*, u.username AS owner, f.size AS size, f.name AS file_name FROM packages p JOIN users u ON u.id = p.owner_id LEFT JOIN files f ON f.id = p.file_id WHERE ${/^\d+$/.test(key) ? "p.id" : "p.slug"} = ?`,
  ).bind(/^\d+$/.test(key) ? Number(key) : key).first();
  if (!p) throw new HttpError(404, "Ese paquete no existe.");
  const mine = user && (can(user, "paquetes.revisar") || user.id === p.owner_id);
  if (p.status !== "publicado" && !mine) throw new HttpError(404, "Ese paquete no existe.");
  return { p, mine };
}

async function packageDetail(env, user, key) {
  const { p, mine } = await getPackage(env, user, key);
  const imgs = await env.DB.prepare("SELECT file_id FROM package_images WHERE package_id = ? ORDER BY pos").bind(p.id).all();
  return json({ package: { ...pkgPublic(p), description: p.description, file_name: p.file_name || "", external_url: mine ? p.external_url : "", review_note: mine ? p.review_note : "",
    images: imgs.results.map((r) => `/api/files/${r.file_id}`), image_ids: mine ? imgs.results.map((r) => r.file_id) : undefined, icon_id: mine ? p.icon_file : undefined, file_id: mine ? p.file_id : undefined, can_edit: !!mine } });
}

async function ownFile(env, user, id, kinds) {
  if (!id) return "";
  if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(400, "Archivo no válido.");
  const f = await env.DB.prepare("SELECT owner_id, kind FROM files WHERE id = ?").bind(id).first();
  if (!f || !kinds.includes(f.kind) || (f.owner_id !== user.id && !can(user, "paquetes.revisar"))) throw new HttpError(400, "Archivo no válido.");
  return id;
}

async function savePackage(request, env, user, key) {
  const body = await request.json().catch(() => ({}));
  const name = clean(body.name, 60), summary = clean(body.summary, 140), description = clean(body.description, 5000);
  const version = clean(body.version, 20) || "1.0", platform = PLATFORMS.includes(body.platform) ? body.platform : "otro";
  const external = clean(body.external_url, 400);
  if (name.length < 2) throw new HttpError(400, "Ponle un nombre al paquete (mínimo 2 letras).");
  if (external && !/^https:\/\/[^\s]+$/.test(external)) throw new HttpError(400, "El enlace de descarga debe empezar por https://");
  const icon = await ownFile(env, user, clean(body.icon_id, 40), ["icon"]);
  const file = await ownFile(env, user, clean(body.file_id, 40), ["package"]);
  const images = [];
  for (const id of (Array.isArray(body.image_ids) ? body.image_ids : []).slice(0, 5)) images.push(await ownFile(env, user, clean(id, 40), ["image"]));
  if (!file && !external) throw new HttpError(400, "Sube el archivo del paquete o pon un enlace de descarga (https).");
  const status = can(user, "paquetes.revisar") ? "publicado" : "pendiente";      // lo de otras personas espera aprobación
  let id;
  if (key) {
    const { p, mine } = await getPackage(env, user, key);
    if (!mine) throw new HttpError(403, "No puedes editar este paquete.");
    id = p.id;
    await env.DB.prepare("UPDATE packages SET name=?, summary=?, description=?, version=?, platform=?, icon_file=?, file_id=?, external_url=?, status=?, review_note='', updated_at=? WHERE id=?")
      .bind(name, summary, description, version, platform, icon, file, external, status, now(), id).run();
    const old = (await env.DB.prepare("SELECT file_id FROM package_images WHERE package_id = ?").bind(id).all()).results.map((r) => r.file_id);
    await deleteFiles(env, [p.icon_file !== icon ? p.icon_file : "", p.file_id !== file ? p.file_id : "", ...old.filter((x) => !images.includes(x))]);
  } else {
    await rateLimit(env, "pkg:" + user.id, 20, 86400);
    let slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "paquete";
    if (/^\d+$/.test(slug)) slug = "p-" + slug;
    for (let n = 2; await env.DB.prepare("SELECT 1 FROM packages WHERE slug = ?").bind(slug).first(); n++) slug = slug.replace(/-\d+$/, "") + "-" + n;
    const res = await env.DB.prepare("INSERT INTO packages(slug, name, summary, description, version, platform, status, owner_id, icon_file, file_id, external_url, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(slug, name, summary, description, version, platform, status, user.id, icon, file, external, now(), now()).run();
    id = res.meta.last_row_id; await hit(env, "pkg:" + user.id);
  }
  await env.DB.batch([env.DB.prepare("DELETE FROM package_images WHERE package_id = ?").bind(id),
    ...images.map((f, i) => env.DB.prepare("INSERT INTO package_images(package_id, file_id, pos) VALUES(?,?,?)").bind(id, f, i))]);
  return json({ ok: true, id, status }, key ? 200 : 201);
}

async function deletePackage(env, user, key) {
  const { p, mine } = await getPackage(env, user, key);
  if (!mine) throw new HttpError(403, "No puedes borrar este paquete.");
  const imgs = (await env.DB.prepare("SELECT file_id FROM package_images WHERE package_id = ?").bind(p.id).all()).results.map((r) => r.file_id);
  await deleteFiles(env, [p.icon_file, p.file_id, ...imgs]);
  await env.DB.batch([env.DB.prepare("DELETE FROM package_images WHERE package_id = ?").bind(p.id), env.DB.prepare("DELETE FROM packages WHERE id = ?").bind(p.id)]);
  return json({ ok: true });
}

async function downloadPackage(env, user, key) {
  const { p } = await getPackage(env, user, key);
  if (!p.file_id && !p.external_url) throw new HttpError(404, "Este paquete no tiene archivo.");
  await env.DB.prepare("UPDATE packages SET downloads = downloads + 1 WHERE id = ?").bind(p.id).run();
  if (!p.file_id) return Response.redirect(p.external_url, 302);
  const file = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(p.file_id).first();
  if (!file) throw new HttpError(404, "Este paquete no tiene archivo.");
  const fname = file.name.replace(/["\\\r\n]/g, "_");
  return streamFile(env, file, { "content-disposition": `attachment; filename="${fname}"`, "cache-control": "no-store" });
}

// ------------------------------------------------------------------ licencias (las apps preguntan aquí)
async function licenseCheck(env, user, url) {
  const product = url.searchParams.get("product"), device = (url.searchParams.get("device") || "").toLowerCase();
  if (!PLANS[product]) throw new HttpError(400, "Producto desconocido.");
  if (!/^[a-f0-9]{64}$/.test(device)) throw new HttpError(400, "Dispositivo no válido.");
  const lic = await env.DB.prepare("SELECT * FROM licenses WHERE user_id = ? AND product = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1").bind(user.id, product, now()).first();
  if (!lic) return json({ active: false, reason: "sin_plan" });
  const known = await env.DB.prepare("SELECT 1 FROM devices WHERE license_id = ? AND device_hash = ?").bind(lic.id, device).first();
  if (known) await env.DB.prepare("UPDATE devices SET last_seen = ? WHERE license_id = ? AND device_hash = ?").bind(now(), lic.id, device).run();
  else {
    const used = (await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE license_id = ?").bind(lic.id).first()).n;
    if (used >= lic.devices) return json({ active: false, reason: "limite_dispositivos", devices: lic.devices });
    await env.DB.prepare("INSERT OR IGNORE INTO devices(license_id, device_hash, first_seen, last_seen) VALUES(?,?,?,?)").bind(lic.id, device, now(), now()).run();
  }
  return json({ active: true, product, plan: lic.plan, devices: lic.devices, expires: lic.expires_at, server_time: now() });
}

async function myLicenses(env, user) {
  const rows = await env.DB.prepare("SELECT l.*, (SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id) AS used FROM licenses l WHERE l.user_id = ? ORDER BY l.expires_at DESC").bind(user.id).all();
  return json({ licenses: rows.results.map((l) => ({ id: l.id, product: l.product, product_name: PLANS[l.product]?.name || l.product, plan: l.plan, plan_name: PLANS[l.product]?.plans[l.plan]?.[0] || l.plan, devices: l.devices, used: l.used, expires: l.expires_at, active: l.expires_at > now() })) });
}

// ------------------------------------------------------------------ datos del sitio (TikTok, editable desde Administrar)
async function getSite(env) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('tiktok_url','tiktok_text')").all();
  const out = { ...SITE_DEFAULTS };
  for (const r of rows.results) out[r.key] = r.value;
  out.store_open = await storeOpen(env);
  return out;
}
async function saveSite(request, env, user) {
  needPerm(user, "sitio.editar");
  const b = await request.json().catch(() => ({}));
  const url = clean(b.tiktok_url, 200), text = clean(b.tiktok_text, 60) || SITE_DEFAULTS.tiktok_text;
  if (url && !/^https:\/\/([a-z0-9-]+\.)?tiktok\.com\/[^\s]*$/i.test(url)) throw new HttpError(400, "El enlace debe ser de TikTok (https://www.tiktok.com/@tuusuario).");
  await env.DB.batch([env.DB.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('tiktok_url', ?)").bind(url),
    env.DB.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('tiktok_text', ?)").bind(text)]);
  return json({ ok: true, site: { tiktok_url: url, tiktok_text: text } });
}

// ------------------------------------------------------------------ cifrado en reposo (números de transferencia)
async function dataKey(env) {
  let secret = env.DATA_KEY;
  if (!secret) {          // sin secreto en Cloudflare, se crea una llave propia guardada aparte (ponla como secreto DATA_KEY cuando puedas)
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'data_key'").first();
    secret = r?.value;
    if (!secret) { secret = randomHex(32); await env.DB.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES('data_key', ?)").bind(secret).run(); secret = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'data_key'").first()).value; }
  }
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("zyh-data:" + secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function sealText(env, text) {
  if (!text) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await dataKey(env), new TextEncoder().encode(text)));
  return b64(iv) + "." + b64(ct);
}
async function openText(env, blob) {
  if (!blob) return "";
  try { const [iv, ct] = blob.split("."); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await dataKey(env), unb64(ct))); } catch { return ""; }
}

// ------------------------------------------------------------------ regalar días
async function giftDays(request, env, user, id) {
  if (!can(user, "dias.regalar") && !can(user, "planes.dar")) throw new HttpError(403, "No tienes permiso para esto.");
  const b = await request.json().catch(() => ({}));
  const days = Math.floor(Number(b.days));
  if (!(days >= 1 && days <= 365)) throw new HttpError(400, "Días a regalar: entre 1 y 365.");
  const target = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(Number(id)).first();
  if (!target) throw new HttpError(404, "Esa cuenta no existe.");
  if (target.id === user.id && user.id !== 1) throw new HttpError(400, "No puedes regalarte días a ti mismo.");
  const product = b.product ? String(b.product) : "";
  if (product && !PLANS[product]) throw new HttpError(400, "Producto desconocido.");
  const note = clean(b.note, 150) || "Regalo";
  let lics = (await env.DB.prepare(`SELECT id, product, plan, expires_at FROM licenses WHERE user_id = ? AND expires_at > ?${product ? " AND product = ?" : ""}`).bind(...[target.id, now(), ...(product ? [product] : [])]).all()).results;
  const stmts = [], addSec = days * 86400;
  if (lics.length) lics.forEach((l) => stmts.push(env.DB.prepare("UPDATE licenses SET expires_at = expires_at + ?, note = ? WHERE id = ?").bind(addSec, ("Regalo +" + days + " días: " + note).slice(0, 200), l.id)));
  else {
    if (!product) throw new HttpError(400, "Esta cuenta no tiene planes activos: elige el producto y el plan a regalar.");
    const plan = b.plan ? String(b.plan) : Object.keys(PLANS[product].plans)[0];
    if (!PLANS[product].plans[plan]) throw new HttpError(400, "Plan desconocido.");
    stmts.push(env.DB.prepare("INSERT INTO licenses(user_id, product, plan, devices, expires_at, note, created_at) VALUES(?,?,?,?,?,?,?)").bind(target.id, product, plan, PLANS[product].plans[plan][2], now() + addSec, ("Regalo: " + note).slice(0, 200), now()));
  }
  stmts.push(env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(target.id, user.id, `Regalo de ${days} días${product ? " en " + product : ""}: ${note}`, now()));
  await env.DB.batch(stmts);
  return json({ ok: true, extendidas: lics.length || 1 });
}

// ------------------------------------------------------------------ pagos / transferencias
const maskNum = (last4) => (last4 ? "••••" + last4 : "");
async function createPayment(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const product = String(b.product || ""), plan = String(b.plan || "");
  let amount;
  if (product === "tienda") {
    const app = await env.DB.prepare("SELECT price_cents FROM store_apps WHERE slug = ? AND status = 'publicada'").bind(plan).first();
    if (!app || app.price_cents <= 0) throw new HttpError(400, "Esa app no existe o es gratis.");
    if (await env.DB.prepare("SELECT 1 FROM store_purchases WHERE slug = ? AND user_id = ?").bind(plan, user.id).first()) throw new HttpError(409, "Ya compraste esta app.");
    amount = app.price_cents / 100;
  } else {
    if (!PLANS[product] || !PLANS[product].plans[plan]) throw new HttpError(400, "Elige el producto y el plan que pagaste.");
    amount = PLANS[product].plans[plan][1];
  }
  const reference = clean(b.reference, 60).toLowerCase();
  if (!/^[a-z0-9\-_.]{6,60}$/.test(reference)) throw new HttpError(400, "Pon el ID de la transacción de PayPal (6 a 60 letras o números).");
  const number = clean(b.payer_number, 30).replace(/[^\d+]/g, "");
  await rateLimit(env, "pay:" + user.id, 6, 86400);
  if (await env.DB.prepare("SELECT 1 FROM payments WHERE reference = ?").bind(reference).first()) throw new HttpError(409, "Ese ID de transacción ya fue enviado.");
  const extra = Math.max(0, Math.min(50, Math.floor(Number(b.extra_devices) || 0)));
  await env.DB.prepare("INSERT INTO payments(user_id, product, plan, extra, amount_usd, reference, number_enc, number_last4, created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(user.id, product, plan, extra, amount, reference, await sealText(env, number), number.slice(-4), now()).run();
  await hit(env, "pay:" + user.id);
  return json({ ok: true }, 201);
}
async function myPayments(env, user) {
  const rows = await env.DB.prepare("SELECT id, product, plan, extra, amount_usd, reference, status, note, created_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 50").bind(user.id).all();
  return json({ payments: rows.results.map((p) => ({ ...p, product_name: p.product === "tienda" ? "Tienda ZYHT32" : PLANS[p.product]?.name || p.product, plan_name: PLANS[p.product]?.plans[p.plan]?.[0] || p.plan })) });
}
async function adminPayments(env, user, url) {
  if (!can(user, "transferencias.ver") && !can(user, "planes.verificar")) throw new HttpError(403, "No tienes permiso para esto.");
  const status = url.searchParams.get("status");
  const where = ["pendiente", "correcta", "rechazada"].includes(status) ? "WHERE p.status = ?" : "";
  const q = `SELECT p.*, u.username FROM payments p JOIN users u ON u.id = p.user_id ${where} ORDER BY (p.status = 'pendiente') DESC, p.id DESC LIMIT 300`;
  const rows = await (where ? env.DB.prepare(q).bind(status) : env.DB.prepare(q)).all();
  const full = can(user, "transferencias.numero");
  const out = [];
  for (const p of rows.results) out.push({ id: p.id, user: p.username, code: code(p.user_id), product_name: p.product === "tienda" ? "Tienda ZYHT32" : PLANS[p.product]?.name || p.product, plan_name: PLANS[p.product]?.plans[p.plan]?.[0] || p.plan,
    extra: p.extra, amount_usd: p.amount_usd, reference: p.reference, status: p.status, note: p.note, created_at: p.created_at,
    number: full ? await openText(env, p.number_enc) : maskNum(p.number_last4) });
  return json({ payments: out, numero_completo: full });
}
async function reviewPayment(request, env, user, id) {
  needPerm(user, "planes.verificar");
  const b = await request.json().catch(() => ({}));
  const p = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(Number(id)).first();
  if (!p) throw new HttpError(404, "Ese pago no existe.");
  if (p.status !== "pendiente") throw new HttpError(409, "Ese pago ya fue revisado.");
  const note = clean(b.note, 200);
  if (b.action === "rechazada") {
    await env.DB.prepare("UPDATE payments SET status='rechazada', note=?, reviewed_by=?, reviewed_at=? WHERE id=?").bind(note || "No se encontró el pago.", user.id, now(), p.id).run();
    return json({ ok: true });
  }
  if (b.action !== "correcta") throw new HttpError(400, "Acción no válida.");
  if (p.product === "tienda") {
    const app = await env.DB.prepare("SELECT price_cents FROM store_apps WHERE slug = ?").bind(p.plan).first();
    if (!app) throw new HttpError(404, "La app ya no está en la tienda.");
    const cents = Math.round(p.amount_usd * 100), sp = split(cents);
    await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO store_purchases(slug, user_id, payment_id, price_cents, creator_cents, studio_cents, created_at) VALUES(?,?,?,?,?,?,?)").bind(p.plan, p.user_id, p.id, cents, sp.creator, sp.studio, now()),
      env.DB.prepare("UPDATE payments SET status='correcta', note=?, reviewed_by=?, reviewed_at=? WHERE id=?").bind(note, user.id, now(), p.id),
      env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(p.user_id, user.id, `Compra de tienda ${p.plan} verificada (${p.reference})`, now())]);
    return json({ ok: true });
  }
  const plan = PLANS[p.product].plans[p.plan], days = CYCLE_DAYS[PLANS[p.product].cycle] || 30;
  const lic = await env.DB.prepare("INSERT INTO licenses(user_id, product, plan, devices, expires_at, note, created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(p.user_id, p.product, p.plan, plan[2] + p.extra, now() + days * 86400, ("Pago verificado " + p.reference).slice(0, 200), now()).run();
  await env.DB.batch([env.DB.prepare("UPDATE payments SET status='correcta', note=?, reviewed_by=?, reviewed_at=?, license_id=? WHERE id=?").bind(note, user.id, now(), lic.meta.last_row_id, p.id),
    env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(p.user_id, user.id, `Pago ${p.reference} verificado: plan activado`, now())]);
  return json({ ok: true, license: lic.meta.last_row_id });
}

// ------------------------------------------------------------------ cuenta: apps conectadas y vínculo con Zyphora
async function mySessions(env, user) {
  const rows = await env.DB.prepare("SELECT token_hash, kind, label, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 50").bind(user.id, now()).all();
  return json({ sessions: rows.results.map((s) => ({ id: s.token_hash.slice(0, 16), kind: s.kind, label: s.label || (s.kind === "app" ? "App de ZYH" : "Navegador"), created_at: s.created_at, expires_at: s.expires_at, current: s.token_hash === user.token_hash })) });
}
async function revokeSessions(request, env, user, id) {
  if (id === "apps") { await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND kind = 'app'").bind(user.id).run(); return json({ ok: true }); }
  if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(400, "Sesión no válida.");
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash,1,16) = ? AND token_hash <> ?").bind(user.id, id, user.token_hash).run();
  return json({ ok: true });
}
async function getLinks(env, user) {
  const rows = await env.DB.prepare("SELECT provider, external, verified, created_at FROM links WHERE user_id = ?").bind(user.id).all();
  return json({ links: rows.results });
}
async function linkStart(env, user) {
  await rateLimit(env, "link:" + user.id, 10, 3600);
  const c = "ZYH-" + randomHex(3).toUpperCase();
  await env.DB.prepare("INSERT INTO links(user_id, provider, code_hash, code_exp, created_at) VALUES(?, 'zyphora', ?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET code_hash = excluded.code_hash, code_exp = excluded.code_exp")
    .bind(user.id, await sha256("link:" + c), now() + 600, now()).run();
  await hit(env, "link:" + user.id);
  return json({ code: c, expires_in: 600 });
}
async function linkSave(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const ext = clean(b.zyphora_id, 60);
  if (!/^[\w.@-]{3,60}$/.test(ext)) throw new HttpError(400, "Pon tu usuario o ID de Zyphora (3 a 60 caracteres).");
  await env.DB.prepare("INSERT INTO links(user_id, provider, external, verified, created_at) VALUES(?, 'zyphora', ?, 0, ?) ON CONFLICT(user_id, provider) DO UPDATE SET external = excluded.external, verified = 0")
    .bind(user.id, ext, now()).run();
  return json({ ok: true, verified: false });
}
async function linkRemove(env, user) { await env.DB.prepare("DELETE FROM links WHERE user_id = ? AND provider = 'zyphora'").bind(user.id).run(); return json({ ok: true }); }
// Zyphora llama aquí (con la clave compartida ZYPHORA_KEY) para confirmar que la cuenta de Zyphora es de quien generó el código.
async function linkConfirm(request, env) {
  if (!env.ZYPHORA_KEY) throw new HttpError(503, "La confirmación de Zyphora no está configurada (falta el secreto ZYPHORA_KEY).");
  if (!safeEqual(request.headers.get("x-zyphora-key") || "", env.ZYPHORA_KEY)) throw new HttpError(401, "Clave no válida.");
  const b = await request.json().catch(() => ({}));
  const c = clean(b.code, 20).toUpperCase(), ext = clean(b.zyphora_id, 60);
  if (!/^ZYH-[A-F0-9]{6}$/.test(c) || !/^[\w.@-]{3,60}$/.test(ext)) throw new HttpError(400, "Datos no válidos.");
  const r = await env.DB.prepare("SELECT user_id FROM links WHERE provider = 'zyphora' AND code_hash = ? AND code_exp > ?").bind(await sha256("link:" + c), now()).first();
  if (!r) throw new HttpError(404, "Código no válido o vencido.");
  await env.DB.prepare("UPDATE links SET external = ?, verified = 1, code_hash = '', code_exp = 0 WHERE user_id = ? AND provider = 'zyphora'").bind(ext, r.user_id).run();
  return json({ ok: true, zyh_code: code(r.user_id) });
}

// ------------------------------------------------------------------ prueba Lite (por equipo: crear otra cuenta no la reinicia)
async function trial(request, env, user, consume) {
  let b = {};
  if (request.method === "POST") b = await request.json().catch(() => ({}));
  const product = String(b.product || new URL(request.url).searchParams.get("product") || ""), cfg = TRIALS[product];
  const device = String(b.device || new URL(request.url).searchParams.get("device") || "").toLowerCase();
  if (!cfg) throw new HttpError(400, "Este producto no tiene prueba.");
  if (!/^[a-f0-9]{64}$/.test(device)) throw new HttpError(400, "Dispositivo no válido.");
  const t = await env.DB.prepare("SELECT * FROM trials WHERE product = ? AND device_hash = ?").bind(product, device).first();
  const other = await env.DB.prepare("SELECT 1 FROM trials WHERE product = ? AND user_id = ? AND device_hash <> ?").bind(product, user.id, device).first();
  const info = (row, uses) => ({ ok: true, level_max: cfg.level_max, uses_left: Math.max(0, cfg.uses - uses), days_left: Math.max(0, Math.ceil((row.started_at + cfg.days * 86400 - now()) / 86400)) });
  if (t && t.user_id !== user.id) return json({ ok: false, reason: "equipo_ya_uso", level_max: cfg.level_max, uses_left: 0, days_left: 0 });
  if (!t && other) return json({ ok: false, reason: "cuenta_ya_uso", level_max: cfg.level_max, uses_left: 0, days_left: 0 });
  if (!t) {
    if (!consume) return json({ ok: true, level_max: cfg.level_max, uses_left: cfg.uses, days_left: cfg.days, nuevo: true });
    await env.DB.prepare("INSERT OR IGNORE INTO trials(product, device_hash, user_id, started_at, uses) VALUES(?,?,?,?,1)").bind(product, device, user.id, now()).run();
    return json({ ok: true, level_max: cfg.level_max, uses_left: cfg.uses - 1, days_left: cfg.days });
  }
  const expired = now() > t.started_at + cfg.days * 86400, used = t.uses;
  if (expired || used >= cfg.uses) return json({ ok: false, reason: "prueba_terminada", level_max: cfg.level_max, uses_left: Math.max(0, cfg.uses - used), days_left: 0 });
  if (!consume) return json(info(t, used));
  await env.DB.prepare("UPDATE trials SET uses = uses + 1 WHERE product = ? AND device_hash = ? AND uses < ?").bind(product, device, cfg.uses).run();
  return json(info(t, used + 1));
}

// ------------------------------------------------------------------ tienda de apps para ZYHT32
// Reparto de cada venta: 35% ZYH Studios, 65% el creador. Por ahora solo el dueño puede publicar
// (ZYHT32 aún no sale a la venta); el dueño abre la tienda a creadores desde Administrar cuando quiera.
const STUDIO_SHARE = 0.35;
const STORE_SLUG = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const split = (cents) => { const studio = Math.round(cents * STUDIO_SHARE); return { studio, creator: cents - studio }; };
async function storeOpen(env) { const r = await env.DB.prepare("SELECT value FROM settings WHERE key='store_open'").first(); return r?.value === "1"; }
async function canPublish(env, user) { return !!user && (user.id === 1 || ((await storeOpen(env)) && can(user, "tienda.publicar"))); }

// Lee solo el índice de un .zip (nombres y tamaños) para comprobar que es una app de ZYHT32 antes de guardarla.
function zipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new HttpError(400, "El paquete no es un .zip válido.");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
  for (let k = 0; k < n; k++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new HttpError(400, "El .zip está dañado.");
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    out.push({ name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), size: dv.getUint32(p + 24, true) });
    p += 46 + nl + xl + cl;
  }
  return out;
}
function checkPack(b64, slug) {
  let u8;
  try { u8 = unb64(String(b64 || "").replace(/^data:[^,]*,/, "")); } catch { throw new HttpError(400, "El archivo no se pudo leer."); }
  if (u8.length < 100 || u8.length > 800_000) throw new HttpError(400, "El paquete debe pesar menos de 800 KB.");
  const ents = zipEntries(u8), base = `zyht32/apps/${slug}/`;
  if (ents.length > 40) throw new HttpError(400, "Demasiados archivos en el paquete (máximo 40).");
  let total = 0, hasMain = false;
  for (const x of ents) {
    if (x.name.endsWith("/")) continue;
    if (!x.name.startsWith(base) || x.name.includes("..") || x.name.includes("\\") || x.name.includes("//")) throw new HttpError(400, `El paquete solo puede tener archivos dentro de ${base} (encontré «${x.name.slice(0, 60)}»).`);
    if (!/\.(zyht32|txt|png|json)$/i.test(x.name)) throw new HttpError(400, "Solo se permiten archivos .zyht32, .txt, .png y .json dentro de la app.");
    total += x.size; if (x.name === base + "main.zyht32") hasMain = true;
  }
  if (!hasMain) throw new HttpError(400, `Falta ${base}main.zyht32 dentro del .zip.`);
  if (total > 3_000_000) throw new HttpError(400, "El contenido descomprimido es muy grande (máximo 3 MB).");
  return { b64: b64.replace(/^data:[^,]*,/, ""), size: u8.length };
}
const storeRow = (r, owned) => { const sp = split(r.price_cents); return { slug: r.slug, name: r.name, description: r.description, category: r.category, version: r.version, price_usd: r.price_cents / 100,
  paypal_id: r.paypal_id, author: r.author, author_code: code(r.author_id), size: r.pack_size, downloads: r.downloads, updated_at: r.updated_at, owned: !!owned || r.price_cents === 0,
  studio_usd: sp.studio / 100, creator_usd: sp.creator / 100 }; };

async function storeList(env, user, slug) {
  const q = `SELECT a.*, u.username AS author FROM store_apps a JOIN users u ON u.id = a.author_id WHERE a.status = 'publicada'${slug ? " AND a.slug = ?" : ""} ORDER BY a.updated_at DESC`;
  const rows = (await (slug ? env.DB.prepare(q).bind(slug) : env.DB.prepare(q)).all()).results;
  let mine = new Set();
  if (user) mine = new Set((await env.DB.prepare("SELECT slug FROM store_purchases WHERE user_id = ?").bind(user.id).all()).results.map((x) => x.slug));
  const pend = user ? new Set((await env.DB.prepare("SELECT plan FROM payments WHERE user_id = ? AND product = 'tienda' AND status = 'pendiente'").bind(user.id).all()).results.map((x) => x.plan)) : new Set();
  const apps = rows.map((r) => ({ ...storeRow(r, mine.has(r.slug) || (user && (user.id === r.author_id || user.id === 1))), pending: pend.has(r.slug) }));
  if (slug) { if (!apps.length) throw new HttpError(404, "Esa app no existe en la tienda."); return json({ app: apps[0] }); }
  return json({ apps, open: await storeOpen(env), can_publish: await canPublish(env, user) });
}
async function storePublish(request, env, user) {
  if (!(await canPublish(env, user))) throw new HttpError(403, "Por ahora solo ZYH Studios puede publicar apps: el ZYHT32 todavía no está en lanzamiento.");
  const b = await request.json().catch(() => ({}));
  const slug = clean(b.slug, 40).toLowerCase();
  if (!STORE_SLUG.test(slug)) throw new HttpError(400, "El nombre corto (slug) usa 2 a 40 letras minúsculas, números, guion o guion bajo.");
  const name = clean(b.name, 60), description = clean(b.description, 1500), category = clean(b.category, 30) || "Otras";
  if (name.length < 2) throw new HttpError(400, "Escribe el nombre de la app.");
  const price = Math.round(Number(b.price_usd || 0) * 100);
  if (!(price === 0 || (price >= 99 && price <= 9900))) throw new HttpError(400, "El precio es 0 (gratis) o entre US$0.99 y US$99.");
  const paypal = clean(b.paypal_id, 30).toUpperCase();
  if (paypal && !/^[A-Z0-9]{8,30}$/.test(paypal)) throw new HttpError(400, "El ID del botón de PayPal no es válido.");
  const version = clean(b.version, 12) || "1.0";
  const old = await env.DB.prepare("SELECT author_id, pack FROM store_apps WHERE slug = ?").bind(slug).first();
  if (old && old.author_id !== user.id && user.id !== 1) throw new HttpError(403, "Esa app es de otro creador.");
  let pack = old?.pack || "", size = old ? (await env.DB.prepare("SELECT pack_size FROM store_apps WHERE slug = ?").bind(slug).first()).pack_size : 0;
  if (b.pack) { const k = checkPack(b.pack, slug); pack = k.b64; size = k.size; }
  if (!pack) throw new HttpError(400, "Sube el paquete .zip de la app (zyht32/apps/" + slug + "/main.zyht32 …).");
  await env.DB.prepare(`INSERT INTO store_apps(slug, name, description, category, price_cents, version, author_id, paypal_id, pack, pack_size, downloads, status, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,0,'publicada',?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description, category=excluded.category, price_cents=excluded.price_cents,
    version=excluded.version, paypal_id=excluded.paypal_id, pack=excluded.pack, pack_size=excluded.pack_size, status='publicada', updated_at=excluded.updated_at`)
    .bind(slug, name, description, category, price, version, user.id, paypal, pack, size, now(), now()).run();
  return json({ ok: true, slug }, old ? 200 : 201);
}
async function storeRemove(env, user, slug) {
  const a = await env.DB.prepare("SELECT author_id FROM store_apps WHERE slug = ?").bind(slug).first();
  if (!a) throw new HttpError(404, "Esa app no existe.");
  if (a.author_id !== user.id && user.id !== 1) throw new HttpError(403, "Esa app es de otro creador.");
  if (await env.DB.prepare("SELECT 1 FROM store_purchases WHERE slug = ?").bind(slug).first()) await env.DB.prepare("UPDATE store_apps SET status='retirada', updated_at=? WHERE slug=?").bind(now(), slug).run();
  else await env.DB.prepare("DELETE FROM store_apps WHERE slug = ?").bind(slug).run();
  return json({ ok: true });
}
async function storeDownload(env, user, slug) {
  needUser(user);
  const a = await env.DB.prepare("SELECT * FROM store_apps WHERE slug = ? AND status = 'publicada'").bind(slug).first();
  if (!a) throw new HttpError(404, "Esa app no existe.");
  const own = user.id === 1 || user.id === a.author_id || a.price_cents === 0 || !!(await env.DB.prepare("SELECT 1 FROM store_purchases WHERE slug = ? AND user_id = ?").bind(slug, user.id).first());
  if (!own) throw new HttpError(403, "Compra esta app para descargarla.");
  await env.DB.prepare("UPDATE store_apps SET downloads = downloads + 1 WHERE slug = ?").bind(slug).run();
  return new Response(unb64(a.pack), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slug}_${a.version}.zip"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
// Ganancias: cada creador ve las suyas; quien tenga «transferencias.ver» (o el dueño) ve todas.
async function storeEarnings(env, user) {
  const all = user.id === 1 || can(user, "transferencias.ver");
  const q = `SELECT a.slug, a.name, u.username AS author, a.author_id, COUNT(p.id) AS sales, COALESCE(SUM(p.price_cents),0) AS gross, COALESCE(SUM(p.creator_cents),0) AS creator, COALESCE(SUM(p.studio_cents),0) AS studio
    FROM store_apps a JOIN users u ON u.id = a.author_id LEFT JOIN store_purchases p ON p.slug = a.slug ${all ? "" : "WHERE a.author_id = ?"} GROUP BY a.slug ORDER BY gross DESC`;
  const rows = (await (all ? env.DB.prepare(q) : env.DB.prepare(q).bind(user.id)).all()).results;
  const apps = rows.map((r) => ({ slug: r.slug, name: r.name, author: r.author, sales: r.sales, gross_usd: r.gross / 100, creator_usd: r.creator / 100, studio_usd: r.studio / 100 }));
  const sum = (k) => apps.reduce((s, x) => s + x[k], 0);
  return json({ all, apps, totals: { sales: sum("sales"), gross_usd: sum("gross_usd"), creator_usd: sum("creator_usd"), studio_usd: sum("studio_usd") }, share: { studio: STUDIO_SHARE, creator: 1 - STUDIO_SHARE } });
}
async function storeSetOpen(request, env, user) {
  if (user.id !== 1) throw new HttpError(403, "Solo el dueño abre o cierra la tienda a otros creadores.");
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('store_open', ?)").bind(b.open ? "1" : "0").run();
  return json({ ok: true, open: !!b.open });
}

// ------------------------------------------------------------------ administración
async function admin(request, env, user, parts, url) {
  needUser(user);
  const [section, id, action] = parts, m = request.method;
  if (section === "users" && !id && m === "GET") {
    needPerm(user, "cuentas.ver");
    // Búsqueda por ID (exacta o aproximada: 0000001, 1, 000…) o por nombre de usuario.
    const q = clean(url.searchParams.get("q"), 40).toLowerCase();
    const base = "SELECT u.id, u.username, u.email, u.role, u.disabled, u.created_at, (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id AND l.expires_at > ?) AS planes_activos, (SELECT COUNT(*) FROM user_reports r WHERE r.user_id = u.id) AS reportes FROM users u";
    let rows;
    if (!q) rows = await env.DB.prepare(base + " ORDER BY u.id LIMIT 100").bind(now()).all();
    else rows = await env.DB.prepare(base + " WHERE printf('%07d', u.id) LIKE ? OR lower(u.username) LIKE ? ORDER BY (printf('%07d', u.id) = ? OR CAST(u.id AS TEXT) = ?) DESC, u.id LIMIT 100")
      .bind(now(), `%${q.replace(/[%_]/g, "")}%`, `%${q.replace(/[%_]/g, "")}%`, q.padStart(7, "0"), q).all();
    return json({ users: rows.results.map((u) => ({ ...u, code: code(u.id) })) });
  }
  if (section === "users" && id && !action && m === "GET") {
    needPerm(user, "cuentas.ver");
    const u = await env.DB.prepare("SELECT id, username, email, role, disabled, created_at FROM users WHERE id = ?").bind(Number(id)).first();
    if (!u) throw new HttpError(404, "Esa cuenta no existe.");
    const lic = await env.DB.prepare("SELECT l.*, (SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id) AS used FROM licenses l WHERE l.user_id = ? ORDER BY l.expires_at DESC").bind(u.id).all();
    const rep = await env.DB.prepare("SELECT r.id, r.reason, r.created_at, (SELECT username FROM users WHERE id = r.by_id) AS by_name FROM user_reports r WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50").bind(u.id).all();
    return json({ user: { ...u, code: code(u.id) },
      licenses: lic.results.map((l) => ({ id: l.id, product: l.product, product_name: PLANS[l.product]?.name || l.product, plan: l.plan, plan_name: PLANS[l.product]?.plans[l.plan]?.[0] || l.plan, devices: l.devices, used: l.used, expires: l.expires_at, note: l.note, active: l.expires_at > now() })),
      reports: rep.results });
  }
  if (section === "users" && id && action === "report" && m === "POST") {
    needPerm(user, "usuarios.reportar");
    const body = await request.json().catch(() => ({}));
    const reason = clean(body.reason, 300);
    if (reason.length < 3) throw new HttpError(400, "Escribe el motivo del reporte.");
    if (!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(Number(id)).first())) throw new HttpError(404, "Esa cuenta no existe.");
    await env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(Number(id), user.id, reason, now()).run();
    return json({ ok: true }, 201);
  }
  if (section === "reports" && id && m === "DELETE") {
    needPerm(user, "usuarios.reportar");
    await env.DB.prepare("DELETE FROM user_reports WHERE id = ?").bind(Number(id)).run(); return json({ ok: true });
  }
  if (section === "users" && id && !action && m === "POST") {
    const body = await request.json().catch(() => ({}));
    if (Number(id) === user.id) throw new HttpError(400, "No puedes cambiar tu propia cuenta desde aquí.");
    if (Number(id) === 1) throw new HttpError(400, "La cuenta del dueño no se puede cambiar.");
    const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(Number(id)).first();
    if (!target) throw new HttpError(404, "Esa cuenta no existe.");
    // Solo quien gestiona roles puede tocar a otros miembros del equipo.
    if (target.role !== "user" && !can(user, "roles.gestionar")) throw new HttpError(403, "No puedes cambiar a otro miembro del equipo.");
    if (body.role !== undefined) {
      needPerm(user, "roles.gestionar");
      const key = String(body.role);
      if (key !== "user" && key !== "admin" && !(await env.DB.prepare("SELECT 1 FROM roles WHERE key = ?").bind(key).first())) throw new HttpError(400, "Ese rol no existe.");
      await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(key, Number(id)).run();
      await env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(Number(id), user.id, "Rol cambiado a: " + key, now()).run();
    }
    if (body.disabled !== undefined) {
      needPerm(user, "usuarios.banear");
      await env.DB.batch([env.DB.prepare("UPDATE users SET disabled = ? WHERE id = ?").bind(body.disabled ? 1 : 0, Number(id)), env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(Number(id))]);
      const why = clean(body.reason, 280);
      await env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(Number(id), user.id, (body.disabled ? "Baneo" : "Desbaneo") + (why ? ": " + why : ""), now()).run();
    }
    return json({ ok: true });
  }
  if (section === "users" && id && action === "gift" && m === "POST") return giftDays(request, env, user, id);
  if (section === "site" && m === "PUT") return saveSite(request, env, user);
  if (section === "payments" && !id && m === "GET") return adminPayments(env, user, url);
  if (section === "payments" && id && action === "review" && m === "POST") return reviewPayment(request, env, user, id);
  // --- roles del equipo
  if (section === "roles" && !id && m === "GET") {
    needPerm(user, "cuentas.ver");
    const rows = await env.DB.prepare("SELECT r.key, r.name, r.perms, (SELECT COUNT(*) FROM users u WHERE u.role = r.key) AS miembros FROM roles r ORDER BY r.created_at").all();
    const cnt = async (k) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = ?").bind(k).first()).n;
    const custom = rows.results.map((r) => ({ key: r.key, name: r.name, perms: JSON.parse(r.perms || "[]"), miembros: r.miembros, custom: true }));
    return json({ perms: PERMS, roles: [
      { key: "user", name: "Cuenta normal", perms: [], miembros: await cnt("user"), custom: false },
      { key: "admin", name: "Administrador", perms: OWNER_PERMS.filter((p) => p !== "roles.gestionar"), miembros: await cnt("admin"), custom: false },
      ...custom] });
  }
  if (section === "roles" && !id && m === "POST") {
    needPerm(user, "roles.gestionar");
    const body = await request.json().catch(() => ({}));
    const name = clean(body.name, 40);
    const key = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    if (key.length < 2) throw new HttpError(400, "Ponle un nombre al rol.");
    if (RESERVED_ROLES.includes(key)) throw new HttpError(400, "Ese nombre está reservado.");
    const perms = [...new Set((Array.isArray(body.perms) ? body.perms : []).filter((p) => ALL_PERMS.includes(p)))];
    if (await env.DB.prepare("SELECT 1 FROM roles WHERE key = ?").bind(key).first()) throw new HttpError(409, "Ya existe un rol con ese nombre.");
    await env.DB.prepare("INSERT INTO roles(key, name, perms, created_at) VALUES(?,?,?,?)").bind(key, name, JSON.stringify(perms), now()).run();
    return json({ ok: true, key }, 201);
  }
  if (section === "roles" && id && m === "PUT") {
    needPerm(user, "roles.gestionar");
    const body = await request.json().catch(() => ({}));
    if (!(await env.DB.prepare("SELECT 1 FROM roles WHERE key = ?").bind(id).first())) throw new HttpError(404, "Ese rol no existe.");
    const perms = [...new Set((Array.isArray(body.perms) ? body.perms : []).filter((p) => ALL_PERMS.includes(p)))];
    const name = clean(body.name, 40);
    await env.DB.prepare("UPDATE roles SET perms = ?, name = COALESCE(NULLIF(?, ''), name) WHERE key = ?").bind(JSON.stringify(perms), name, id).run();
    return json({ ok: true });
  }
  if (section === "roles" && id && m === "DELETE") {
    needPerm(user, "roles.gestionar");
    await env.DB.batch([env.DB.prepare("UPDATE users SET role = 'user' WHERE role = ?").bind(id), env.DB.prepare("DELETE FROM roles WHERE key = ?").bind(id)]);
    return json({ ok: true });
  }
  if (section === "licenses" && m === "GET") {
    if (!can(user, "cuentas.ver") && !can(user, "planes.verificar")) throw new HttpError(403, "No tienes permiso para esto.");
    const rows = await env.DB.prepare("SELECT l.*, u.username, (SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id) AS used FROM licenses l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 500").all();
    return json({ licenses: rows.results.map((l) => ({ id: l.id, username: l.username, product: l.product, plan: l.plan, plan_name: PLANS[l.product]?.plans[l.plan]?.[0] || l.plan, devices: l.devices, used: l.used, expires: l.expires_at, note: l.note, active: l.expires_at > now() })) });
  }
  if (section === "licenses" && !id && m === "POST") {
    needPerm(user, "planes.dar");
    const body = await request.json().catch(() => ({}));
    const username = clean(body.username, 40).toLowerCase(), product = body.product, plan = body.plan;
    const days = Math.floor(Number(body.days)), extra = Math.max(0, Math.floor(Number(body.extra_devices) || 0));
    if (!PLANS[product] || !PLANS[product].plans[plan]) throw new HttpError(400, "Producto o plan desconocido.");
    if (!(days >= 1 && days <= 3660)) throw new HttpError(400, "Días: entre 1 y 3660.");
    const u = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
    if (!u) throw new HttpError(404, "Ese usuario no existe.");
    const res = await env.DB.prepare("INSERT INTO licenses(user_id, product, plan, devices, expires_at, note, created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(u.id, product, plan, PLANS[product].plans[plan][2] + extra, now() + days * 86400, clean(body.note, 200), now()).run();
    return json({ ok: true, id: res.meta.last_row_id }, 201);
  }
  if (section === "licenses" && id && action === "reset" && m === "POST") {
    needPerm(user, "planes.dar");
    await env.DB.prepare("DELETE FROM devices WHERE license_id = ?").bind(Number(id)).run(); return json({ ok: true });
  }
  if (section === "licenses" && id && m === "DELETE") {
    needPerm(user, "planes.dar");
    await env.DB.batch([env.DB.prepare("DELETE FROM devices WHERE license_id = ?").bind(Number(id)), env.DB.prepare("DELETE FROM licenses WHERE id = ?").bind(Number(id))]);
    return json({ ok: true });
  }
  if (section === "packages" && id && action === "status" && m === "POST") {
    needPerm(user, "paquetes.revisar");
    const body = await request.json().catch(() => ({}));
    if (!["publicado", "pendiente", "rechazado"].includes(body.status)) throw new HttpError(400, "Estado no válido.");
    await env.DB.prepare("UPDATE packages SET status = ?, review_note = ?, updated_at = ? WHERE id = ?").bind(body.status, clean(body.note, 300), now(), Number(id)).run();
    return json({ ok: true });
  }
  throw new HttpError(404, "No existe.");
}

// ------------------------------------------------------------------ rutas
async function api(request, env, url) {
  await ensureSchema(env);
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean), m = request.method;
  const [a, b, c] = parts;
  if (a === "health") return json({ ok: true, name: "ZYH Web", time: now() });
  if (a === "config") return json({ plans: PLANS, platforms: PLATFORMS, limits: LIMITS, min_password: 8, trials: TRIALS });
  if (a === "site" && m === "GET") return json({ site: await getSite(env) });
  if (a === "link" && b === "zyphora" && c === "confirm" && m === "POST") return linkConfirm(request, env);
  if (a === "register" && m === "POST") return register(request, env);
  if (a === "login" && m === "POST") return login(request, env);
  const user = await currentUser(request, env);
  if (a === "logout" && m === "POST") {
    if (user) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.token_hash).run();
    return json({ ok: true }, 200, { "set-cookie": "zyh_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
  }
  if (a === "me" && m === "GET") return json({ user: user ? { username: user.username, email: user.email, role: user.role, perms: user.perms, code: code(user.id), owner: user.id === 1 } : null });
  if (a === "password" && m === "POST") return changePassword(request, env, needUser(user));
  if (a === "upload" && m === "POST") return upload(request, env, needUser(user), url);
  if (a === "files" && b && m === "GET") return serveImage(env, user, b);
  if (a === "packages") {
    if (!b && m === "GET") return listPackages(env, user, url);
    if (!b && m === "POST") return savePackage(request, env, needUser(user), null);
    if (b && c === "download" && m === "GET") return downloadPackage(env, user, b);
    if (b && !c && m === "GET") return packageDetail(env, user, b);
    if (b && !c && m === "PUT") return savePackage(request, env, needUser(user), b);
    if (b && !c && m === "DELETE") return deletePackage(env, needUser(user), b);
  }
  if (a === "store") {
    if (b === "apps" && !c && m === "GET") return storeList(env, user, null);
    if (b === "apps" && c && m === "GET") return storeList(env, user, c);
    if (b === "apps" && !c && m === "POST") return storePublish(request, env, needUser(user));
    if (b === "apps" && c && m === "DELETE") return storeRemove(env, needUser(user), c);
    if (b === "download" && c && m === "GET") return storeDownload(env, user, c);
    if (b === "earnings" && m === "GET") return storeEarnings(env, needUser(user));
    if (b === "open" && m === "PUT") return storeSetOpen(request, env, needUser(user));
  }
  if (a === "payments" && !b && m === "POST") return createPayment(request, env, needUser(user));
  if (a === "payments" && !b && m === "GET") return myPayments(env, needUser(user));
  if (a === "trial" && !b && m === "GET") return trial(request, env, needUser(user), false);
  if (a === "trial" && !b && m === "POST") return trial(request, env, needUser(user), true);
  if (a === "account") {
    needUser(user);
    if (b === "sessions" && !c && m === "GET") return mySessions(env, user);
    if (b === "sessions" && c && m === "DELETE") return revokeSessions(request, env, user, c);
    if (b === "links" && m === "GET") return getLinks(env, user);
    if (b === "link-zyphora" && !c && m === "POST") return linkSave(request, env, user);
    if (b === "link-zyphora" && c === "code" && m === "POST") return linkStart(env, user);
    if (b === "link-zyphora" && !c && m === "DELETE") return linkRemove(env, user);
  }
  if (a === "license" && m === "GET") return licenseCheck(env, needUser(user), url);
  if (a === "licenses" && m === "GET") return myLicenses(env, needUser(user));
  if (a === "admin") return admin(request, env, user, parts.slice(1), url);
  throw new HttpError(404, "No existe.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: "Error interno del servidor." }, 500);
      }
    }
    return env.ASSETS.fetch(request);     // la web (archivos de /public)
  },
};
