// ZYH Web — servidor (Cloudflare Workers + D1). ZYH Studios.
import PRODUCT_PLANS from "./planes.json";
import UPDATES from "./update.json";
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
  "cuentas.restablecer": "Restablecer la contraseña de una cuenta (recuperación)",
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
  `CREATE TABLE IF NOT EXISTS zy_profile(user_id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', descr TEXT NOT NULL DEFAULT '', theme INTEGER NOT NULL DEFAULT 0, fondo INTEGER NOT NULL DEFAULT 0, wall INTEGER NOT NULL DEFAULT 0, fimg TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS zy_contacts(user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, contact_id))`,
  `CREATE TABLE IF NOT EXISTS zy_members(grp TEXT NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(grp, user_id))`,
  `CREATE TABLE IF NOT EXISTS zy_msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL DEFAULT 0, grp TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_zy_msgs_u ON zy_msgs(kind, to_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_zy_msgs_g ON zy_msgs(kind, grp, id)`,
  `CREATE TABLE IF NOT EXISTS zy_voice(id TEXT PRIMARY KEY, msg_id INTEGER NOT NULL, dur INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_zy_voice_msg ON zy_voice(msg_id)`,
  `CREATE TABLE IF NOT EXISTS zy_read(user_id INTEGER NOT NULL, chat TEXT NOT NULL, last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, chat))`,
  `CREATE TABLE IF NOT EXISTS support_used(k TEXT PRIMARY KEY, ts INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS user_2fa(user_id INTEGER PRIMARY KEY, secret TEXT NOT NULL, codes TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS recovery_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT NOT NULL, email_given TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', new_salt TEXT NOT NULL, new_hash TEXT NOT NULL, ticket_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', answer TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pw_resets(user_id INTEGER PRIMARY KEY, by_id INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS zr_box(seq INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, mid TEXT NOT NULL, user_id INTEGER NOT NULL, blob TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(room, mid))`,
  `CREATE INDEX IF NOT EXISTS zr_box_room ON zr_box(room, seq)`,
  `CREATE TABLE IF NOT EXISTS zr_news(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT 'all', at INTEGER NOT NULL, ttl INTEGER NOT NULL, author_id INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS zr_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product TEXT NOT NULL, text TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS zr_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product TEXT NOT NULL, stars INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS zy_pair(code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, exp INTEGER NOT NULL)`,
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
  // verificación en dos pasos: la contraseña ya está bien; ahora el código de la app autenticadora (o uno de respaldo)
  const tf = await env.DB.prepare("SELECT secret, codes, last_step FROM user_2fa WHERE user_id = ? AND enabled = 1").bind(u.id).first();
  if (tf) {
    const codeIn = String(body.code || "").replace(/[\s-]/g, "");
    if (!codeIn) return json({ ok: false, need_2fa: true, error: "Esta cuenta tiene verificación en dos pasos: escribe el código de 6 dígitos de tu app autenticadora (o un código de respaldo)." }, 401);
    await rateLimit(env, "2fa:" + u.id, 6, 900);
    if (!(await check2fa(env, u.id, tf, codeIn))) { await hit(env, "2fa:" + u.id); return json({ ok: false, need_2fa: true, error: "Código de verificación incorrecto." }, 401); }
  }
  const kind = body.client === "app" ? "app" : "web";
  const s = await newSession(env, u.id, kind, body.label);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run();
  const mustChange = !!(await env.DB.prepare("SELECT 1 FROM pw_resets WHERE user_id = ?").bind(u.id).first());
  return json({ ok: true, token: kind === "app" ? s.token : undefined, must_change: mustChange, user: { username: u.username, role: u.role, must_change: mustChange } }, 200,
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
    env.DB.prepare("DELETE FROM pw_resets WHERE user_id = ?").bind(user.id),   // ya no es la contraseña temporal
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


// ------------------------------------------------------------------ Zyphora (chats entre la web y el ZYHT32, con la Cuenta ZYH)
// Claves de chat: "*" = sala general · "@usuario" = privado · "#grupo" = grupo. Los mensajes se guardan cifrados (AES-GCM).
const ZY_MAX = 500, ZY_THEMES = 8;
const zyName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
const zyOpen = async (env, blob) => openText(env, blob);

async function zyUserByName(env, name) {
  const n = zyName(String(name || "").replace(/^@/, ""));
  if (!n) return null;
  return env.DB.prepare("SELECT id, username FROM users WHERE username = ? AND disabled = 0").bind(n).first();
}
async function zyNames(env, ids) {
  ids = [...new Set(ids)].filter((x) => x > 0);
  const out = {};
  if (!ids.length) return out;
  const q = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT u.id, u.username, COALESCE(p.name, '') AS name FROM users u LEFT JOIN zy_profile p ON p.user_id = u.id WHERE u.id IN (${q})`).bind(...ids).all();
  for (const r of rows.results) out[r.id] = { username: r.username, name: r.name || r.username };
  return out;
}
async function zyChatMeta(env, user, key) {   // valida la clave de chat y dice cómo filtrar
  if (key === "*") return { kind: "s", where: "kind = 's'", args: [] };
  if (key && !/^[@#]/.test(key)) {        // el ZYHT32 manda el nombre pelado: usuario si existe, si no grupo
    const o = await zyUserByName(env, key);
    key = (o && o.id !== user.id ? "@" : "#") + key;
  }
  if (key.startsWith("@")) {
    const o = await zyUserByName(env, key);
    if (!o || o.id === user.id) throw new HttpError(404, "Ese usuario no existe.");
    return { kind: "u", other: o, where: "kind = 'u' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))", args: [user.id, o.id, o.id, user.id], key: "@" + o.username };
  }
  if (key.startsWith("#")) {
    const g = zyName(key.slice(1));
    if (!g) throw new HttpError(400, "Nombre de grupo no válido.");
    if (!(await env.DB.prepare("SELECT 1 FROM zy_members WHERE grp = ? AND user_id = ?").bind(g, user.id).first())) throw new HttpError(403, "No estás en ese grupo.");
    return { kind: "g", grp: g, where: "kind = 'g' AND grp = ?", args: [g], key: "#" + g };
  }
  throw new HttpError(400, "Chat no válido.");
}
async function zyVoiceMap(env, ids) {
  const map = {};
  if (!ids.length) return map;
  const rows = await env.DB.prepare(`SELECT msg_id, id, dur, (data <> '') AS ok FROM zy_voice WHERE msg_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  for (const r of rows.results) map[r.msg_id] = { id: r.id, dur: r.dur, ok: !!r.ok };
  return map;
}
async function zyMsgOut(env, user, rows) {
  const [names, vm] = await Promise.all([zyNames(env, rows.map((r) => r.from_id)), zyVoiceMap(env, rows.map((r) => r.id))]);
  const out = [];
  for (const r of rows) { const v = vm[r.id]; out.push({ id: r.id, from: names[r.from_id]?.username || "?", name: names[r.from_id]?.name || "?", mine: r.from_id === user.id, text: await zyOpen(env, r.body), at: r.created_at, ...(v ? { voice: v.id, dur: v.dur, expired: !v.ok } : {}) }); }
  return out;
}

async function zyMe(env, user) {
  const prof = (await env.DB.prepare("SELECT name, descr, theme, fondo, wall, (fimg <> '') AS has_img FROM zy_profile WHERE user_id = ?").bind(user.id).first()) || { name: "", descr: "", theme: 0, fondo: 0, wall: 0, has_img: 0 };
  const [cons, grps, dms, reads] = await Promise.all([
    env.DB.prepare("SELECT contact_id AS id FROM zy_contacts WHERE user_id = ?").bind(user.id).all(),
    env.DB.prepare("SELECT grp FROM zy_members WHERE user_id = ? ORDER BY grp").bind(user.id).all(),
    env.DB.prepare("SELECT DISTINCT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS id FROM zy_msgs WHERE kind = 'u' AND (from_id = ? OR to_id = ?) LIMIT 40").bind(user.id, user.id, user.id).all(),
    env.DB.prepare("SELECT chat, last_id FROM zy_read WHERE user_id = ?").bind(user.id).all(),
  ]);
  const lr = Object.fromEntries(reads.results.map((r) => [r.chat, r.last_id]));
  const ids = [...new Set([...cons.results.map((r) => r.id), ...dms.results.map((r) => r.id)])].slice(0, 40);
  const names = await zyNames(env, ids);
  const chats = [{ key: "*", title: "Sala general", type: "s" }];
  for (const id of ids) if (names[id]) chats.push({ key: "@" + names[id].username, title: names[id].name, handle: "@" + names[id].username, type: "u", uid: id });
  for (const g of grps.results) chats.push({ key: "#" + g.grp, title: g.grp, type: "g" });
  const stmts = [];
  for (const c of chats) {
    const since = lr[c.key] || 0;
    if (c.type === "s") { stmts.push(env.DB.prepare("SELECT id, from_id, body, created_at FROM zy_msgs WHERE kind = 's' ORDER BY id DESC LIMIT 1"), env.DB.prepare("SELECT COUNT(*) AS n FROM zy_msgs WHERE kind = 's' AND from_id <> ? AND id > ?").bind(user.id, since)); }
    else if (c.type === "u") { stmts.push(env.DB.prepare("SELECT id, from_id, body, created_at FROM zy_msgs WHERE kind = 'u' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) ORDER BY id DESC LIMIT 1").bind(user.id, c.uid, c.uid, user.id), env.DB.prepare("SELECT COUNT(*) AS n FROM zy_msgs WHERE kind = 'u' AND from_id = ? AND to_id = ? AND id > ?").bind(c.uid, user.id, since)); }
    else { const g = c.key.slice(1); stmts.push(env.DB.prepare("SELECT id, from_id, body, created_at FROM zy_msgs WHERE kind = 'g' AND grp = ? ORDER BY id DESC LIMIT 1").bind(g), env.DB.prepare("SELECT COUNT(*) AS n FROM zy_msgs WHERE kind = 'g' AND grp = ? AND from_id <> ? AND id > ?").bind(g, user.id, since)); }
  }
  const res = await env.DB.batch(stmts);
  let total = 0;
  for (let i = 0; i < chats.length; i++) {
    const last = res[i * 2].results[0], n = res[i * 2 + 1].results[0].n;
    chats[i].unread = n; total += n;
    chats[i].last = last ? { text: (await zyOpen(env, last.body)).slice(0, 60), at: last.created_at, mine: last.from_id === user.id } : null;
    delete chats[i].uid;
  }
  chats.sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0) || a.key.localeCompare(b.key));
  const sala = chats.findIndex((c) => c.key === "*"); if (sala > 0 && !chats[sala].last) { const [x] = chats.splice(sala, 1); chats.unshift(x); }
  return json({ me: { username: user.username, name: prof.name || user.username, descr: prof.descr, theme: prof.theme, fondo: prof.fondo, wall: prof.wall, has_img: !!prof.has_img, code: code(user.id) },
    chats, contacts: ids.filter((i) => names[i]).map((i) => ({ username: names[i].username, name: names[i].name })), unread: total });
}
async function zyProfile(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const name = clean(b.name, 24), descr = clean(b.descr, 60);
  const theme = Math.max(0, Math.min(ZY_THEMES - 1, Math.floor(Number(b.theme) || 0)));
  const fondo = Math.max(0, Math.min(8, Math.floor(Number(b.fondo) || 0))), wall = Math.max(0, Math.min(5, Math.floor(Number(b.wall) || 0)));
  const old = await env.DB.prepare("SELECT fimg FROM zy_profile WHERE user_id = ?").bind(user.id).first();
  let fimg = old?.fimg || "";                                   // fondo propio (imagen pequeña, se guarda cifrada)
  if (b.img === null || b.img === "") fimg = "";
  else if (typeof b.img === "string") {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.img) || b.img.length > 160000) throw new HttpError(400, "Imagen de fondo no válida (PNG o JPG, máx. ~110 KB).");
    fimg = await sealText(env, b.img);
  }
  await env.DB.prepare("INSERT INTO zy_profile(user_id, name, descr, theme, fondo, wall, fimg, updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, descr = excluded.descr, theme = excluded.theme, fondo = excluded.fondo, wall = excluded.wall, fimg = excluded.fimg, updated_at = excluded.updated_at")
    .bind(user.id, name, descr, theme, fondo, wall, fimg, now()).run();
  return json({ ok: true });
}
async function zyWallpaper(env, user) {
  const r = await env.DB.prepare("SELECT fimg FROM zy_profile WHERE user_id = ?").bind(user.id).first();
  return json({ img: r?.fimg ? await openText(env, r.fimg) : "" });
}
async function zyAddContact(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const o = await zyUserByName(env, b.username);
  if (!o) throw new HttpError(404, "No existe ningún usuario con ese nombre.");
  if (o.id === user.id) throw new HttpError(400, "Ese eres tú.");
  await env.DB.prepare("INSERT OR IGNORE INTO zy_contacts(user_id, contact_id, created_at) VALUES(?,?,?)").bind(user.id, o.id, now()).run();
  return json({ ok: true, key: "@" + o.username }, 201);
}
async function zyDelContact(env, user, name) {
  const o = await zyUserByName(env, name);
  if (o) await env.DB.prepare("DELETE FROM zy_contacts WHERE user_id = ? AND contact_id = ?").bind(user.id, o.id).run();
  return json({ ok: true });
}
async function zyJoinGroup(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const g = zyName(b.name);
  if (g.length < 2) throw new HttpError(400, "El grupo necesita al menos 2 letras o números (sin espacios).");
  await env.DB.prepare("INSERT OR IGNORE INTO zy_members(grp, user_id, created_at) VALUES(?,?,?)").bind(g, user.id, now()).run();
  return json({ ok: true, key: "#" + g }, 201);
}
async function zyLeaveGroup(env, user, name) {
  await env.DB.prepare("DELETE FROM zy_members WHERE grp = ? AND user_id = ?").bind(zyName(name), user.id).run();
  return json({ ok: true });
}
async function zyChat(env, user, url) {
  const key = url.searchParams.get("key") || "*", after = Math.max(0, Number(url.searchParams.get("after")) || 0);
  const meta = await zyChatMeta(env, user, key);
  const rows = await env.DB.prepare(`SELECT id, from_id, body, created_at FROM (SELECT id, from_id, body, created_at FROM zy_msgs WHERE ${meta.where} AND id > ? ORDER BY id DESC LIMIT 60) ORDER BY id`).bind(...meta.args, after).all();
  const msgs = await zyMsgOut(env, user, rows.results);
  const last = rows.results.length ? rows.results[rows.results.length - 1].id : 0;
  if (last) await env.DB.prepare("INSERT INTO zy_read(user_id, chat, last_id) VALUES(?,?,?) ON CONFLICT(user_id, chat) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)").bind(user.id, meta.key || "*", last).run();
  return json({ messages: msgs, last });
}
async function zySend(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const text = clean(b.text, ZY_MAX), to = String(b.to || "*");
  if (!text) throw new HttpError(400, "Escribe un mensaje.");
  await rateLimit(env, "zys:" + user.id, 30, 60);
  const meta = await zyChatMeta(env, user, to);
  await hit(env, "zys:" + user.id);
  const sealed = await sealText(env, text);
  const r = await env.DB.prepare("INSERT INTO zy_msgs(kind, from_id, to_id, grp, body, created_at) VALUES(?,?,?,?,?,?)")
    .bind(meta.kind, user.id, meta.other?.id || 0, meta.grp || "", sealed, now()).run();
  if (meta.other) await env.DB.prepare("INSERT OR IGNORE INTO zy_contacts(user_id, contact_id, created_at) VALUES(?,?,?)").bind(user.id, meta.other.id, now()).run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}

// ---- mensajes de voz (MP3 mono 16 kHz que sube la web o el ZYHT32; máx. 256 KB ≈ 30 s). Se guardan 14 días.
const ZY_VOICE_MAX = 262144, ZY_VOICE_DAYS = 14;
function bytesToB64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToBytes(t) { const bin = atob(t), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function zySendVoice(request, env, user, url) {
  const dur = Math.max(1, Math.min(30, Math.floor(Number(url.searchParams.get("dur")) || 1)));
  const len = Number(request.headers.get("content-length") || 0);
  if (len > ZY_VOICE_MAX) throw new HttpError(413, "Audio muy largo");
  await rateLimit(env, "zyv:" + user.id, 12, 60);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > ZY_VOICE_MAX) throw new HttpError(413, "Audio muy largo");
  const okMp3 = buf.length > 200 && ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0));
  if (!okMp3) throw new HttpError(400, "El audio debe ser MP3.");
  const meta = await zyChatMeta(env, user, String(url.searchParams.get("to") || "*"));
  await hit(env, "zyv:" + user.id);
  const sealed = await sealText(env, `nota de voz ${dur} s`);
  const r = await env.DB.prepare("INSERT INTO zy_msgs(kind, from_id, to_id, grp, body, created_at) VALUES(?,?,?,?,?,?)").bind(meta.kind, user.id, meta.other?.id || 0, meta.grp || "", sealed, now()).run();
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO zy_voice(id, msg_id, dur, data, created_at) VALUES(?,?,?,?,?)").bind(id, r.meta.last_row_id, dur, bytesToB64(buf), now()),
    env.DB.prepare("UPDATE zy_voice SET data = '' WHERE created_at < ? AND data <> ''").bind(now() - ZY_VOICE_DAYS * 86400),
  ]);
  if (meta.other) await env.DB.prepare("INSERT OR IGNORE INTO zy_contacts(user_id, contact_id, created_at) VALUES(?,?,?)").bind(user.id, meta.other.id, now()).run();
  return json({ ok: true, id, msg: r.meta.last_row_id });
}
async function zyVoiceGet(env, user, id) {
  const v = await env.DB.prepare("SELECT v.data, m.kind, m.from_id, m.to_id, m.grp FROM zy_voice v JOIN zy_msgs m ON m.id = v.msg_id WHERE v.id = ?").bind(String(id).slice(0, 40)).first();
  let ok = !!v;
  if (v && v.kind === "u") ok = v.from_id === user.id || v.to_id === user.id;
  if (v && v.kind === "g") ok = !!(await env.DB.prepare("SELECT 1 FROM zy_members WHERE grp = ? AND user_id = ?").bind(v.grp, user.id).first());
  if (!ok) throw new HttpError(404, "No existe ese audio.");
  if (!v.data) throw new HttpError(404, "El audio ya venció.");
  const bytes = b64ToBytes(v.data);
  return new Response(bytes, { headers: { "content-type": "audio/mpeg", "content-length": String(bytes.length), "cache-control": "private, max-age=3600" } });
}
async function zyDeleteMsg(env, user, id) {
  const n = Number(id);
  const r = await env.DB.prepare("DELETE FROM zy_msgs WHERE id = ? AND from_id = ?").bind(n, user.id).run();
  if (r.meta.changes) await env.DB.prepare("DELETE FROM zy_voice WHERE msg_id = ?").bind(n).run();
  return json({ ok: !!r.meta.changes });
}

// Para el ZYHT32 (solo WiFi simple): todo lo nuevo dirigido a mí, de una vez.
async function zyPoll(env, user, url) {
  const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
  const rows = await env.DB.prepare(
    `SELECT id, kind, from_id, to_id, grp, body, created_at FROM zy_msgs WHERE id > ? AND from_id <> ? AND (kind = 's' OR (kind = 'u' AND to_id = ?) OR (kind = 'g' AND grp IN (SELECT grp FROM zy_members WHERE user_id = ?))) ORDER BY id LIMIT 40`)
    .bind(after, user.id, user.id, user.id).all();
  const names = await zyNames(env, rows.results.map((r) => r.from_id));
  const vm = await zyVoiceMap(env, rows.results.map((r) => r.id));
  const msgs = [];
  for (const r of rows.results) { const v = vm[r.id]; msgs.push({ id: r.id, chat: r.kind === "s" ? "*" : r.kind === "g" ? "#" + r.grp : "@" + (names[r.from_id]?.username || "?"), from: names[r.from_id]?.username || "?", text: await zyOpen(env, r.body), at: r.created_at, ...(v ? { voice: v.id, dur: v.dur } : {}) }); }
  return json({ messages: msgs, last: rows.results.length ? rows.results[rows.results.length - 1].id : after });
}
// Vincular un ZYHT32: la web da un código de 6 dígitos (10 min); el ZYHT32 lo canjea y recibe su propio token (sin teclear la clave en el aparato).
async function zyPairStart(env, user) {
  await rateLimit(env, "zypair:" + user.id, 5, 600);
  const codeTxt = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  await env.DB.batch([env.DB.prepare("DELETE FROM zy_pair WHERE exp < ? OR user_id = ?").bind(now(), user.id), env.DB.prepare("INSERT INTO zy_pair(code_hash, user_id, exp) VALUES(?,?,?)").bind(await sha256("zypair:" + codeTxt), user.id, now() + 600), env.DB.prepare("INSERT INTO attempts(key, ts) VALUES(?, ?)").bind("zypair:" + user.id, now())]);
  return json({ code: codeTxt, expires_in: 600 });
}
async function zyPairClaim(request, env) {
  const b = await request.json().catch(() => ({})), c = clean(b.code, 8).replace(/\D/g, "");
  const ip = ipOf(request);
  await rateLimit(env, "zyclaim:" + ip, 10, 600);
  await hit(env, "zyclaim:" + ip);
  const h = await sha256("zypair:" + c);
  const row = c.length === 6 ? await env.DB.prepare("SELECT user_id, exp FROM zy_pair WHERE code_hash = ?").bind(h).first() : null;
  if (!row || row.exp < now()) throw new HttpError(400, "Código no válido o vencido. Pide uno nuevo en la web.");
  await env.DB.prepare("DELETE FROM zy_pair WHERE code_hash = ?").bind(h).run();
  const u = await env.DB.prepare("SELECT id, username FROM users WHERE id = ? AND disabled = 0").bind(row.user_id).first();
  if (!u) throw new HttpError(400, "Cuenta no disponible.");
  const s = await newSession(env, u.id, "app", clean(b.label, 40) || "ZYHT32");
  return json({ ok: true, token: s.token, user: { username: u.username } }, 201);
}

// ------------------------------------------------------------------ cifrado en reposo (números de transferencia)
let _dkPromise = null;
async function dataKey(env) { return _dkPromise || (_dkPromise = dataKeyMake(env).catch((e) => { _dkPromise = null; throw e; })); }
async function dataKeyMake(env) {
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

// ------------------------------------------------------------------ verificación en dos pasos (TOTP, RFC 6238: Google Authenticator, Aegis, Authy…)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32enc(u8) { let bits = 0, val = 0, out = ""; for (const b of u8) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(t) { let bits = 0, val = 0; const out = []; for (const c of t.toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
async function totp(secretB32, step) {
  const key = await crypto.subtle.importKey("raw", b32dec(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); let x = step; for (let i = 7; i >= 0; i--) { msg[i] = x & 255; x = Math.floor(x / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, "0");
}
const backupHash = (c) => sha256("zyh-2fa-bk:" + String(c).toLowerCase().replace(/[^a-z0-9]/g, ""));
// true si el código vale; un código TOTP no se puede usar dos veces y uno de respaldo se gasta
async function check2fa(env, userId, row, codeIn) {
  if (/^\d{6}$/.test(codeIn)) {
    const secret = await openText(env, row.secret), cur = Math.floor(Date.now() / 30000);
    for (const st of [cur - 1, cur, cur + 1]) {
      if (st > row.last_step && safeEqual(await totp(secret, st), codeIn)) { await env.DB.prepare("UPDATE user_2fa SET last_step = ? WHERE user_id = ?").bind(st, userId).run(); return true; }
    }
    return false;
  }
  const h = await backupHash(codeIn), codes = JSON.parse(row.codes || "[]");
  if (!codes.includes(h)) return false;
  await env.DB.prepare("UPDATE user_2fa SET codes = ? WHERE user_id = ?").bind(JSON.stringify(codes.filter((c) => c !== h)), userId).run();
  return true;
}
async function twofaApi(request, env, user, b, m) {
  const row = await env.DB.prepare("SELECT secret, codes, enabled, last_step FROM user_2fa WHERE user_id = ?").bind(user.id).first();
  if (b === "setup" && m === "POST") {
    if (row && row.enabled) throw new HttpError(409, "Ya está activada.");
    const secret = b32enc(crypto.getRandomValues(new Uint8Array(20)));
    await env.DB.prepare("INSERT OR REPLACE INTO user_2fa(user_id, secret, codes, enabled, last_step, created_at) VALUES(?,?,?,0,0,?)").bind(user.id, await sealText(env, secret), "[]", now()).run();
    const label = encodeURIComponent("ZYH Studios:" + user.username);
    return json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("ZYH Studios")}&algorithm=SHA1&digits=6&period=30` });
  }
  const body = await request.json().catch(() => ({}));
  const codeIn = String(body.code || "").replace(/[\s-]/g, "");
  if (!row) throw new HttpError(400, "Primero empieza la activación.");
  await rateLimit(env, "2fa:" + user.id, 6, 900);
  if (b === "enable" && m === "POST") {
    if (row.enabled) throw new HttpError(409, "Ya está activada.");
    if (!/^\d{6}$/.test(codeIn) || !(await check2fa(env, user.id, row, codeIn))) { await hit(env, "2fa:" + user.id); throw new HttpError(400, "Código incorrecto: revisa que la hora de tu teléfono esté bien."); }
    const abc = "abcdefghjkmnpqrstuvwxyz23456789", plain = [];
    for (let i = 0; i < 8; i++) plain.push(Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => abc[x % abc.length]).join("").replace(/(.{4})/, "$1-"));
    const hashes = await Promise.all(plain.map(backupHash));
    await env.DB.batch([
      env.DB.prepare("UPDATE user_2fa SET enabled = 1, codes = ? WHERE user_id = ?").bind(JSON.stringify(hashes), user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(user.id, user.token_hash),   // las demás sesiones vuelven a entrar con código
    ]);
    return json({ ok: true, backup_codes: plain });
  }
  if (b === "disable" && m === "POST") {
    if (!row.enabled) { await env.DB.prepare("DELETE FROM user_2fa WHERE user_id = ?").bind(user.id).run(); return json({ ok: true }); }
    if (!codeIn || !(await check2fa(env, user.id, row, codeIn))) { await hit(env, "2fa:" + user.id); throw new HttpError(400, "Código incorrecto."); }
    await env.DB.prepare("DELETE FROM user_2fa WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, "No encontrado.");
}

// ------------------------------------------------------------------ recuperar cuenta (la persona lo pide; el equipo verifica y aprueba)
// La contraseña nueva se escribe al pedir la recuperación y se transforma en el navegador: aquí solo se guarda su huella.
// Si el equipo aprueba, esa huella pasa a ser la contraseña de la cuenta. Nadie del equipo ve ni pone la contraseña.
async function recoverRequest(request, env) {
  const body = await request.json().catch(() => ({}));
  const username = clean(body.username, 32).toLowerCase(), dk = clean(body.new_dk, 80).toLowerCase();
  const email = clean(body.email, 120).toLowerCase(), contact = clean(body.contact, 120), note = clean(body.note, 500);
  if (!/^[a-z0-9_.-]{3,32}$/.test(username) || !/^[a-f0-9]{64}$/.test(dk)) throw new HttpError(400, "Escribe tu usuario y una contraseña nueva.");
  if (contact.length < 4) throw new HttpError(400, "Escribe cómo podemos contactarte (por ejemplo tu TikTok o tu correo).");
  const ip = ipOf(request);
  await rateLimit(env, "rec:" + ip, 3, 86400);
  await rateLimit(env, "recu:" + username, 3, 86400);
  await env.DB.batch([env.DB.prepare("INSERT INTO attempts(key, ts) VALUES(?, ?)").bind("rec:" + ip, now()), env.DB.prepare("INSERT INTO attempts(key, ts) VALUES(?, ?)").bind("recu:" + username, now())]);
  const u = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  const ticket = Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("").replace(/(.{5})/, "$1-");
  const salt = randomHex(16);
  // se guarda igual aunque el usuario no exista, para no revelar qué usuarios hay
  await env.DB.prepare("INSERT INTO recovery_requests(user_id, username, email_given, contact, note, new_salt, new_hash, ticket_hash, ip, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(u ? u.id : null, username, email, contact, note, salt, await sha256(salt + ":" + dk), await sha256("zyh-rec:" + ticket), ip, now()).run();
  return json({ ok: true, ticket }, 201);
}
async function recoverStatus(env, url) {
  const t = String(url.searchParams.get("ticket") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{5})/, "$1-");
  const r = await env.DB.prepare("SELECT status, answer, created_at, decided_at FROM recovery_requests WHERE ticket_hash = ?").bind(await sha256("zyh-rec:" + t)).first();
  if (!r) throw new HttpError(404, "No encontramos ese número de solicitud.");
  return json({ status: r.status, answer: r.answer, created_at: r.created_at, decided_at: r.decided_at });
}

// ------------------------------------------------------------------ soporte de cuentas
// Clave de soporte: la crea el dueño en Administrar > Soporte de cuentas (o se pone como secreto SUPPORT_KEY en Cloudflare).
// Con ella, la herramienta de PC (ZYH_Soporte.py) muestra 5 códigos de 5 caracteres que cambian cada minuto. Cada código sirve
// una sola vez y autoriza una acción de soporte en la web. La herramienta también puede hacer las acciones directo, firmando
// cada pedido con la clave (sirve aunque nadie pueda entrar a la web).
const SUP_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
async function supportSecrets(env) {
  const out = [];
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'support_key'").first();
  if (row) { const k = await openText(env, row.value); if (k) out.push(k); }
  if (env.SUPPORT_KEY) out.push(String(env.SUPPORT_KEY));
  return out;
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function supportCodes(secret, minute) {
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const h = await hmacHex(secret, `zyh-soporte:${minute}:${i}`);
    let c = ""; for (let j = 0; j < 5; j++) c += SUP_ABC[parseInt(h.slice(j * 4, j * 4 + 4), 16) % SUP_ABC.length];
    codes.push(c);
  }
  return codes;
}
// gasta un código de soporte (vale el minuto actual y el anterior); lanza error si no sirve
async function useSupportCode(env, codeIn, who) {
  const code = String(codeIn || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  await rateLimit(env, "sup:" + who, 10, 600);
  const secrets = await supportSecrets(env);
  if (!secrets.length) throw new HttpError(400, "Todavía no hay clave de soporte: créala en Administrar > Soporte de cuentas.");
  const m = Math.floor(Date.now() / 60000);
  for (const [si, sec] of secrets.entries()) for (const mm of [m, m - 1]) {
    const list = await supportCodes(sec, mm);
    const i = list.findIndex((c) => safeEqual(c, code));
    if (i >= 0) {
      const r = await env.DB.prepare("INSERT OR IGNORE INTO support_used(k, ts) VALUES(?, ?)").bind(`${si}:${mm}:${i}`, now()).run();
      await env.DB.prepare("DELETE FROM support_used WHERE ts < ?").bind(now() - 600).run();
      if (!r.meta.changes) throw new HttpError(400, "Ese código ya se usó. Usa otro de los 5.");
      return true;
    }
  }
  await hit(env, "sup:" + who);
  throw new HttpError(400, "Código de soporte incorrecto o vencido.");
}
async function supFindUser(env, q) {
  q = String(q || "").trim().toLowerCase();
  const byId = /^\d{1,7}$/.test(q) ? Number(q) : 0;
  return env.DB.prepare("SELECT id, username, email, role, disabled, created_at FROM users WHERE id = ? OR username = ?").bind(byId, q).first();
}
async function supUserInfo(env, u) {
  const since = now() - 900;
  const fails = (await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?").bind("login:" + u.username, since).first()).n;
  const codeFails = (await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?").bind("2fa:" + u.id, since).first()).n;
  const ses = await env.DB.prepare("SELECT kind, label, created_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 30").bind(u.id, now()).all();
  const tf = await env.DB.prepare("SELECT 1 FROM user_2fa WHERE user_id = ? AND enabled = 1").bind(u.id).first();
  return { id: u.id, code: code(u.id), username: u.username, email: u.email, role: u.role, disabled: !!u.disabled, created_at: u.created_at,
    locked: fails >= 8 || codeFails >= 6, failed_logins: fails, twofa: !!tf, sessions: ses.results };
}
// las acciones de soporte (las mismas para la web y para la herramienta de PC)
async function supAction(env, actor, body) {
  const u = await supFindUser(env, body.user);
  if (!u) throw new HttpError(404, "No encontré esa cuenta (escribe el usuario o el ID).");
  const isOwnerTool = actor.tool;   // la herramienta firmada con la clave tiene permiso de dueño
  if (!isOwnerTool) {
    if (u.id === 1 && actor.id !== 1) throw new HttpError(403, "La cuenta del dueño solo la arregla el dueño.");
    if (u.role !== "user" && u.id !== actor.id && !can(actor, "roles.gestionar")) throw new HttpError(403, "No puedes cambiar a otro miembro del equipo.");
  }
  const by = actor.tool ? "herramienta de soporte" : actor.username, byId = actor.tool ? 1 : actor.id;
  const log = (txt) => env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(u.id, byId, txt + " (soporte: " + by + ")", now());
  const unlockOps = [env.DB.prepare("DELETE FROM attempts WHERE key = ? OR key = ? OR key = ?").bind("login:" + u.username, "2fa:" + u.id, "recu:" + u.username)];
  const act = body.action;
  if (act === "info") return { user: await supUserInfo(env, u) };
  if (act === "unlock") { await env.DB.batch([...unlockOps, log("Cuenta desbloqueada")]); return { ok: true, msg: `@${u.username} desbloqueada: ya puede volver a intentar.` }; }
  if (act === "sessions") { await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id), log("Sesiones cerradas")]); return { ok: true, msg: "Se cerraron todas sus sesiones." }; }
  if (act === "no2fa") { await env.DB.batch([env.DB.prepare("DELETE FROM user_2fa WHERE user_id = ?").bind(u.id), ...unlockOps, log("Verificación en dos pasos quitada")]); return { ok: true, msg: "Se quitó la verificación en dos pasos." }; }
  const dk = clean(body.new_dk, 80).toLowerCase();
  if (act === "password") {
    if (!/^[a-f0-9]{64}$/.test(dk)) throw new HttpError(400, "Falta la contraseña nueva.");
    const salt = randomHex(16);
    await env.DB.batch([env.DB.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").bind(salt, await sha256(salt + ":" + dk), u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id), env.DB.prepare("DELETE FROM pw_resets WHERE user_id = ?").bind(u.id),
      ...(body.must_change ? [env.DB.prepare("INSERT OR REPLACE INTO pw_resets(user_id, by_id, created_at) VALUES(?,?,?)").bind(u.id, byId, now())] : []),
      ...unlockOps, log("Contraseña cambiada")]);
    return { ok: true, msg: `Contraseña de @${u.username} cambiada. Se cerraron sus sesiones.` };
  }
  if (act === "rename") {
    const nu = clean(body.new_username, 40).toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(nu)) throw new HttpError(400, "Nombre nuevo: 3 a 32 caracteres (letras, números, punto, guion o guion bajo).");
    if (nu === u.username) throw new HttpError(400, "Es el mismo nombre.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(nu).first()) throw new HttpError(409, "Ese nombre ya lo tiene otra cuenta.");
    // la clave de la cuenta depende del nombre: al cambiarlo hace falta una contraseña nueva hecha con el nombre nuevo
    if (!/^[a-f0-9]{64}$/.test(dk)) throw new HttpError(400, "Al cambiar el nombre también hay que poner una contraseña nueva.");
    const salt = randomHex(16);
    await env.DB.batch([env.DB.prepare("UPDATE users SET username = ?, salt = ?, hash = ? WHERE id = ?").bind(nu, salt, await sha256(salt + ":" + dk), u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id), ...unlockOps,
      env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(u.id, byId, `Nombre cambiado de @${u.username} a @${nu} y contraseña nueva (soporte: ${by})`, now())]);
    return { ok: true, msg: `Ahora es @${nu}. Entra con el nombre nuevo y la contraseña nueva.` };
  }
  throw new HttpError(400, "Acción no válida.");
}
// web: pestaña Soporte de cuentas (sesión del equipo + código de la herramienta)
async function supportAdmin(request, env, user, sub, m) {
  if (sub === "status" && m === "GET") {
    needPerm(user, "cuentas.restablecer");
    const row = await env.DB.prepare("SELECT 1 FROM settings WHERE key = 'support_key'").first();
    return json({ paired: !!row || !!env.SUPPORT_KEY, owner: user.id === 1 });
  }
  if (sub === "key" && m === "POST") {
    if (user.id !== 1) throw new HttpError(403, "Solo el dueño crea la clave de soporte.");
    const key = "ZS1-" + b32enc(crypto.getRandomValues(new Uint8Array(20)));
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('support_key', ?)").bind(await sealText(env, key)).run();
    return json({ key });
  }
  if (sub === "find" && m === "GET") {
    needPerm(user, "cuentas.restablecer");
    const u = await supFindUser(env, new URL(request.url).searchParams.get("q"));
    if (!u) throw new HttpError(404, "No encontré esa cuenta (escribe el usuario o el ID).");
    return json({ user: await supUserInfo(env, u) });
  }
  if (sub === "do" && m === "POST") {
    needPerm(user, "cuentas.restablecer");
    const body = await request.json().catch(() => ({}));
    await useSupportCode(env, body.code, "u" + user.id);
    return json(await supAction(env, user, body));
  }
  throw new HttpError(404, "No encontrado.");
}
// herramienta de PC: cada pedido va firmado con la clave de soporte (HMAC-SHA256 de "ts\ncuerpo")
async function supportTool(request, env) {
  const raw = await request.text();
  if (raw.length > 4000) throw new HttpError(413, "Pedido demasiado grande.");
  const ts = Number(request.headers.get("x-zyh-ts")), sig = String(request.headers.get("x-zyh-sig") || "");
  await rateLimit(env, "supt:" + ipOf(request), 30, 600);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 120) throw new HttpError(401, "La hora de tu PC está mal (revisa fecha y hora).");
  let ok = false;
  for (const sec of await supportSecrets(env)) if (safeEqual(await hmacHex(sec, ts + "\n" + raw), sig)) ok = true;
  if (!ok) { await hit(env, "supt:" + ipOf(request)); throw new HttpError(401, "Clave de soporte incorrecta o cambiada: vuelve a vincular la herramienta."); }
  const nonce = await sha256(sig);   // un pedido firmado no se puede repetir
  const r = await env.DB.prepare("INSERT OR IGNORE INTO support_used(k, ts) VALUES(?, ?)").bind("n:" + nonce, now()).run();
  if (!r.meta.changes) throw new HttpError(409, "Pedido repetido.");
  const body = JSON.parse(raw || "{}");
  if (body.action === "ping") return json({ ok: true, msg: "Conectado" });
  return json(await supAction(env, { tool: true }, body));
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
    const tf = await env.DB.prepare("SELECT 1 FROM user_2fa WHERE user_id = ? AND enabled = 1").bind(u.id).first();
    return json({ user: { ...u, code: code(u.id), twofa: !!tf },
      licenses: lic.results.map((l) => ({ id: l.id, product: l.product, product_name: PLANS[l.product]?.name || l.product, plan: l.plan, plan_name: PLANS[l.product]?.plans[l.plan]?.[0] || l.plan, devices: l.devices, used: l.used, expires: l.expires_at, note: l.note, active: l.expires_at > now() })),
      reports: rep.results });
  }
  // Recuperación: el admin restablece la contraseña. La contraseña temporal se genera y se transforma en el navegador del admin
  // (igual que al registrarse): al servidor solo llega la clave derivada, nunca la contraseña. La persona debe cambiarla al entrar.
  if (section === "users" && id && action === "password" && m === "POST") {
    needPerm(user, "cuentas.restablecer");
    const body = await request.json().catch(() => ({}));
    const dk = clean(body.dk, 80).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(dk)) throw new HttpError(400, "Datos incompletos.");
    if (Number(id) === user.id) throw new HttpError(400, "Para tu propia cuenta usa «Cambiar contraseña» en Mi cuenta.");
    if (Number(id) === 1) throw new HttpError(400, "La contraseña del dueño no se puede restablecer desde aquí.");
    const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(Number(id)).first();
    if (!target) throw new HttpError(404, "Esa cuenta no existe.");
    if (target.role !== "user" && !can(user, "roles.gestionar")) throw new HttpError(403, "No puedes restablecer a otro miembro del equipo.");
    await rateLimit(env, "pwreset:" + user.id, 20, 3600);
    await hit(env, "pwreset:" + user.id);
    const salt = randomHex(16), why = clean(body.reason, 200);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").bind(salt, await sha256(salt + ":" + dk), target.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
      env.DB.prepare("INSERT OR REPLACE INTO pw_resets(user_id, by_id, created_at) VALUES(?,?,?)").bind(target.id, user.id, now()),
      ...(body.remove_2fa ? [env.DB.prepare("DELETE FROM user_2fa WHERE user_id = ?").bind(target.id)] : []),
      env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(target.id, user.id, "Contraseña restablecida (recuperación)" + (body.remove_2fa ? ", sin verificación en dos pasos" : "") + (why ? ": " + why : ""), now()),
    ]);
    return json({ ok: true });
  }
  if (section === "support") return supportAdmin(request, env, user, id, m);
  if (section === "recovery" && !id && m === "GET") {
    needPerm(user, "cuentas.restablecer");
    await env.DB.prepare("UPDATE recovery_requests SET status = 'vencida' WHERE status = 'pendiente' AND created_at < ?").bind(now() - 7 * 86400).run();
    const rows = await env.DB.prepare(`SELECT r.id, r.user_id, r.username, r.email_given, r.contact, r.note, r.status, r.answer, r.created_at, r.decided_at,
      u.email AS email_real, u.created_at AS user_created, (SELECT 1 FROM user_2fa t WHERE t.user_id = r.user_id AND t.enabled = 1) AS twofa, d.username AS decided_name
      FROM recovery_requests r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by ORDER BY (r.status = 'pendiente') DESC, r.id DESC LIMIT 100`).all();
    return json({ requests: rows.results.map((r) => ({ ...r, exists: !!r.user_id, email_match: !!(r.email_real && r.email_given && r.email_real.toLowerCase() === r.email_given) })) });
  }
  if (section === "recovery" && id && m === "POST") {
    needPerm(user, "cuentas.restablecer");
    const body = await request.json().catch(() => ({}));
    const r = await env.DB.prepare("SELECT * FROM recovery_requests WHERE id = ?").bind(Number(id)).first();
    if (!r) throw new HttpError(404, "No existe esa solicitud.");
    if (r.status !== "pendiente") throw new HttpError(409, "Esa solicitud ya se respondió.");
    const answer = clean(body.answer, 300);
    if (body.decision === "rechazar") {
      await env.DB.prepare("UPDATE recovery_requests SET status = 'rechazada', answer = ?, decided_by = ?, decided_at = ? WHERE id = ?").bind(answer, user.id, now(), r.id).run();
      return json({ ok: true });
    }
    if (body.decision !== "aprobar") throw new HttpError(400, "Decisión no válida.");
    if (!r.user_id) throw new HttpError(400, "Ese usuario no existe: solo se puede rechazar.");
    if (r.user_id === 1) throw new HttpError(400, "La cuenta del dueño no se recupera desde aquí.");
    const target = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(r.user_id).first();
    if (target && target.role !== "user" && !can(user, "roles.gestionar")) throw new HttpError(403, "No puedes recuperar la cuenta de otro miembro del equipo.");
    const ops = [
      env.DB.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").bind(r.new_salt, r.new_hash, r.user_id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(r.user_id),
      env.DB.prepare("DELETE FROM pw_resets WHERE user_id = ?").bind(r.user_id),
      env.DB.prepare("UPDATE recovery_requests SET status = 'aprobada', answer = ?, decided_by = ?, decided_at = ? WHERE id = ?").bind(answer, user.id, now(), r.id),
      env.DB.prepare("UPDATE recovery_requests SET status = 'rechazada', answer = 'Se aprobó otra solicitud de esta cuenta.', decided_by = ?, decided_at = ? WHERE user_id = ? AND status = 'pendiente' AND id <> ?").bind(user.id, now(), r.user_id, r.id),
      env.DB.prepare("INSERT INTO user_reports(user_id, by_id, reason, created_at) VALUES(?,?,?,?)").bind(r.user_id, user.id, "Cuenta recuperada (solicitud #" + r.id + ")" + (body.remove_2fa ? ", sin verificación en dos pasos" : ""), now()),
    ];
    if (body.remove_2fa) ops.push(env.DB.prepare("DELETE FROM user_2fa WHERE user_id = ?").bind(r.user_id));
    await env.DB.batch(ops);
    return json({ ok: true });
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
  if (section === "requests" && !id && m === "GET") {
    needPerm(user, "cuentas.ver");
    const rows = await env.DB.prepare("SELECT q.id, q.product, q.text, q.device, q.created_at, u.username FROM zr_requests q LEFT JOIN users u ON u.id = q.user_id ORDER BY q.id DESC LIMIT 100").all();
    return json({ requests: rows.results });
  }
  if (section === "requests" && id && m === "DELETE") { needPerm(user, "cuentas.ver"); await env.DB.prepare("DELETE FROM zr_requests WHERE id = ?").bind(Number(id)).run(); return json({ ok: true }); }
  if (section === "news" && !id && m === "GET") {
    needPerm(user, "cuentas.ver");
    const rows = await env.DB.prepare("SELECT id, title, body, app, at, ttl FROM zr_news ORDER BY id DESC LIMIT 30").all();
    return json({ news: rows.results });
  }
  if (section === "news" && !id && m === "POST") {
    needPerm(user, "paquetes.revisar");
    const body = await request.json().catch(() => ({}));
    const title = clean(body.title, 120), text = clean(body.body, 1200), app = ["all", "pc", "phone"].includes(body.app) ? body.app : "all";
    const hours = Math.max(1, Math.min(24, Math.round(Number(body.hours) || 24)));
    if (title.length < 3) throw new HttpError(400, "Escribe un título.");
    await env.DB.prepare("INSERT INTO zr_news(title, body, app, at, ttl, author_id) VALUES(?,?,?,?,?,?)").bind(title, text, app, now(), hours * 3600, user.id).run();
    return json({ ok: true }, 201);
  }
  if (section === "news" && id && m === "DELETE") { needPerm(user, "paquetes.revisar"); await env.DB.prepare("DELETE FROM zr_news WHERE id = ?").bind(Number(id)).run(); return json({ ok: true }); }
  if (section === "feedback" && !id && m === "GET") {
    needPerm(user, "cuentas.ver");
    const rows = await env.DB.prepare("SELECT f.id, f.product, f.stars, f.comment, f.device, f.created_at, u.username FROM zr_feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 100").all();
    const avg = await env.DB.prepare("SELECT product, COUNT(*) AS n, ROUND(AVG(stars),2) AS avg FROM zr_feedback GROUP BY product").all();
    return json({ feedback: rows.results, resumen: avg.results });
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

// ---- buzón de ZYH Business (PC y celular): solo guarda bloques cifrados de extremo a extremo; el servidor no puede leerlos.
const ZR_MAX_BLOB = 400000, ZR_DAYS = 30;
async function zrSend(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const room = String(b.room || ""), mid = String(b.id || ""), blob = String(b.blob || "");
  if (!/^[0-9a-f]{24}$/.test(room)) throw new HttpError(400, "Sala no válida.");
  if (!/^[0-9a-zA-Z_+/=-]{8,64}$/.test(mid)) throw new HttpError(400, "Mensaje no válido.");
  if (blob.length < 20 || blob.length > ZR_MAX_BLOB) throw new HttpError(413, "Mensaje demasiado grande.");
  await rateLimit(env, "zrs:" + user.id, 120, 60);
  await hit(env, "zrs:" + user.id);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO zr_box(room, mid, user_id, blob, created_at) VALUES(?,?,?,?,?)").bind(room, mid, user.id, blob, now()),
    env.DB.prepare("DELETE FROM zr_box WHERE created_at < ?").bind(now() - ZR_DAYS * 86400),
  ]);
  return json({ ok: true });
}
async function zrInbox(env, user, url) {
  const room = String(url.searchParams.get("room") || ""), after = Math.max(0, Math.floor(Number(url.searchParams.get("after")) || 0));
  if (!/^[0-9a-f]{24}$/.test(room)) throw new HttpError(400, "Sala no válida.");
  const rows = await env.DB.prepare("SELECT seq, blob FROM zr_box WHERE room = ? AND seq > ? ORDER BY seq LIMIT 25").bind(room, after).all();
  return json({ items: rows.results.map((r) => ({ seq: r.seq, blob: r.blob })) });
}
async function zrFeedback(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const stars = Math.round(Number(b.stars));
  if (!(stars >= 1 && stars <= 5)) throw new HttpError(400, "Elige de 1 a 5 estrellas.");
  await rateLimit(env, "zrf:" + user.id, 6, 86400);
  await hit(env, "zrf:" + user.id);
  await env.DB.prepare("INSERT INTO zr_feedback(user_id, product, stars, comment, device, created_at) VALUES(?,?,?,?,?,?)")
    .bind(user.id, clean(b.product, 30) || "business", stars, clean(b.comment, 600), clean(b.device, 60), now()).run();
  return json({ ok: true }, 201);
}

async function zrNews(env) {
  const t = now();
  const rows = await env.DB.prepare("SELECT id, title, body, app, at, ttl FROM zr_news WHERE at + ttl > ? AND at <= ? ORDER BY at DESC LIMIT 10").bind(t, t + 300).all();
  return json({ items: rows.results.map((r) => ({ id: String(r.id), title: r.title, body: r.body, at: r.at, ttl: r.ttl, app: r.app })) });
}
async function zrRequest(request, env, user) {
  const b = await request.json().catch(() => ({}));
  const text = clean(b.text, 1500);
  if (text.length < 10) throw new HttpError(400, "Cuéntanos un poco más (mínimo 10 letras).");
  await rateLimit(env, "zrq:" + user.id, 5, 86400);
  await hit(env, "zrq:" + user.id);
  await env.DB.prepare("INSERT INTO zr_requests(user_id, product, text, device, created_at) VALUES(?,?,?,?,?)")
    .bind(user.id, clean(b.product, 30) || "business", text, clean(b.device, 60), now()).run();
  return json({ ok: true }, 201);
}


// ---- Relay de ZYH Remote por Internet. El celular conecta a  wss://<esta web>/ws?room=<huella>&role=host|ctrl[&token=…]
// Une al anfitrión (host) con el control (ctrl) de la misma sala y reenvía los bytes tal cual: van cifrados de extremo a extremo
// por la app, así que el servidor no puede ver la pantalla ni los archivos. Si defines el secreto RELAY_TOKEN, se exige igual en la app.
export class ZyhRelay {
  constructor(state, env) { this.env = env; this.peer = { host: null, ctrl: null }; this.queue = { host: [], ctrl: [] }; this.qbytes = { host: 0, ctrl: 0 }; this.timer = null; }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se necesita WebSocket.", { status: 426 });
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "host" && role !== "ctrl") return new Response("role no válido", { status: 400 });
    const other = role === "host" ? "ctrl" : "host";
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const old = this.peer[role];
    if (old) { this.peer[role] = null; try { old.close(1000, "reemplazado"); } catch {} }
    this.peer[role] = server; this.queue[role] = []; this.qbytes[role] = 0;
    // lo que el otro lado ya mandó mientras esperaba (el saludo) se entrega al llegar este
    const mine = this.queue[other]; this.queue[other] = []; this.qbytes[other] = 0;
    for (const m of mine) { try { server.send(m); } catch {} }
    clearTimeout(this.timer);
    if (!this.peer[other] && role === "ctrl") this.timer = setTimeout(() => { if (this.peer.ctrl === server && !this.peer.host) { try { server.close(1000, "No hay anfitrión en esa sala."); } catch {} } }, 25000);
    server.addEventListener("message", (ev) => {
      const size = typeof ev.data === "string" ? ev.data.length : ev.data.byteLength;
      if (size > 1048576) { try { server.close(1009, "mensaje enorme"); } catch {} return; }
      const dst = this.peer[other];
      if (dst) { try { dst.send(ev.data); } catch {} return; }
      if (this.qbytes[role] + size > 262144) return;          // espera corta: solo el saludo
      this.queue[role].push(ev.data); this.qbytes[role] += size;
    });
    const gone = () => {
      if (this.peer[role] !== server) return;
      this.peer[role] = null; this.queue[role] = []; this.qbytes[role] = 0;
      const dst = this.peer[other];
      if (dst) { this.peer[other] = null; try { dst.close(1000, "el otro lado se desconectó"); } catch {} }
    };
    server.addEventListener("close", gone); server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
// ---- Puente de llamadas de Zyphora: wss://<esta web>/call?room=<id de la llamada>&token=<sesión ZYH>
// Solo une a los participantes de una llamada y les pasa los mensajes (señalización WebRTC: oferta, respuesta, ICE…).
// El audio/video va directo entre los teléfonos (WebRTC, cifrado). Si no logran conectarse directo, pueden mandar
// trozos binarios por aquí mismo y el puente los reenvía. Hasta 8 personas por llamada.
export class ZyhCall {
  constructor(state, env) { this.peers = new Map(); }
  send(ws, obj) { try { ws.send(typeof obj === "string" ? obj : JSON.stringify(obj)); } catch {} }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Se necesita WebSocket.", { status: 426 });
    const user = request.headers.get("x-zyh-user") || "?";
    if (this.peers.size >= 8) return new Response("La llamada está llena (máximo 8).", { status: 409 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const id = [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const others = [...this.peers.entries()].map(([pid, p]) => ({ id: pid, user: p.user }));
    this.peers.set(id, { ws: server, user, n: 0, t: Date.now() });
    this.send(server, { t: "hola", id, user, peers: others });
    for (const [pid, p] of this.peers) if (pid !== id) this.send(p.ws, { t: "entra", id, user });
    server.addEventListener("message", (ev) => {
      const me = this.peers.get(id);
      if (!me) return;
      const nowMs = Date.now();   // freno: máximo ~400 mensajes por segundo por persona
      if (nowMs - me.t > 1000) { me.t = nowMs; me.n = 0; }
      if (++me.n > 400) return;
      if (typeof ev.data !== "string") {   // binario (audio de respaldo): a todos los demás tal cual
        if (ev.data.byteLength > 65536) return;
        for (const [pid, p] of this.peers) if (pid !== id) { try { p.ws.send(ev.data); } catch {} }
        return;
      }
      if (ev.data.length > 65536) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "ping") return this.send(server, { t: "pong" });
      msg.from = id; msg.user = user;   // el puente pone quién lo manda (no se puede falsificar)
      const to = typeof msg.to === "string" ? msg.to : null;
      const out = JSON.stringify(msg);
      for (const [pid, p] of this.peers) if (pid !== id && (!to || pid === to)) this.send(p.ws, out);
    });
    const gone = () => {
      if (!this.peers.has(id)) return;
      this.peers.delete(id);
      for (const [, p] of this.peers) this.send(p.ws, { t: "sale", id, user });
    };
    server.addEventListener("close", gone); server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
async function callEntry(request, env, url) {
  if (!env.CALL) return new Response("Las llamadas no están activadas en este despliegue.", { status: 503 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Se necesita WebSocket.", { status: 426 });
  const room = url.searchParams.get("room") || "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(room)) return new Response("Llamada no válida.", { status: 400 });
  // sesión ZYH: ?token= (apps) o la cookie de esta web (solo desde esta misma web)
  let token = url.searchParams.get("token") || "";
  if (!token) {
    const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)zyh_session=([a-f0-9]{64})/);
    if (m && request.headers.get("origin") === url.origin) token = m[1];
  }
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Inicia sesión con tu cuenta ZYH.", { status: 401 });
  const u = await env.DB.prepare("SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0")
    .bind(await sha256(token), now()).first();
  if (!u) return new Response("Sesión vencida: vuelve a entrar.", { status: 401 });
  const fwd = new URL(request.url); fwd.searchParams.delete("token");   // el token no pasa al puente
  const headers = new Headers(request.headers); headers.set("x-zyh-user", u.username);
  return env.CALL.get(env.CALL.idFromName(room)).fetch(new Request(fwd.toString(), { headers }));
}
function callIce(env) {
  const ice = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  if (env.TURN_URLS && env.TURN_USER && env.TURN_PASS) ice.push({ urls: String(env.TURN_URLS).split(",").map((x) => x.trim()), username: env.TURN_USER, credential: env.TURN_PASS });
  return json({ iceServers: ice, bridge: "/call" });
}
async function relayEntry(request, env, url) {
  if (!env.RELAY) return new Response("El relay no está activado en este despliegue.", { status: 503 });
  const room = url.searchParams.get("room") || "", role = url.searchParams.get("role") || "";
  if (!/^[a-f0-9]{64}$/.test(room) || (role !== "host" && role !== "ctrl")) return new Response("Sala no válida.", { status: 400 });
  if (env.RELAY_TOKEN && url.searchParams.get("token") !== env.RELAY_TOKEN) return new Response("Token del relay incorrecto.", { status: 403 });
  return env.RELAY.get(env.RELAY.idFromName(room)).fetch(request);
}
// ---- actualizaciones para las apps: GET /api/update/<producto> -> {version, versionCode, releaseDate, changelog, downloads}
function updateInfo(slug, origin, request) {
  let u = UPDATES[slug];
  if (!u) throw new HttpError(404, "No hay actualizaciones para ese producto.");
  // el programa de PC se identifica como "ZYH-Business-Updater": si la versión de PC tiene su propio número, se responde con ese
  if (u.pc && /Updater/i.test(request.headers.get("user-agent") || "")) u = { ...u, version: u.pc.version, versionCode: u.pc.versionCode };
  const downloads = {};
  for (const [k, d] of Object.entries(u.downloads)) downloads[k] = { url: origin + d.url, sha256: d.sha256, sizeBytes: d.sizeBytes };
  return json({ version: u.version, versionCode: u.versionCode, releaseDate: u.releaseDate, changelog: u.changelog, downloads }, 200, { "cache-control": "public, max-age=300" });
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
  if (a === "recover" && !b && m === "POST") return recoverRequest(request, env);
  if (a === "support-tool" && m === "POST") return supportTool(request, env);
  if (a === "recover" && b === "status" && m === "GET") return recoverStatus(env, url);
  const user = await currentUser(request, env);
  if (a === "logout" && m === "POST") {
    if (user) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.token_hash).run();
    return json({ ok: true }, 200, { "set-cookie": "zyh_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
  }
  if (a === "me" && m === "GET") return json({ user: user ? { username: user.username, email: user.email, role: user.role, perms: user.perms, code: code(user.id), owner: user.id === 1,
    must_change: !!(await env.DB.prepare("SELECT 1 FROM pw_resets WHERE user_id = ?").bind(user.id).first()),
    twofa: !!(await env.DB.prepare("SELECT 1 FROM user_2fa WHERE user_id = ? AND enabled = 1").bind(user.id).first()) } : null });
  if (a === "password" && m === "POST") return changePassword(request, env, needUser(user));
  if (a === "2fa") return twofaApi(request, env, needUser(user), b, m);
  if (a === "call" && b === "ice" && m === "GET") { needUser(user); return callIce(env); }
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
  if (a === "update" && b && m === "GET") return updateInfo(b, url.origin, request);
  if (a === "zr") {
    if (b === "send" && m === "POST") return zrSend(request, env, needUser(user));
    if (b === "inbox" && m === "GET") return zrInbox(env, needUser(user), url);
    if (b === "feedback" && m === "POST") return zrFeedback(request, env, needUser(user));
    if (b === "news" && m === "GET") return zrNews(env);
    if (b === "request" && m === "POST") return zrRequest(request, env, needUser(user));
  }
  if (a === "zy") {
    if (b === "pair" && c === "claim" && m === "POST") return zyPairClaim(request, env);
    needUser(user);
    if (b === "me" && m === "GET") return zyMe(env, user);
    if (b === "profile" && m === "PUT") return zyProfile(request, env, user);
    if (b === "wallpaper" && m === "GET") return zyWallpaper(env, user);
    if (b === "contacts" && !c && m === "POST") return zyAddContact(request, env, user);
    if (b === "contacts" && c && m === "DELETE") return zyDelContact(env, user, c);
    if (b === "groups" && !c && m === "POST") return zyJoinGroup(request, env, user);
    if (b === "groups" && c && m === "DELETE") return zyLeaveGroup(env, user, c);
    if (b === "chat" && m === "GET") return zyChat(env, user, url);
    if (b === "send" && m === "POST") return zySend(request, env, user);
    if (b === "voice" && !c && m === "POST") return zySendVoice(request, env, user, url);
    if (b === "voice" && c && m === "GET") return zyVoiceGet(env, user, c);
    if (b === "msg" && c && m === "DELETE") return zyDeleteMsg(env, user, c);
    if (b === "poll" && m === "GET") return zyPoll(env, user, url);
    if (b === "pair" && !c && m === "POST") return zyPairStart(env, user);
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
    if (url.pathname === "/ws") return relayEntry(request, env, url);
    if (url.pathname === "/call") return callEntry(request, env, url);
    return env.ASSETS.fetch(request);     // la web (archivos de /public)
  },
};
