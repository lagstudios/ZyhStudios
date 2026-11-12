// ZYH Web — interfaz. ZYH Studios.
"use strict";

const state = { user: null, config: null, apps: [] };
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) n.append(k?.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const view = () => $("#view");

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

async function api(path, { method = "GET", body, raw } = {}) {
  const opt = { method, headers: {}, credentials: "same-origin" };
  if (raw) { opt.body = raw; }
  else if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch("/api/" + path, opt);
  const data = r.headers.get("content-type")?.includes("json") ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

// La contraseña nunca viaja tal cual: se deriva en el navegador (PBKDF2) y se envía solo el resultado.
async function derive(username, password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode("zyh-account:" + username.toLowerCase()), iterations: 200000, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" }) : "—";
const fmtSize = (n) => !n ? "" : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const PLATFORM_NAMES = { linux: "Linux", windows: "Windows", zyht32: "ZYHT32", otro: "Otro" };
const STATUS = { publicado: ["ok", "Publicado"], pendiente: ["warn", "Esperando aprobación"], rechazado: ["bad", "Rechazado"] };

// ------------------------------------------------------------------ navegación
function appsMenu() {
  const lastV = (p) => p.versiones[p.versiones.length - 1].version;
  const box = el("div", { className: "dd" }, el("button", { type: "button", className: "dd-b", textContent: "Apps ▾", "aria-haspopup": "true" }));
  const list = el("div", { className: "dd-l", role: "menu" });
  if (state.apps.length) list.append(...state.apps.map((p) => el("a", { href: `/productos/${p.slug}/${lastV(p)}/`, role: "menuitem" },
    el("img", { src: p.logo, alt: "", width: 28, height: 28 }), el("span", {}, p.nombre))),
    el("a", { href: "/productos/", className: "dd-all", textContent: "Ver todas las apps" }));
  else list.append(el("span", { className: "dd-empty", textContent: "Muy pronto: las apps llegan aquí." }));
  box.append(list);
  box.firstChild.onclick = (e) => { e.stopPropagation(); box.classList.toggle("open"); };
  return box;
}
document.addEventListener("click", () => document.querySelectorAll(".dd.open").forEach((d) => d.classList.remove("open")));
function renderNav() {
  const nav = $("#nav"), u = state.user, hash = location.hash || "#/";
  const pre = [["#/", "Inicio"]], post = [["#/tienda", "Tienda ZYHT32"], ["#/paquetes", "Paquetes"]];
  if (u) post.push(["#/cuenta", "Mi cuenta"]);
  if (u?.perms?.length) post.push(["#/admin", "Administrar"]);
  const a = ([href, text]) => el("a", { href, textContent: text, className: hash.startsWith(href) && (href !== "#/" || hash === "#/") ? "on" : "" });
  nav.replaceChildren(...pre.map(a), appsMenu(), ...post.map(a),
    u ? el("a", { href: "#/cuenta", className: "cta", textContent: u.username })
      : el("a", { href: "#/entrar", className: "cta", textContent: "Entrar" }));
  nav.classList.remove("open");
}

const routes = {};
async function render() {
  const [path, arg] = (location.hash.replace(/^#\/?/, "") || "").split("/");
  const fn = routes[path] || routes[""];
  renderNav();
  view().replaceChildren(el("p", { className: "muted", textContent: "Cargando…" }));
  try {
    const node = await fn(arg);
    view().replaceChildren(node);
  } catch (e) {
    view().replaceChildren(el("div", { className: "box" }, el("h2", {}, "Algo salió mal"), el("p", { className: "err", textContent: e.message })));
  }
  view().focus({ preventScroll: true });
  if (!location.hash.includes("#/paquete/")) scrollTo(0, 0);
}

// ------------------------------------------------------------------ inicio
routes[""] = async () => {
  const frag = document.createDocumentFragment();
  frag.append(
    el("section", { className: "hero" },
      el("div", { className: "z", textContent: "Z" }),
      el("h1", {}, "ZyhStudios"),
      el("p", {}, "Apps de escritorio, el firmware ZYHT32 y los paquetes de la comunidad. Una sola cuenta ZYH para todo."),
      el("div", { className: "row", style: "justify-content:center" },
        el("a", { className: "btn", href: "/productos/", textContent: "Ver los productos" }),
        el("a", { className: "btn ghost", href: "#/paquetes", textContent: "Explorar paquetes" }))));
  try {      // enlace de TikTok: lo cambia el equipo desde Administrar
    const { site } = await api("site");
    if (site?.tiktok_url) frag.querySelector(".hero .row").append(el("a", { className: "btn ghost", href: site.tiktok_url, target: "_blank", rel: "noopener noreferrer", textContent: "♪ " + (site.tiktok_text || "TikTok") }));
  } catch { /* sin enlace */ }
  // Videos y zonas salen de las carpetas (manifiesto.json lo arma tools/build.mjs).
  let m = null;
  try { m = await (await fetch("/manifiesto.json")).json(); } catch { /* sin manifiesto: solo la portada */ }
  const vid = (v, auto) => el("figure", { className: "vfig" },
    el("video", { src: v.url, controls: true, preload: "metadata", playsInline: true, muted: !!auto, loop: !!auto, autoplay: !!auto, className: "vid" }),
    v.titulo ? el("figcaption", { className: "small muted", textContent: v.titulo }) : "");
  const prods = m?.productos || [];
  frag.append(el("h2", { className: "sec" }, "Nuestras apps"));
  if (!prods.length) frag.append(el("div", { className: "empty-apps" }, el("div", { className: "z", textContent: "Z", style: "font-size:64px;line-height:1" }),
    el("h3", {}, "Muy pronto"), el("p", { className: "muted" }, "Las apps de ZYH Studios llegan aquí. Mientras tanto crea tu cuenta ZYH y síguenos en TikTok.")));
  else frag.append(el("div", { className: "apps-grid" }, ...prods.map((p) => {
    const lv = p.versiones[p.versiones.length - 1], cover = lv.imagenes?.[0];
    const price = p.gratis ? "Gratis" : p.planes.length ? "Desde US$" + Math.min(...p.planes.map((x) => x.usd)).toFixed(2) : "";
    return el("a", { className: "appcard", href: `/productos/${p.slug}/${lv.version}/` },
      el("div", { className: "ac-cover", style: cover ? `background-image:url('${cover}')` : "" }, cover ? "" : el("img", { src: p.logo, alt: "", width: 72, height: 72 })),
      el("div", { className: "ac-body" }, el("div", { className: "ac-head" }, el("img", { src: p.logo, alt: "", width: 40, height: 40 }), el("h3", {}, p.nombre)),
        el("p", { className: "muted small", textContent: p.descripcion }),
        el("div", { className: "ac-foot" }, el("span", { className: "tag", textContent: p.compatible.join(" · ") }), price ? el("span", { className: "tag " + (p.gratis ? "ok" : "warn"), textContent: price }) : "",
          el("span", { className: "ac-go", textContent: "Ver →" }))));
  })));
  if (m?.videos.items.length) {
    const c = m.videos.config;
    frag.append(el("h2", {}, c.titulo), el("div", { className: "vgrid" }, ...m.videos.items.map((v) => vid(v, c.autoplay))));
  }
  for (const p of prods.filter((x) => x.versiones[x.versiones.length - 1].videos.length)) {
    const lv = p.versiones[p.versiones.length - 1];
    frag.append(el("section", { className: "zona" },
      el("div", { className: "row", style: "justify-content:space-between" },
        el("h2", { style: "margin:0" }, p.nombre), el("a", { className: "btn sm", href: `/productos/${p.slug}/${lv.version}/`, textContent: "Ver " + p.nombre })),
      el("p", { className: "muted" }, p.descripcion),
      lv.videos.length ? el("div", { className: "vgrid" }, ...lv.videos.map((v) => vid(v, false))) : ""));
  }
  if (!m) frag.append(el("h2", {}, "Qué encuentras aquí"));
  return frag;
};

// ------------------------------------------------------------------ apps
const APPS = [
  ["ZYH Browser", "Navegador con pestañas, descargas y ajustes. Gratis.", "Gratis"],
  ["ZYH Compressor", "Comprime con tres algoritmos y verifica cada archivo.", "Desde US$2.99/mes"],
  ["ZYH Business", "Inventario, ventas y una IA que atiende tu WhatsApp.", "Desde US$12.99/mes"],
  ["ZYH Bridged", "Juega en red con tus amigos. Emparejamiento cifrado.", "Desde US$5"],
  ["ZYH ZVID", "Convierte videos al formato de la pantalla del ZYHT32.", "Gratis"],
  ["ZYHT32 IDE", "Programa y actualiza tu ZYHT32 en un clic.", "Gratis"],
];
routes["apps"] = async () => { location.replace("/productos/"); return el("p", {}); };
const _appsViejo = async () => {
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Apps de ZYH Studios"),
    el("p", { className: "muted" }, "Descarga el instalador desde la sección de paquetes; cada app pide tu cuenta ZYH para activar el plan."),
    el("div", { className: "grid" }, ...APPS.map(([n, d, p]) =>
      el("div", { className: "card" }, el("h3", {}, n), el("p", { className: "muted", textContent: d }), el("span", { className: "tag", textContent: p })))),
    el("p", { className: "small muted", style: "margin-top:18px" }, "¿Ya tienes una app instalada? Entra con tu cuenta ZYH desde la propia app para activar tu plan."));
  return frag;
};

// ------------------------------------------------------------------ paquetes
function pkgCard(p) {
  const icon = p.icon ? el("img", { src: p.icon, alt: "", loading: "lazy", width: 56, height: 56 })
    : el("div", { className: "icon-ph", textContent: p.name[0].toUpperCase() });
  const tags = [el("span", { className: "tag", textContent: PLATFORM_NAMES[p.platform] || p.platform }), el("span", { className: "tag", textContent: "v" + p.version })];
  if (p.status !== "publicado") tags.unshift(el("span", { className: "tag " + STATUS[p.status][0], textContent: STATUS[p.status][1] }));
  return el("a", { className: "card pkg", href: "#/paquete/" + p.slug }, icon,
    el("div", {}, el("h3", {}, p.name), el("p", { className: "muted small", textContent: p.summary || "" }), el("div", { style: "margin-top:6px" }, ...tags)));
}

routes["paquetes"] = async () => {
  const frag = document.createDocumentFragment();
  const q = el("input", { type: "search", placeholder: "Buscar paquete…", value: "" });
  const list = el("div", { className: "grid" });
  let platform = "";
  const chips = el("div", { className: "filters" }, q,
    ...[["", "Todos"], ...PLATFORMS_ORDER].map(([v, t]) => {
      const b = el("button", { className: "chip" + (v === "" ? " on" : ""), textContent: t, type: "button" });
      b.onclick = () => { platform = v; [...chips.querySelectorAll(".chip")].forEach((c) => c.classList.toggle("on", c === b)); load(); };
      return b;
    }));
  async function load() {
    list.replaceChildren(el("p", { className: "muted" }, "Cargando…"));
    const u = new URLSearchParams(); if (platform) u.set("platform", platform); if (q.value.trim()) u.set("q", q.value.trim());
    const { packages } = await api("packages?" + u);
    list.replaceChildren(...(packages.length ? packages.map(pkgCard)
      : [el("p", { className: "muted" }, "Todavía no hay paquetes publicados aquí.")]));
  }
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  frag.append(el("div", { className: "row", style: "justify-content:space-between" }, el("h1", {}, "Paquetes"),
    state.user ? el("a", { className: "btn", href: "#/subir", textContent: "＋ Subir paquete" }) : el("a", { className: "btn ghost", href: "#/entrar", textContent: "Entrar para subir" })),
    chips, list);
  load();
  return frag;
};
const PLATFORMS_ORDER = [["linux", "Linux"], ["windows", "Windows"], ["zyht32", "ZYHT32"], ["otro", "Otro"]];

routes["paquete"] = async (slug) => {
  const { package: p } = await api("packages/" + encodeURIComponent(slug));
  const frag = document.createDocumentFragment();
  const head = el("div", { className: "pkg", style: "gap:16px;align-items:center" },
    p.icon ? el("img", { src: p.icon, alt: "", width: 56, height: 56 }) : el("div", { className: "icon-ph", textContent: p.name[0].toUpperCase() }),
    el("div", {}, el("h1", { style: "margin:0" }, p.name), el("p", { className: "muted", textContent: p.summary || "" })));
  const tags = el("div", { style: "margin:10px 0" },
    el("span", { className: "tag", textContent: PLATFORM_NAMES[p.platform] || p.platform }),
    el("span", { className: "tag", textContent: "v" + p.version }),
    el("span", { className: "tag", textContent: "por " + p.owner }),
    el("span", { className: "tag", textContent: p.downloads + " descargas" }),
    ...(p.status !== "publicado" ? [el("span", { className: "tag " + STATUS[p.status][0], textContent: STATUS[p.status][1] })] : []));
  const actions = el("div", { className: "row" });
  if (p.has_file) actions.append(el("a", { className: "btn", href: "/api/packages/" + p.slug + "/download", textContent: "Descargar" + (p.size ? ` (${fmtSize(p.size)})` : "") }));
  if (p.can_edit) {
    actions.append(el("a", { className: "btn ghost", href: "#/editar/" + p.slug, textContent: "Editar" }));
    const del = el("button", { className: "btn danger", textContent: "Borrar", type: "button" });
    del.onclick = async () => {
      if (!confirm(`¿Borrar el paquete "${p.name}"? No se puede deshacer.`)) return;
      await api("packages/" + p.slug, { method: "DELETE" }); toast("Paquete borrado."); location.hash = "#/paquetes";
    };
    actions.append(del);
  }
  frag.append(head, tags, actions);
  if (p.review_note) frag.append(el("p", { className: "err", textContent: "Nota de revisión: " + p.review_note }));
  if (p.images?.length) frag.append(el("div", { className: "shots" }, ...p.images.map((src) => el("img", { src, alt: "", loading: "lazy" }))));
  if (p.description) frag.append(el("h2", {}, "Descripción"), el("p", { className: "desc", textContent: p.description }));
  frag.append(el("p", { className: "small muted", style: "margin-top:20px" },
    "Los paquetes de la comunidad los sube cada autor; ZYH Studios los revisa antes de publicarlos, pero no responde por su contenido."));
  return frag;
};

// ------------------------------------------------------------------ subir / editar paquete
async function uploadFile(file, kind) {
  const max = state.config.limits[kind];
  if (file.size > max) throw new Error(`"${file.name}" pesa ${fmtSize(file.size)} y el máximo es ${fmtSize(max)}.`);
  const r = await api(`upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, { method: "POST", raw: file });
  return r.id;
}

async function packageForm(slug) {
  if (!state.user) { location.hash = "#/entrar"; return el("p", {}, "Necesitas entrar."); }
  const existing = slug ? (await api("packages/" + encodeURIComponent(slug))).package : null;
  const f = el("form", { className: "box wide" });
  const field = (label, node, hint) => { f.append(el("label", { textContent: label }), node); if (hint) f.append(el("p", { className: "hint", textContent: hint })); return node; };
  const name = field("Nombre del paquete", el("input", { required: true, maxLength: 60, value: existing?.name || "" }));
  const summary = field("Resumen corto", el("input", { maxLength: 140, value: existing?.summary || "", placeholder: "Una línea que explique qué hace" }));
  const version = field("Versión", el("input", { maxLength: 20, value: existing?.version || "1.0" }));
  const platform = field("Plataforma", el("select", {}, ...PLATFORMS_ORDER.map(([v, t]) => el("option", { value: v, textContent: t, selected: existing?.platform === v }))));
  const description = field("Descripción", el("textarea", { maxLength: 5000, value: existing?.description || "" }));
  const icon = field("Icono (PNG o JPG)", el("input", { type: "file", accept: "image/*" }), existing?.icon_id ? "Ya tiene icono. Elige otro solo si quieres cambiarlo." : `Máximo ${fmtSize(state.config.limits.icon)}.`);
  const images = field("Imágenes (hasta 5)", el("input", { type: "file", accept: "image/*", multiple: true }),
    existing?.image_ids?.length ? `Tiene ${existing.image_ids.length}. Si eliges nuevas, reemplazan a las anteriores.` : `Máximo ${fmtSize(state.config.limits.image)} cada una.`);
  const file = field("Archivo del paquete", el("input", { type: "file" }),
    existing?.file_id ? `Ya tiene archivo (${existing.file_name}). Elige otro solo si quieres cambiarlo.` : `Máximo ${fmtSize(state.config.limits.package)}. Si pesa más, usa el enlace de abajo.`);
  const external = field("…o enlace de descarga (https)", el("input", { type: "url", value: existing?.external_url || "", placeholder: "https://github.com/usuario/proyecto/releases/…" }));
  const err = el("p", { className: "err" });
  const submit = el("button", { className: "btn", type: "submit", textContent: slug ? "Guardar cambios" : "Subir paquete" });
  f.append(el("div", { className: "row", style: "margin-top:18px" }, submit), err);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = ""; submit.disabled = true; submit.textContent = "Subiendo…";
    try {
      const body = { name: name.value, summary: summary.value, description: description.value, version: version.value,
        platform: platform.value, external_url: external.value.trim(),
        icon_id: existing?.icon_id || "", file_id: existing?.file_id || "", image_ids: existing?.image_ids || [] };
      if (icon.files[0]) body.icon_id = await uploadFile(icon.files[0], "icon");
      if (file.files[0]) body.file_id = await uploadFile(file.files[0], "package");
      if (images.files.length) { body.image_ids = []; for (const im of [...images.files].slice(0, 5)) body.image_ids.push(await uploadFile(im, "image")); }
      const r = await api(slug ? "packages/" + slug : "packages", { method: slug ? "PUT" : "POST", body });
      toast(r.status === "publicado" ? "Paquete publicado." : "Paquete enviado: ZYH Studios lo revisará antes de publicarlo.");
      location.hash = "#/cuenta";
    } catch (e2) { err.textContent = e2.message; }
    submit.disabled = false; submit.textContent = slug ? "Guardar cambios" : "Subir paquete";
  };
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, slug ? "Editar paquete" : "Subir un paquete"),
    el("p", { className: "muted" }, state.user.perms?.includes("paquetes.revisar") ? "Con tu rol, tus paquetes se publican al instante."
      : "Tu paquete queda esperando aprobación; ZYH Studios lo revisa y luego aparece en la lista."), f);
  return frag;
}
routes["subir"] = () => packageForm(null);
routes["editar"] = (slug) => packageForm(slug);

// ------------------------------------------------------------------ planes
routes["planes"] = async () => { location.replace("/productos/"); return el("p", {}); };

// ------------------------------------------------------------------ entrar / crear cuenta
routes["entrar"] = async () => {
  if (state.user) { location.hash = "#/cuenta"; return el("p", {}); }
  let mode = "login";
  const frag = document.createDocumentFragment();
  const f = el("form", { className: "box" });
  const title = el("h1", { className: "center" }, "Entrar");
  const user = el("input", { required: true, autocomplete: "username", minLength: 3, maxLength: 32, placeholder: "tu usuario" });
  const pass = el("input", { type: "password", required: true, autocomplete: "current-password", minLength: 8, maxLength: 72 });
  const email = el("input", { type: "email", autocomplete: "email", maxLength: 120, placeholder: "opcional, para recuperar tu cuenta" });
  const emailWrap = el("div", { hidden: true }, el("label", {}, "Correo"), email);
  const err = el("p", { className: "err" });
  const submit = el("button", { className: "btn", type: "submit", style: "width:100%", textContent: "Entrar" });
  const swap = el("button", { className: "btn ghost", type: "button", style: "width:100%;margin-top:8px", textContent: "Crear una cuenta ZYH" });
  f.append(el("label", {}, "Usuario"), user, el("p", { className: "hint" }, "3 a 32 caracteres: letras, números, punto, guion o guion bajo."),
    el("label", {}, "Contraseña"), pass, el("p", { className: "hint" }, "Mínimo 8 caracteres."), emailWrap,
    el("div", { style: "margin-top:16px" }, submit), swap, err);
  swap.onclick = () => {
    mode = mode === "login" ? "register" : "login";
    const reg = mode === "register";
    title.textContent = reg ? "Crear cuenta ZYH" : "Entrar";
    submit.textContent = reg ? "Crear cuenta" : "Entrar";
    swap.textContent = reg ? "Ya tengo cuenta" : "Crear una cuenta ZYH";
    emailWrap.hidden = !reg; pass.autocomplete = reg ? "new-password" : "current-password"; err.textContent = "";
  };
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    if (pass.value.length < 8) { err.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
    submit.disabled = true; const was = submit.textContent; submit.textContent = "Un momento…";
    try {
      const dk = await derive(user.value.trim(), pass.value);
      const body = { username: user.value.trim(), dk };
      if (mode === "register") body.email = email.value.trim();
      const r = await api(mode === "register" ? "register" : "login", { method: "POST", body });
      state.user = (await api("me")).user || r.user; toast(mode === "register" ? `Cuenta creada. ¡Hola, ${r.user.username}!` : `Hola, ${r.user.username}`);
      location.hash = "#/cuenta";
    } catch (e2) { err.textContent = e2.message; }
    submit.disabled = false; submit.textContent = was;
  };
  frag.append(title, f);
  return frag;
};

// ------------------------------------------------------------------ mi cuenta
routes["cuenta"] = async () => {
  if (!state.user) { location.hash = "#/entrar"; return el("p", {}); }
  const [{ licenses }, { packages }] = await Promise.all([api("licenses"), api("packages?scope=mine")]);
  const frag = document.createDocumentFragment();
  const out = el("button", { className: "btn ghost sm", textContent: "Cerrar sesión", type: "button" });
  out.onclick = async () => { await api("logout", { method: "POST" }); state.user = null; toast("Sesión cerrada."); location.hash = "#/"; };
  frag.append(el("div", { className: "row", style: "justify-content:space-between" },
    el("h1", {}, state.user.username, state.user.code ? el("small", { className: "muted", style: "font-size:.5em;margin-left:10px" }, "ID " + state.user.code) : ""), el("div", { className: "row" }, el("span", { className: "tag", textContent: state.user.role === "admin" ? "administrador" : "cuenta ZYH" }), out)));

  frag.append(el("h2", {}, "Mis licencias"));
  if (!licenses.length) {
    frag.append(el("p", { className: "muted" }, "Todavía no tienes planes. ", el("a", { href: "/productos/" }, "Ver productos"), "."));
  } else {
    frag.append(el("div", { className: "scroll" }, el("table", {},
      el("thead", {}, el("tr", {}, ...["Producto", "Plan", "Dispositivos", "Vence", ""].map((t) => el("th", {}, t)))),
      el("tbody", {}, ...licenses.map((l) => el("tr", {},
        el("td", {}, l.product_name), el("td", {}, l.plan_name),
        el("td", {}, `${l.used} de ${l.devices >= 999 ? "ilimitados" : l.devices}`), el("td", {}, fmtDate(l.expires)),
        el("td", {}, el("span", { className: "tag " + (l.active ? "ok" : "bad"), textContent: l.active ? "activa" : "vencida" }))))))));
    frag.append(el("p", { className: "small muted" }, "Para activar el plan en una app, entra con tu cuenta ZYH desde la propia app."));
  }

  frag.append(el("div", { className: "row", style: "justify-content:space-between;margin-top:26px" },
    el("h2", { style: "margin:0" }, "Mis paquetes"), el("a", { className: "btn sm", href: "#/subir", textContent: "＋ Subir paquete" })));
  frag.append(packages.length ? el("div", { className: "grid", style: "margin-top:12px" }, ...packages.map(pkgCard))
    : el("p", { className: "muted" }, "Aún no has subido paquetes."));

  frag.append(await accountSettings(licenses));

  // cambiar contraseña
  const f = el("form", { className: "box", style: "margin-top:26px" });
  const oldp = el("input", { type: "password", required: true, autocomplete: "current-password", maxLength: 72 });
  const newp = el("input", { type: "password", required: true, autocomplete: "new-password", minLength: 8, maxLength: 72 });
  const err = el("p", { className: "err" });
  const btn = el("button", { className: "btn", type: "submit", textContent: "Cambiar contraseña" });
  f.append(el("h2", { style: "margin-top:0" }, "Cambiar contraseña"), el("label", {}, "Contraseña actual"), oldp,
    el("label", {}, "Contraseña nueva"), newp, el("p", { className: "hint" }, "Mínimo 8 caracteres. Se cerrarán tus otras sesiones."),
    el("div", { style: "margin-top:14px" }, btn), err);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    if (newp.value.length < 8) { err.textContent = "La contraseña nueva debe tener al menos 8 caracteres."; return; }
    btn.disabled = true;
    try {
      await api("password", { method: "POST", body: { old_dk: await derive(state.user.username, oldp.value), new_dk: await derive(state.user.username, newp.value) } });
      toast("Contraseña cambiada."); f.reset();
    } catch (e2) { err.textContent = e2.message; }
    btn.disabled = false;
  };
  frag.append(f);
  return frag;
};

// ------------------------------------------------------------------ configuración de la cuenta ZYH
async function accountSettings(licenses) {
  const [{ sessions }, { links }, { payments }] = await Promise.all([api("account/sessions"), api("account/links"), api("payments")]);
  const wrap = el("section", { style: "margin-top:26px" });
  wrap.append(el("h2", {}, "Configuración de tu cuenta ZYH"),
    el("div", { className: "box wide" }, el("h3", { style: "margin-top:0" }, "Acerca de la cuenta ZYH"),
      el("p", { className: "small" }, "Una sola cuenta para la web y todas las apps de ZYH Studios (Compressor, Business, Bridged, Browser, ZVID y ZYHT32 IDE). Tu contraseña nunca sale de tu equipo: se convierte en una clave cifrada antes de enviarse, y todo viaja por HTTPS. En las apps, tu sesión se guarda cifrada (AES-256) y atada a ese equipo."),
      el("p", { className: "small muted" }, "ID de tu cuenta: ", el("code", {}, state.user.code || "—"))));

  // apps y sesiones conectadas
  const sb = el("div", { className: "box wide", style: "margin-top:14px" }, el("h3", { style: "margin-top:0" }, "Apps y sesiones conectadas"));
  sb.append(el("div", { className: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Dónde", "Tipo", "Desde", ""].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...sessions.map((x) => el("tr", {}, el("td", {}, x.label), el("td", {}, x.kind === "app" ? "App" : "Web"), el("td", {}, fmtDate(x.created_at)),
      el("td", {}, x.current ? el("span", { className: "tag ok", textContent: "esta sesión" }) : el("button", { className: "btn danger sm", type: "button", textContent: "Cerrar",
        onclick: async () => { await api("account/sessions/" + x.id, { method: "DELETE" }); toast("Sesión cerrada."); render(); } }))))))));
  if (sessions.some((x) => x.kind === "app")) sb.append(el("div", { style: "margin-top:10px" }, el("button", { className: "btn ghost sm", type: "button", textContent: "Cerrar la sesión en todas las apps",
    onclick: async () => { if (!confirm("Tendrás que volver a entrar en cada app.")) return; await api("account/sessions/apps", { method: "DELETE" }); toast("Apps desconectadas."); render(); } })));
  wrap.append(sb);

  // Zyphora
  const z = links.find((l) => l.provider === "zyphora");
  const zb = el("div", { className: "box wide", style: "margin-top:14px" }, el("h3", { style: "margin-top:0" }, "Vincular con Zyphora"));
  if (z && z.external) {
    zb.append(el("p", {}, "Vinculada con ", el("code", {}, z.external), " ", el("span", { className: "tag " + (z.verified ? "ok" : "warn"), textContent: z.verified ? "verificada" : "sin verificar" })),
      el("button", { className: "btn ghost sm", type: "button", textContent: "Desvincular", onclick: async () => { await api("account/link-zyphora", { method: "DELETE" }); toast("Desvinculada."); render(); } }));
  } else {
    const zid = el("input", { placeholder: "tu usuario o ID de Zyphora", maxLength: 60 });
    const out = el("p", { className: "small" });
    zb.append(el("p", { className: "small muted" }, "Guarda tu usuario de Zyphora, o genera un código y escríbelo en Zyphora para verificar que la cuenta es tuya."),
      el("div", { className: "row" }, zid, el("button", { className: "btn sm", type: "button", textContent: "Vincular", onclick: async () => {
        try { await api("account/link-zyphora", { method: "POST", body: { zyphora_id: zid.value.trim() } }); toast("Vinculada (sin verificar)."); render(); } catch (e) { out.textContent = e.message; } } }),
        el("button", { className: "btn ghost sm", type: "button", textContent: "Generar código de verificación", onclick: async () => {
          try { const r = await api("account/link-zyphora/code", { method: "POST", body: {} }); out.textContent = "Tu código: " + r.code + " (vale 10 minutos). Escríbelo en Zyphora."; } catch (e) { out.textContent = e.message; } } })), out);
  }
  wrap.append(zb);

  // Ya pagué
  const pf = el("form", { className: "box wide", style: "margin-top:14px" });
  const prod = el("select", {}, ...Object.entries(state.config.plans).map(([k, v]) => el("option", { value: k, textContent: v.name })));
  const plan = el("select", {}), ref = el("input", { required: true, placeholder: "ID de la transacción de PayPal", maxLength: 60 });
  const num = el("input", { placeholder: "Número desde el que pagaste (opcional)", maxLength: 30, inputMode: "tel" });
  const perr = el("p", { className: "err" });
  const fillp = () => plan.replaceChildren(...Object.entries((state.config.plans[prod.value]?.plans || {})).map(([k, v]) => el("option", { value: k, textContent: `${v[0]} — US$${v[1]}` })));
  prod.onchange = fillp; fillp();
  pf.append(el("h3", { style: "margin-top:0" }, "Ya pagué: avisar mi pago"), el("p", { className: "small muted" }, "Después de pagar en PayPal, pega aquí el ID de la transacción. Una persona del equipo lo revisa y activa tu plan. Tu número se guarda cifrado y solo lo ve Recursos humanos."),
    el("label", {}, "Producto"), prod, el("label", {}, "Plan"), plan, el("label", {}, "ID de transacción"), ref, el("label", {}, "Número (opcional)"), num,
    el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Enviar pago a revisión" })), perr);
  pf.onsubmit = async (e) => { e.preventDefault(); perr.textContent = "";
    try { await api("payments", { method: "POST", body: { product: prod.value, plan: plan.value, reference: ref.value, payer_number: num.value } }); toast("Pago enviado a revisión."); render(); } catch (e2) { perr.textContent = e2.message; } };
  wrap.append(pf);
  if (payments.length) wrap.append(el("div", { className: "scroll", style: "margin-top:10px" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Fecha", "Plan", "ID", "Estado"].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...payments.map((p) => el("tr", {}, el("td", {}, fmtDate(p.created_at)), el("td", {}, `${p.product_name} · ${p.plan_name}`), el("td", {}, el("code", {}, p.reference)),
      el("td", {}, el("span", { className: "tag " + (p.status === "correcta" ? "ok" : p.status === "rechazada" ? "bad" : "warn"), textContent: p.status }), p.note ? " " + p.note : "")))))));
  return wrap;
}

// ------------------------------------------------------------------ administración
routes["admin"] = async () => {
  if (!state.user?.perms?.length) { location.hash = "#/"; return el("p", {}); }
  const can = (p) => state.user.perms?.includes(p);
  const [{ licenses }, { packages }, rolesData] = await Promise.all([can("cuentas.ver") ? api("admin/licenses") : { licenses: [] }, can("paquetes.revisar") ? api("packages?scope=all") : { packages: [] }, can("cuentas.ver") ? api("admin/roles") : { roles: [], perms: {} }]);
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Administrar"), el("p", {}, el("a", { className: "btn ghost sm", href: "#/admin-tienda", textContent: "Tienda ZYHT32 (publicar y ganancias)" })));

  // --- dar un plan
  const f = el("form", { className: "box wide" });
  const u = el("input", { required: true, placeholder: "usuario ZYH", maxLength: 40 });
  const prod = el("select", {}, ...Object.entries(state.config.plans).map(([k, v]) => el("option", { value: k, textContent: v.name })));
  const plan = el("select", {});
  const days = el("input", { type: "number", value: "30", min: "1", max: "3660" });
  const extra = el("input", { type: "number", value: "0", min: "0", max: "999" });
  const note = el("input", { maxLength: 200, placeholder: "referencia del pago (opcional)" });
  const err = el("p", { className: "err" });
  const fillPlans = () => plan.replaceChildren(...Object.entries((state.config.plans[prod.value]?.plans || {})).map(([k, v]) => el("option", { value: k, textContent: `${v[0]} — US$${v[1]}` })));
  prod.onchange = fillPlans; fillPlans();
  f.append(el("h2", { style: "margin-top:0" }, "Dar un plan a una cuenta"),
    el("label", {}, "Usuario"), u, el("label", {}, "Producto"), prod, el("label", {}, "Plan"), plan,
    el("label", {}, "Días"), days, el("label", {}, "Dispositivos extra"), extra, el("label", {}, "Nota"), note,
    el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Activar plan" })), err);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    try {
      await api("admin/licenses", { method: "POST", body: { username: u.value.trim(), product: prod.value, plan: plan.value, days: +days.value, extra_devices: +extra.value, note: note.value } });
      toast("Plan activado."); render();
    } catch (e2) { err.textContent = e2.message; }
  };
  if (can("planes.dar")) frag.append(f);

  // --- paquetes por revisar
  if (can("paquetes.revisar")) {
  frag.append(el("h2", {}, "Paquetes"));
  const pend = packages.filter((p) => p.status === "pendiente");
  frag.append(el("p", { className: "muted small" }, pend.length ? `${pend.length} esperando aprobación.` : "Nada pendiente por revisar."));
  frag.append(el("div", { className: "grid" }, ...packages.slice(0, 40).map((p) => {
    const card = el("div", { className: "card" }, el("h3", {}, p.name),
      el("p", { className: "small muted", textContent: `por ${p.owner} · ${PLATFORM_NAMES[p.platform]} · v${p.version}` }),
      el("span", { className: "tag " + STATUS[p.status][0], textContent: STATUS[p.status][1] }));
    const row = el("div", { className: "row", style: "margin-top:10px" }, el("a", { className: "btn ghost sm", href: "#/paquete/" + p.slug, textContent: "Ver" }));
    const setStatus = async (status, ask) => {
      const n = ask ? prompt("Motivo (lo verá el autor):", "") : "";
      if (ask && n === null) return;
      await api(`admin/packages/${p.id}/status`, { method: "POST", body: { status, note: n || "" } }); toast("Listo."); render();
    };
    if (p.status !== "publicado") row.append(el("button", { className: "btn sm", textContent: "Publicar", type: "button", onclick: () => setStatus("publicado", false) }));
    if (p.status !== "rechazado") row.append(el("button", { className: "btn danger sm", textContent: "Rechazar", type: "button", onclick: () => setStatus("rechazado", true) }));
    card.append(row);
    return card;
  })));
  }

  // --- licencias
  if (can("cuentas.ver")) {
  const licRow = (l) => {
    const soltar = el("button", { className: "btn ghost sm", textContent: "Soltar equipos", type: "button" });
    soltar.onclick = async () => { await api(`admin/licenses/${l.id}/reset`, { method: "POST" }); toast("Equipos liberados."); render(); };
    const quitar = el("button", { className: "btn danger sm", textContent: "Quitar", type: "button" });
    quitar.onclick = async () => {
      if (!confirm("¿Quitar esta licencia?")) return;
      await api("admin/licenses/" + l.id, { method: "DELETE" }); toast("Licencia quitada."); render();
    };
    const tr = el("tr");
    tr.append(el("td", {}, l.username), el("td", {}, state.config.plans[l.product]?.name || l.product), el("td", {}, l.plan_name),
      el("td", {}, `${l.used} de ${l.devices >= 999 ? "sin límite" : l.devices}`), el("td", {}, fmtDate(l.expires)),
      el("td", {}, can("planes.dar") ? el("div", { className: "row" }, soltar, quitar) : ""));
    return tr;
  };
  frag.append(el("h2", {}, "Licencias"));
  frag.append(licenses.length
    ? el("div", { className: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, ...["Usuario", "Producto", "Plan", "Equipos", "Vence", ""].map((t) => el("th", {}, t)))),
        el("tbody", {}, ...licenses.map(licRow))))
    : el("p", { className: "muted" }, "Todavía no has activado ningún plan."));

  // --- cuentas ZYH: búsqueda por ID (exacta o aproximada) o por usuario
  frag.append(el("h2", {}, "Cuentas ZYH"),
    el("p", { className: "muted small" }, "Busca por ID (por ejemplo 0000001, o solo una parte como 12) o por nombre de usuario."));
  const q = el("input", { type: "search", placeholder: "ID o usuario…", maxLength: 40, ariaLabel: "Buscar cuenta" });
  const out = el("div", { className: "scroll" });
  const rowOf = (x) => el("tr", {},
    el("td", {}, el("code", {}, x.code)), el("td", {}, x.username), el("td", { className: "small muted" }, x.email || "—"), el("td", {}, x.id === 1 ? "dueño" : x.role === "admin" ? "administrador" : x.role === "user" ? "cuenta" : x.role),
    el("td", {}, el("span", { className: "tag " + (x.disabled ? "bad" : "ok"), textContent: x.disabled ? "baneada" : "activa" })),
    el("td", {}, x.planes_activos ? el("span", { className: "tag ok", textContent: x.planes_activos + " plan" + (x.planes_activos > 1 ? "es" : "") }) : el("span", { className: "small muted" }, "sin plan")),
    el("td", {}, x.reportes ? el("span", { className: "tag warn", textContent: x.reportes + " reporte" + (x.reportes > 1 ? "s" : "") }) : ""),
    el("td", {}, el("a", { className: "btn ghost sm", href: "#/admin-cuenta/" + x.id, textContent: "Ver" })));
  async function buscar() {
    const { users } = await api("admin/users?q=" + encodeURIComponent(q.value.trim()));
    out.replaceChildren(users.length ? el("table", {},
      el("thead", {}, el("tr", {}, ...["ID", "Usuario", "Correo", "Rol", "Estado", "Planes", "Reportes", ""].map((t) => el("th", {}, t)))),
      el("tbody", {}, ...users.map(rowOf))) : el("p", { className: "muted" }, "No hay cuentas con ese ID o usuario."));
  }
  let tq; q.oninput = () => { clearTimeout(tq); tq = setTimeout(buscar, 250); };
  frag.append(el("div", { className: "filters" }, q), out);
  buscar();
  }

  // --- roles del equipo (solo quien gestiona roles)
  if (can("planes.verificar") || can("transferencias.ver")) frag.append(await paymentsPanel(can));
  if (can("sitio.editar")) frag.append(await sitePanel());
  if (can("roles.gestionar")) frag.append(rolesPanel(rolesData));
  return frag;
};

async function sitePanel() {
  const { site } = await api("site");
  const f = el("form", { className: "box wide", style: "margin-top:26px" });
  const url = el("input", { value: site.tiktok_url || "", placeholder: "https://www.tiktok.com/@tuusuario", maxLength: 200 });
  const text = el("input", { value: site.tiktok_text || "", maxLength: 60, placeholder: "Síguenos en TikTok" });
  const err = el("p", { className: "err" });
  f.append(el("h2", { style: "margin-top:0" }, "Enlace de TikTok del inicio"), el("label", {}, "Enlace (déjalo vacío para ocultar el botón)"), url,
    el("label", {}, "Texto del botón"), text, el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Guardar" })), err);
  f.onsubmit = async (e) => { e.preventDefault(); err.textContent = ""; try { await api("admin/site", { method: "PUT", body: { tiktok_url: url.value.trim(), tiktok_text: text.value.trim() } }); toast("Guardado."); } catch (e2) { err.textContent = e2.message; } };
  return f;
}

async function paymentsPanel(can) {
  const box = el("section", { style: "margin-top:26px" });
  const state_ = { st: "pendiente" };
  const draw = async () => {
    const { payments, numero_completo } = await api("admin/payments?status=" + state_.st);
    const sel = el("select", {}, ...[["pendiente", "Pendientes"], ["correcta", "Correctas"], ["rechazada", "Rechazadas"]].map(([v, t]) => el("option", { value: v, textContent: t, selected: v === state_.st })));
    sel.onchange = () => { state_.st = sel.value; draw(); };
    const rows = payments.map((p) => {
      const acts = el("div", { className: "row" });
      if (p.status === "pendiente" && can("planes.verificar")) {
        acts.append(el("button", { className: "btn sm", type: "button", textContent: "Correcto: activar plan", onclick: async () => {
          if (!confirm(`¿El pago ${p.reference} de ${p.user} es correcto? Se activa el plan.`)) return;
          try { await api(`admin/payments/${p.id}/review`, { method: "POST", body: { action: "correcta" } }); toast("Plan activado."); draw(); } catch (e) { toast(e.message); } } }),
          el("button", { className: "btn danger sm", type: "button", textContent: "Rechazar", onclick: async () => {
            const note = prompt("Motivo del rechazo:") || ""; try { await api(`admin/payments/${p.id}/review`, { method: "POST", body: { action: "rechazada", note } }); toast("Rechazado."); draw(); } catch (e) { toast(e.message); } } }));
      }
      return el("tr", {}, el("td", {}, fmtDate(p.created_at)), el("td", {}, p.user, " ", el("code", {}, p.code)), el("td", {}, `${p.product_name} · ${p.plan_name}${p.extra ? " +" + p.extra + " eq." : ""}`),
        el("td", {}, "US$" + p.amount_usd), el("td", {}, el("code", {}, p.reference)), el("td", {}, p.number || "—"),
        el("td", {}, el("span", { className: "tag " + (p.status === "correcta" ? "ok" : p.status === "rechazada" ? "bad" : "warn"), textContent: p.status }), p.note ? el("div", { className: "small muted" }, p.note) : ""), el("td", {}, acts));
    });
    box.replaceChildren(el("div", { className: "row", style: "justify-content:space-between" }, el("h2", { style: "margin:0" }, "Pagos y transferencias de clientes"), sel),
      el("p", { className: "small muted" }, numero_completo ? "Ves el número completo de cada transferencia." : "El número del cliente aparece oculto (solo los últimos 4 dígitos)."),
      rows.length ? el("div", { className: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Fecha", "Cuenta", "Plan", "Valor", "ID PayPal", "Número", "Estado", ""].map((t) => el("th", {}, t)))), el("tbody", {}, ...rows))) : el("p", { className: "muted" }, "No hay pagos en esta lista."));
  };
  await draw();
  return box;
}

function rolesPanel({ roles, perms }) {
  const box = el("section", {}, el("h2", {}, "Roles del equipo"),
    el("p", { className: "muted small" }, "Crea roles con los permisos que quieras y luego asígnaselos a las cuentas desde su ficha. El dueño (cuenta 0000001) siempre puede todo."));
  const plantillas = { Soporte: ["cuentas.ver", "usuarios.reportar"], Ventas: ["cuentas.ver", "planes.dar"], Moderador: ["cuentas.ver", "usuarios.reportar", "usuarios.banear", "paquetes.revisar"] };
  const permBoxes = (sel) => Object.entries(perms).map(([k, label]) => {
    const cb = el("input", { type: "checkbox", value: k, checked: sel.includes(k), style: "width:auto;margin-right:8px" });
    return el("label", { style: "display:flex;align-items:center;font-weight:400;margin:6px 0" }, cb, label);
  });
  const readPerms = (root) => [...root.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);

  // lista de roles existentes
  for (const r of roles) {
    const card = el("div", { className: "card", style: "margin-bottom:12px" },
      el("div", { className: "row", style: "justify-content:space-between" }, el("h3", { style: "margin:0" }, r.name),
        el("span", { className: "tag", textContent: r.miembros + " cuenta" + (r.miembros === 1 ? "" : "s") })));
    if (!r.custom) {
      card.append(el("p", { className: "small muted" }, r.key === "user" ? "Sin permisos de administración." : "Todos los permisos menos gestionar roles: " + r.perms.map((p) => perms[p]).join("; ") + "."));
    } else {
      const list = el("div", {}, ...permBoxes(r.perms));
      const save = el("button", { className: "btn sm", type: "button", textContent: "Guardar permisos" });
      save.onclick = async () => { await api("admin/roles/" + r.key, { method: "PUT", body: { perms: readPerms(list) } }); toast("Rol guardado."); render(); };
      const del = el("button", { className: "btn danger sm", type: "button", textContent: "Borrar rol" });
      del.onclick = async () => { if (!confirm(`¿Borrar el rol "${r.name}"? Sus cuentas pasan a cuenta normal.`)) return; await api("admin/roles/" + r.key, { method: "DELETE" }); toast("Rol borrado."); render(); };
      card.append(list, el("div", { className: "row", style: "margin-top:8px" }, save, del));
    }
    box.append(card);
  }

  // crear rol
  const f = el("form", { className: "box wide" });
  const name = el("input", { required: true, maxLength: 40, placeholder: "Nombre del rol (ejemplo: Soporte)" });
  const checks = el("div", {}, ...permBoxes([]));
  const err = el("p", { className: "err" });
  const tpl = el("div", { className: "row", style: "margin:8px 0" }, ...Object.entries(plantillas).map(([n, ps]) =>
    el("button", { className: "chip", type: "button", textContent: n, onclick: () => {
      name.value = n; checks.querySelectorAll("input").forEach((c) => { c.checked = ps.includes(c.value); }); } })));
  f.append(el("h3", { style: "margin-top:0" }, "Crear un rol"), el("label", {}, "Nombre"), name, el("p", { className: "hint" }, "Plantillas rápidas:"), tpl,
    el("label", {}, "Permisos"), checks, el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Crear rol" })), err);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    try { await api("admin/roles", { method: "POST", body: { name: name.value, perms: readPerms(checks) } }); toast("Rol creado."); render(); } catch (e2) { err.textContent = e2.message; }
  };
  box.append(f);
  return box;
}

// ------------------------------------------------------------------ una cuenta (administración)
routes["admin-cuenta"] = async (id) => {
  if (!state.user?.perms?.length) { location.hash = "#/"; return el("p", {}); }
  const can = (p) => state.user.perms?.includes(p);
  const [{ user: u, licenses, reports }, { roles }] = await Promise.all([api("admin/users/" + encodeURIComponent(id)), api("admin/roles")]);
  const roleName = (k) => roles.find((r) => r.key === k)?.name || k;
  const frag = document.createDocumentFragment();
  const isOwner = u.id === 1, isMe = u.username === state.user.username;
  frag.append(el("p", { className: "small" }, el("a", { href: "#/admin" }, "← Administrar")),
    el("div", { className: "row", style: "justify-content:space-between" },
      el("h1", { style: "margin:0" }, u.username, " ", el("code", {}, u.code)),
      el("div", { className: "row" }, el("span", { className: "tag " + (u.disabled ? "bad" : "ok"), textContent: u.disabled ? "baneada" : "activa" }),
        el("span", { className: "tag", textContent: roleName(u.role) }))),
    el("p", { className: "muted small" }, `Correo: ${u.email || "—"} · Creada: ${fmtDate(u.created_at)}`));

  // --- planes de la cuenta
  frag.append(el("h2", {}, "Planes de esta cuenta"));
  if (!licenses.length) frag.append(el("p", { className: "muted" }, "No tiene ningún plan."));
  else frag.append(el("div", { className: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Producto", "Plan", "Equipos", "Vence", "Estado", ""].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...licenses.map((l) => {
      const soltar = el("button", { className: "btn ghost sm", textContent: "Soltar equipos", type: "button" });
      soltar.onclick = async () => { await api(`admin/licenses/${l.id}/reset`, { method: "POST" }); toast("Equipos liberados."); render(); };
      const quitar = el("button", { className: "btn danger sm", textContent: "Quitar", type: "button" });
      quitar.onclick = async () => { if (!confirm("¿Quitar este plan?")) return; await api("admin/licenses/" + l.id, { method: "DELETE" }); toast("Plan quitado."); render(); };
      return el("tr", {}, el("td", {}, l.product_name), el("td", {}, l.plan_name), el("td", {}, `${l.used} de ${l.devices >= 999 ? "ilimitados" : l.devices}`),
        el("td", {}, fmtDate(l.expires)), el("td", {}, el("span", { className: "tag " + (l.active ? "ok" : "bad"), textContent: l.active ? "activo" : "vencido" })),
        el("td", {}, can("planes.dar") ? el("div", { className: "row" }, soltar, quitar) : ""));
    })))));

  // --- dar un plan
  const f = el("form", { className: "box wide", style: "margin-top:18px" });
  const prod = el("select", {}, ...Object.entries(state.config.plans).map(([k, v]) => el("option", { value: k, textContent: v.name })));
  const plan = el("select", {});
  const days = el("input", { type: "number", value: "30", min: "1", max: "3660" });
  const extra = el("input", { type: "number", value: "0", min: "0", max: "999" });
  const note = el("input", { maxLength: 200, placeholder: "referencia del pago (opcional)" });
  const err = el("p", { className: "err" });
  const fill = () => plan.replaceChildren(...Object.entries((state.config.plans[prod.value]?.plans || {})).map(([k, v]) => el("option", { value: k, textContent: `${v[0]} — US$${v[1]}` })));
  prod.onchange = fill; fill();
  f.append(el("h2", { style: "margin-top:0" }, "Dar un plan"), el("label", {}, "Producto"), prod, el("label", {}, "Plan"), plan,
    el("label", {}, "Días"), days, el("label", {}, "Equipos extra"), extra, el("label", {}, "Nota"), note,
    el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Activar plan" })), err);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = "";
    try { await api("admin/licenses", { method: "POST", body: { username: u.username, product: prod.value, plan: plan.value, days: +days.value, extra_devices: +extra.value, note: note.value } }); toast("Plan activado."); render(); }
    catch (e2) { err.textContent = e2.message; }
  };
  if (can("planes.dar")) frag.append(f);

  // --- regalar días
  if ((can("dias.regalar") || can("planes.dar")) && !(isMe && !isOwner)) {
    const gf = el("form", { className: "box wide", style: "margin-top:18px" });
    const gdays = el("input", { type: "number", value: "3", min: "1", max: "365" });
    const gprod = el("select", {}, el("option", { value: "", textContent: "Todos sus planes activos" }), ...Object.entries(state.config.plans).map(([k, v]) => el("option", { value: k, textContent: v.name })));
    const gnote = el("input", { maxLength: 150, placeholder: "Motivo del regalo (opcional)" });
    const gerr = el("p", { className: "err" });
    gf.append(el("h2", { style: "margin-top:0" }, "Regalar días gratis"), el("p", { className: "small muted" }, "Se suman a los planes activos. Si no tiene ninguno, elige el producto: se crea el primer plan con esos días."),
      el("label", {}, "Días"), gdays, el("label", {}, "Producto"), gprod, el("label", {}, "Nota"), gnote,
      el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Regalar días" })), gerr);
    gf.onsubmit = async (e) => { e.preventDefault(); gerr.textContent = "";
      try { await api(`admin/users/${u.id}/gift`, { method: "POST", body: { days: +gdays.value, product: gprod.value, note: gnote.value } }); toast("Días regalados."); render(); } catch (e2) { gerr.textContent = e2.message; } };
    frag.append(gf);
  }

  // --- reportar / banear / rol
  const teamTarget = u.role !== "user" && !can("roles.gestionar");   // un miembro del equipo solo lo toca quien gestiona roles
  if (isOwner || isMe) frag.append(el("p", { className: "small muted", style: "margin-top:18px" }, isOwner ? "La cuenta del dueño no se puede reportar ni banear." : "Esta es tu cuenta."));
  else if (teamTarget) frag.append(el("p", { className: "small muted", style: "margin-top:18px" }, "Esta cuenta es parte del equipo: solo quien gestiona roles puede cambiarla."));
  else if (can("usuarios.reportar") || can("usuarios.banear") || can("roles.gestionar")) {
    const rf = el("form", { className: "box wide", style: "margin-top:18px" });
    const reason = el("input", { maxLength: 300, placeholder: "Motivo (lo ven solo los del equipo)" });
    const rerr = el("p", { className: "err" });
    const buttons = el("div", { className: "row", style: "margin-top:14px" });
    if (can("usuarios.reportar")) buttons.append(el("button", { className: "btn ghost", type: "submit", textContent: "Reportar usuario" }));
    if (can("usuarios.banear")) buttons.append(el("button", { className: "btn danger", type: "button", textContent: u.disabled ? "Quitar baneo" : "Banear usuario",
      onclick: async () => {
        if (!u.disabled && !reason.value.trim()) { rerr.textContent = "Escribe el motivo del baneo."; return; }
        if (!confirm(u.disabled ? "¿Quitar el baneo?" : `¿Banear a ${u.username}? Se cierran sus sesiones.`)) return;
        try { await api("admin/users/" + u.id, { method: "POST", body: { disabled: !u.disabled, reason: reason.value } }); toast("Listo."); render(); } catch (e2) { rerr.textContent = e2.message; }
      } }));
    rf.append(el("h2", { style: "margin-top:0" }, "Reportar o banear"), el("label", {}, "Motivo"), reason, buttons, rerr);
    if (can("roles.gestionar")) {
      const sel = el("select", {}, ...roles.map((r) => el("option", { value: r.key, textContent: r.name, selected: r.key === u.role })));
      const setRole = el("button", { className: "btn ghost", type: "button", textContent: "Cambiar rol",
        onclick: async () => { try { await api("admin/users/" + u.id, { method: "POST", body: { role: sel.value } }); toast("Rol cambiado."); render(); } catch (e2) { rerr.textContent = e2.message; } } });
      rf.append(el("h2", {}, "Rol de esta cuenta"), el("div", { className: "row" }, sel, setRole));
    }
    rf.onsubmit = async (e) => {
      e.preventDefault(); rerr.textContent = "";
      try { await api(`admin/users/${u.id}/report`, { method: "POST", body: { reason: reason.value } }); toast("Reporte guardado."); render(); } catch (e2) { rerr.textContent = e2.message; }
    };
    frag.append(rf);
  }

  // --- historial de reportes
  frag.append(el("h2", {}, "Reportes y baneos"));
  frag.append(reports.length ? el("div", { className: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Fecha", "Motivo", "Por", ""].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...reports.map((r) => el("tr", {}, el("td", {}, fmtDate(r.created_at)), el("td", {}, r.reason), el("td", {}, r.by_name || "—"),
      el("td", {}, can("usuarios.reportar") ? el("button", { className: "btn ghost sm", type: "button", textContent: "Quitar",
        onclick: async () => { await api("admin/reports/" + r.id, { method: "DELETE" }); toast("Listo."); render(); } }) : "")))))) : el("p", { className: "muted" }, "Sin reportes."));
  return frag;
};

// ------------------------------------------------------------------ términos

// ------------------------------------------------------------------ tienda de apps para ZYHT32
const money = (n) => "US$" + Number(n).toFixed(2);
let _man = null;
const manifest = async () => _man || (_man = await fetch("/manifiesto.json").then((r) => r.json()).catch(() => ({})));
const storeMedia = async (slug) => ((await manifest()).tienda || {})[slug] || { icono: "", imagenes: [], videos: [] };

routes["tienda"] = async () => {
  const [{ apps, open }, man] = await Promise.all([api("store/apps"), manifest()]);
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Tienda ZYHT32"),
    el("p", { className: "muted" }, "Apps hechas para el ZYHT32 IDE. Cada venta se reparte: 65% para quien creó la app y 35% para ZYH Studios."));
  if (!open) frag.append(el("p", { className: "box small" }, "El ZYHT32 todavía no está en lanzamiento, así que por ahora solo ZYH Studios publica apps aquí. Cuando se abra, cualquier creador con cuenta ZYH podrá publicar las suyas."));
  if (!apps.length) { frag.append(el("p", { className: "muted" }, "Pronto habrá apps aquí.")); return frag; }
  frag.append(el("div", { className: "grid" }, ...apps.map((a) => {
    const m = (man.tienda || {})[a.slug] || {};
    return el("a", { className: "card pkg", href: "#/tienda-app/" + a.slug },
      m.imagenes?.[0] ? el("img", { src: m.imagenes[0], alt: "", loading: "lazy", style: "width:100%;border-radius:10px;margin-bottom:10px" })
        : el("div", { className: "icon-ph", textContent: a.name[0].toUpperCase() }),
      el("h3", { style: "margin:6px 0" }, a.name), el("p", { className: "small muted", textContent: (a.description || "").slice(0, 110) }),
      el("span", { className: "tag", textContent: a.category }), el("span", { className: "tag " + (a.price_usd ? "warn" : "ok"), textContent: a.price_usd ? money(a.price_usd) : "Gratis" }));
  })));
  return frag;
};

routes["tienda-app"] = async (slug) => {
  const [{ app: a }, m] = await Promise.all([api("store/apps/" + encodeURIComponent(slug)), storeMedia(slug)]);
  const frag = document.createDocumentFragment();
  frag.append(el("p", { className: "small" }, el("a", { href: "#/tienda" }, "← Tienda ZYHT32")),
    el("div", { className: "pkg", style: "gap:16px;align-items:center" },
      m.icono ? el("img", { src: m.icono, alt: "", width: 56, height: 56 }) : el("div", { className: "icon-ph", textContent: a.name[0].toUpperCase() }),
      el("div", {}, el("h1", { style: "margin:0" }, a.name), el("p", { className: "muted" }, "por ", a.author))),
    el("div", { style: "margin:10px 0" }, el("span", { className: "tag", textContent: a.category }), el("span", { className: "tag", textContent: "v" + a.version }),
      el("span", { className: "tag", textContent: a.downloads + " descargas" }), el("span", { className: "tag", textContent: fmtSize(a.size) })));
  if (m.videos?.length) frag.append(el("h2", {}, "Cómo se usa"), ...m.videos.map((v) => el("figure", { style: "margin:0 0 12px" },
    el("video", { src: v.url, controls: true, preload: "metadata", style: "max-width:100%;border-radius:12px;border:1px solid var(--line)" }), el("figcaption", { className: "small muted", textContent: v.titulo }))));
  if (m.imagenes?.length) frag.append(el("h2", {}, "Así se ve"), el("div", { className: "shots" }, ...m.imagenes.map((src) => el("img", { src, alt: "Captura de " + a.name, loading: "lazy" }))));
  if (!m.videos?.length && !m.imagenes?.length) frag.append(el("p", { className: "small muted" }, "Esta app todavía no tiene imágenes ni video."));
  if (a.description) frag.append(el("h2", {}, "Descripción"), el("p", { className: "desc", textContent: a.description }));

  const buy = el("div", { className: "box wide", style: "margin-top:16px" });
  buy.append(el("h2", { style: "margin-top:0" }, a.price_usd ? money(a.price_usd) : "Gratis"));
  if (a.price_usd) buy.append(el("p", { className: "small muted" }, `De cada venta: ${money(a.creator_usd)} (65%) para ${a.author} y ${money(a.studio_usd)} (35%) para ZYH Studios.`));
  const dl = el("a", { className: "btn", href: "/api/store/download/" + a.slug, textContent: "Descargar .zip" });
  if (a.owned) {
    buy.append(el("div", { className: "row" }, state.user ? dl : el("a", { className: "btn", href: "#/entrar", textContent: "Entra para descargar" })),
      el("p", { className: "small muted" }, "Descomprime el .zip en la raíz de tu microSD: queda en zyht32/apps/" + a.slug + "/ y aparece en el ZYHT32."));
  } else if (!state.user) {
    buy.append(el("a", { className: "btn", href: "#/entrar", textContent: "Entra para comprar" }));
  } else if (a.pending) {
    buy.append(el("p", { className: "tag warn", textContent: "Tu pago está en revisión" }));
  } else {
    const ref = el("input", { required: true, placeholder: "ID de la transacción de PayPal", maxLength: 60 }), num = el("input", { placeholder: "Número desde el que pagaste (opcional)", maxLength: 30, inputMode: "tel" });
    const err = el("p", { className: "err" });
    const f = el("form", {}, el("label", {}, "ID de transacción"), ref, el("label", {}, "Número (opcional)"), num,
      el("div", { style: "margin-top:12px" }, el("button", { className: "btn", type: "submit", textContent: "Ya pagué: avisar" })), err);
    f.onsubmit = async (e) => { e.preventDefault(); err.textContent = "";
      try { await api("payments", { method: "POST", body: { product: "tienda", plan: a.slug, reference: ref.value, payer_number: num.value } }); toast("Pago enviado a revisión."); render(); } catch (e2) { err.textContent = e2.message; } };
    buy.append(a.paypal_id ? el("a", { className: "btn", href: "https://www.paypal.com/ncp/payment/" + a.paypal_id, target: "_blank", rel: "noopener noreferrer", textContent: "1. Pagar con PayPal" })
      : el("p", { className: "small muted" }, "Esta app aún no tiene botón de pago."),
      el("p", { className: "small muted", style: "margin-top:12px" }, "2. Cuando pagues, pega aquí el ID de la transacción. Una persona del equipo lo revisa y te abre la descarga."), f);
  }
  frag.append(buy);
  return frag;
};

const fileB64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(file); });
routes["admin-tienda"] = async () => {
  if (!state.user) { location.hash = "#/entrar"; return el("p", {}); }
  const [{ apps, open, can_publish }, earn] = await Promise.all([api("store/apps"), api("store/earnings")]);
  const frag = document.createDocumentFragment(), owner = !!state.user.owner;
  frag.append(el("p", { className: "small" }, el("a", { href: "#/admin" }, "← Administrar")), el("h1", {}, "Tienda ZYHT32"));
  if (owner) {
    const t = el("button", { className: "btn " + (open ? "danger" : ""), type: "button", textContent: open ? "Cerrar la tienda a otros creadores" : "Abrir la tienda a otros creadores",
      onclick: async () => { await api("store/open", { method: "PUT", body: { open: !open } }); toast(open ? "Tienda cerrada: solo tú publicas." : "Tienda abierta a creadores con permiso."); render(); } });
    frag.append(el("div", { className: "box wide" }, el("p", { className: "small" }, "Estado: ", el("b", {}, open ? "abierta a creadores" : "solo ZYH Studios (ZYHT32 aún no está en lanzamiento)")), t));
  }
  if (can_publish) {
    const f = el("form", { className: "box wide", style: "margin-top:14px" }), err = el("p", { className: "err" });
    const slug = el("input", { required: true, placeholder: "nombre-corto (igual a la carpeta zyht32/apps/…)", maxLength: 40 }), name = el("input", { required: true, maxLength: 60 });
    const desc = el("textarea", { rows: 4, maxLength: 1500 }), cat = el("input", { value: "Útiles", maxLength: 30 });
    const price = el("input", { type: "number", min: "0", max: "99", step: "0.01", value: "0" }), ver = el("input", { value: "1.0", maxLength: 12 }), pp = el("input", { placeholder: "ID del botón de pago de PayPal (si no es gratis)", maxLength: 30 });
    const pack = el("input", { type: "file", accept: ".zip" });
    f.append(el("h2", { style: "margin-top:0" }, "Publicar o actualizar una app"), el("label", {}, "Nombre corto"), slug, el("label", {}, "Nombre"), name, el("label", {}, "Descripción"), desc,
      el("label", {}, "Categoría"), cat, el("label", {}, "Precio en USD (0 = gratis; mínimo 0.99)"), price, el("label", {}, "Versión"), ver, el("label", {}, "Botón de PayPal"), pp,
      el("label", {}, "Paquete .zip (máx. 800 KB; solo zyht32/apps/<nombre>/ con main.zyht32, app.txt, icono.png)"), pack,
      el("p", { className: "small muted" }, "Las imágenes y videos se ponen en la carpeta public/tienda/<nombre-corto>/ (icono.png, imagenes/, videos/) y salen solos al desplegar."),
      el("div", { style: "margin-top:14px" }, el("button", { className: "btn", type: "submit", textContent: "Publicar" })), err);
    f.onsubmit = async (e) => { e.preventDefault(); err.textContent = "";
      try { const body = { slug: slug.value.trim(), name: name.value, description: desc.value, category: cat.value, price_usd: Number(price.value), version: ver.value, paypal_id: pp.value };
        if (pack.files[0]) body.pack = await fileB64(pack.files[0]);
        await api("store/apps", { method: "POST", body }); toast("App publicada."); render(); } catch (e2) { err.textContent = e2.message; } };
    frag.append(f);
  } else frag.append(el("p", { className: "box small" }, "Por ahora solo ZYH Studios puede publicar en la tienda."));
  frag.append(el("h2", {}, "Apps publicadas"));
  frag.append(apps.length ? el("div", { className: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["App", "Autor", "Precio", "Descargas", ""].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...apps.map((a) => el("tr", {}, el("td", {}, el("a", { href: "#/tienda-app/" + a.slug }, a.name)), el("td", {}, a.author), el("td", {}, a.price_usd ? money(a.price_usd) : "Gratis"), el("td", {}, a.downloads),
      el("td", {}, (owner || a.author === state.user.username) ? el("button", { className: "btn danger sm", type: "button", textContent: "Retirar",
        onclick: async () => { if (!confirm("¿Retirar " + a.name + " de la tienda?")) return; await api("store/apps/" + a.slug, { method: "DELETE" }); toast("Retirada."); render(); } }) : "")))))) : el("p", { className: "muted" }, "Aún no hay apps."));
  frag.append(el("h2", {}, earn.all ? "Ganancias (todas)" : "Tus ganancias"), el("p", { className: "small muted" }, "Reparto: 65% creador · 35% ZYH Studios."),
    el("div", { className: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, ...["App", "Autor", "Ventas", "Total", "Creador 65%", "ZYH 35%"].map((t) => el("th", {}, t)))),
      el("tbody", {}, ...earn.apps.map((a) => el("tr", {}, el("td", {}, a.name), el("td", {}, a.author), el("td", {}, a.sales), el("td", {}, money(a.gross_usd)), el("td", {}, money(a.creator_usd)), el("td", {}, money(a.studio_usd)))),
        el("tr", {}, el("td", {}, el("b", {}, "Total")), el("td", {}), el("td", {}, earn.totals.sales), el("td", {}, money(earn.totals.gross_usd)), el("td", {}, money(earn.totals.creator_usd)), el("td", {}, money(earn.totals.studio_usd)))))));
  return frag;
};

routes["terminos"] = async () => {
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Términos y condiciones"), el("div", { className: "box wide desc" },
    `1. Licencia de uso. ZYH Studios te concede una licencia personal e intransferible para usar sus apps según el plan contratado y el número de dispositivos permitido.

2. Pagos. Los planes se cobran por adelantado a través de PayPal. Los precios se expresan en dólares. ZYH Browser, ZYH ZVID y el ZYHT32 IDE son gratuitos.

3. Cuenta ZYH. Eres responsable de tu usuario y contraseña (mínimo 8 caracteres). No compartas tu cuenta: cada licencia cubre un número limitado de dispositivos.

4. Paquetes de la comunidad. Lo que subas debe ser tuyo o tener permiso de su autor. ZYH Studios revisa los paquetes antes de publicarlos y puede rechazarlos o retirarlos, pero no responde por el contenido de terceros.

5. Prohibido modificar, descompilar, piratear o redistribuir el software o su sistema de licencias.

6. Datos. Los datos de tus negocios se guardan en tu equipo. En esta web guardamos solo tu cuenta, tus licencias y los paquetes que subas.

7. Garantía. El software se entrega "tal cual", sin garantía de estar libre de errores.

8. Cambios. ZYH Studios puede actualizar estos términos y las funciones de las apps en futuras versiones.

© ZyhStudios.`));
  return frag;
};

// ------------------------------------------------------------------ arranque
$("#menu-btn").onclick = () => $("#nav").classList.toggle("open");
addEventListener("hashchange", render);
(async () => {
  try {
    const [cfg, me] = await Promise.all([api("config"), api("me")]);
    state.config = cfg; state.user = me.user;
    try { state.apps = (await (await fetch("/manifiesto.json")).json()).productos || []; } catch { state.apps = []; }
  } catch { state.config = { limits: { icon: 524288, image: 2097152, package: 15728640 }, plans: {}, paypal: "" }; }
  render();
  tiktokWelcome();
})();

// Al entrar a la web: invitación a la cuenta oficial de TikTok (el enlace lo cambia el equipo desde Administrar). Sale una vez por visita.
async function tiktokWelcome() {
  try { if (sessionStorage.getItem("zyh_tt")) return; } catch { /* sin almacenamiento: se muestra igual */ }
  let site; try { site = (await api("site")).site; } catch { return; }
  if (!site?.tiktok_url) return;
  const close = () => { try { sessionStorage.setItem("zyh_tt", "1"); } catch { /* nada */ } ov.remove(); };
  const ov = el("div", { className: "tt-ov", role: "dialog", "aria-modal": "true", "aria-label": "TikTok oficial" },
    el("div", { className: "tt-box" },
      el("div", { className: "z", textContent: "Z", style: "font-size:54px;line-height:1" }),
      el("h2", { style: "margin:8px 0 4px" }, "Entra a nuestra cuenta oficial"),
      el("p", { className: "tt-handle", textContent: "@zyh_studios" }),
      el("p", { className: "small muted" }, "Videos, novedades y cómo usar tus apps ZYH."),
      el("div", { className: "row", style: "justify-content:center;margin-top:14px" },
        el("a", { className: "btn", href: site.tiktok_url, target: "_blank", rel: "noopener noreferrer", textContent: "♪ Abrir TikTok", onclick: () => setTimeout(close, 50) }),
        el("button", { className: "btn ghost", type: "button", textContent: "Ahora no", onclick: close }))));
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { document.removeEventListener("keydown", esc); close(); } });
  document.body.append(ov);
}
