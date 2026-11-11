// ZYH Web — servidor (Cloudflare Workers + D1). ZYH Studios.
// Cuentas ZYH, sesiones, paquetes (icono, imágenes y archivo), licencias y API para las apps.
// La base de datos se crea sola la primera vez. La primera cuenta que se registra es la del dueño (admin).

const SESSION_DAYS_WEB = 30, SESSION_DAYS_APP = 180;
const CHUNK = 512 * 1024;
const LIMITS = { icon: 512 * 1024, image: 2 * 1024 * 1024, package: 15 * 1024 * 1024 };
const PLATFORMS = ["linux", "windows", "zyht32", "otro"];
const PLANS = {
  compressor: { name: "ZYH Compressor", plans: { pro: ["Pro", 2.99, 1], vpro: ["V-Pro", 8.99, 9], vpro_plus: ["V-Pro+", 19.99, 999] }, cycle: "mes" },
  business: { name: "ZYH Business", plans: { pro: ["Pro", 12.99, 4], vpro: ["V-Pro", 29.99, 9], vpro_plus: ["V-Pro+", 59.99, 999] }, cycle: "mes" },
  bridged: { name: "ZYH Bridged", plans: { bridged: ["Minecraft fin de semana", 5, 4], bridged_on: ["Bridged ON", 9, 8], bridged_server: ["Bridged Server", 19, 999] }, cycle: "fin de semana" },
};

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
  if (!schemaReady) schemaReady = env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady = null; throw e; });
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
  return row;
}
const needUser = (u) => { if (!u) throw new HttpError(401, "Inicia sesión con tu cuenta ZYH."); return u; };
const needAdmin = (u) => { needUser(u); if (u.role !== "admin") throw new HttpError(403, "Solo el administrador puede hacer esto."); return u; };

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
  if (!pub && !(user && (user.role === "admin" || user.id === file.owner_id))) throw new HttpError(404, "No existe.");
  return streamFile(env, file, { "cache-control": pub ? "public, max-age=86400" : "private, no-store" });
}

// ------------------------------------------------------------------ paquetes
const pkgPublic = (p) => ({ id: p.id, slug: p.slug, name: p.name, summary: p.summary, version: p.version, platform: p.platform, status: p.status,
  icon: p.icon_file ? `/api/files/${p.icon_file}` : "", downloads: p.downloads, updated_at: p.updated_at, owner: p.owner, has_file: !!(p.file_id || p.external_url), size: p.size || 0 });

async function listPackages(env, user, url) {
  const where = [], args = [];
  const scope = url.searchParams.get("scope");
  if (scope === "mine") { needUser(user); where.push("p.owner_id = ?"); args.push(user.id); }
  else if (scope === "all") { needAdmin(user); }
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
  const mine = user && (user.role === "admin" || user.id === p.owner_id);
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
  if (!f || !kinds.includes(f.kind) || (f.owner_id !== user.id && user.role !== "admin")) throw new HttpError(400, "Archivo no válido.");
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
  const status = user.role === "admin" ? "publicado" : "pendiente";      // lo de otras personas espera aprobación
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

// ------------------------------------------------------------------ administración
async function admin(request, env, user, parts, url) {
  needAdmin(user);
  const [section, id, action] = parts, m = request.method;
  if (section === "users" && m === "GET") {
    const rows = await env.DB.prepare("SELECT id, username, email, role, disabled, created_at FROM users ORDER BY id LIMIT 500").all();
    return json({ users: rows.results });
  }
  if (section === "users" && id && m === "POST") {
    const body = await request.json().catch(() => ({}));
    if (Number(id) === user.id) throw new HttpError(400, "No puedes cambiar tu propia cuenta desde aquí.");
    if (body.role !== undefined) { if (!["user", "admin"].includes(body.role)) throw new HttpError(400, "Rol no válido."); await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, Number(id)).run(); }
    if (body.disabled !== undefined) {
      await env.DB.batch([env.DB.prepare("UPDATE users SET disabled = ? WHERE id = ?").bind(body.disabled ? 1 : 0, Number(id)), env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(Number(id))]);
    }
    return json({ ok: true });
  }
  if (section === "licenses" && m === "GET") {
    const rows = await env.DB.prepare("SELECT l.*, u.username, (SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id) AS used FROM licenses l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 500").all();
    return json({ licenses: rows.results.map((l) => ({ id: l.id, username: l.username, product: l.product, plan: l.plan, plan_name: PLANS[l.product]?.plans[l.plan]?.[0] || l.plan, devices: l.devices, used: l.used, expires: l.expires_at, note: l.note, active: l.expires_at > now() })) });
  }
  if (section === "licenses" && !id && m === "POST") {
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
    await env.DB.prepare("DELETE FROM devices WHERE license_id = ?").bind(Number(id)).run(); return json({ ok: true });
  }
  if (section === "licenses" && id && m === "DELETE") {
    await env.DB.batch([env.DB.prepare("DELETE FROM devices WHERE license_id = ?").bind(Number(id)), env.DB.prepare("DELETE FROM licenses WHERE id = ?").bind(Number(id))]);
    return json({ ok: true });
  }
  if (section === "packages" && id && action === "status" && m === "POST") {
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
  if (a === "config") return json({ plans: PLANS, platforms: PLATFORMS, limits: LIMITS, min_password: 8 });
  if (a === "register" && m === "POST") return register(request, env);
  if (a === "login" && m === "POST") return login(request, env);
  const user = await currentUser(request, env);
  if (a === "logout" && m === "POST") {
    if (user) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.token_hash).run();
    return json({ ok: true }, 200, { "set-cookie": "zyh_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
  }
  if (a === "me" && m === "GET") return json({ user: user ? { username: user.username, email: user.email, role: user.role } : null });
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
