// ZYH Web — interfaz. ZYH Studios.
"use strict";

const state = { user: null, config: null };
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
function renderNav() {
  const nav = $("#nav"), u = state.user, hash = location.hash || "#/";
  const links = [["#/", "Inicio"], ["#/apps", "Apps"], ["#/paquetes", "Paquetes"], ["#/planes", "Planes"]];
  if (u) links.push(["#/cuenta", "Mi cuenta"]);
  if (u?.role === "admin") links.push(["#/admin", "Administrar"]);
  nav.replaceChildren(
    ...links.map(([href, text]) => el("a", { href, textContent: text, className: hash.startsWith(href) && (href !== "#/" || hash === "#/") ? "on" : "" })),
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
      el("h1", {}, "ZYH Studios"),
      el("p", {}, "Apps de escritorio, el firmware ZYHT32 y los paquetes de la comunidad. Una sola cuenta ZYH para todo."),
      el("div", { className: "row", style: "justify-content:center" },
        el("a", { className: "btn", href: "#/apps", textContent: "Ver las apps" }),
        el("a", { className: "btn ghost", href: "#/paquetes", textContent: "Explorar paquetes" }))),
    el("h2", {}, "Qué encuentras aquí"),
    el("div", { className: "grid" },
      ...[["Apps", "Browser, Compressor, Business, Bridged, ZVID y el IDE del ZYHT32.", "#/apps"],
          ["Paquetes", "Programas y complementos que suben la comunidad y ZYH Studios.", "#/paquetes"],
          ["Tu cuenta ZYH", "Tus licencias y tus paquetes, en todos tus equipos.", "#/cuenta"]]
        .map(([t, d, href]) => el("a", { className: "card", href }, el("h3", {}, t), el("p", { className: "muted", textContent: d })))));
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
routes["apps"] = async () => {
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
    el("p", { className: "muted" }, state.user.role === "admin" ? "Como administrador, tus paquetes se publican al instante."
      : "Tu paquete queda esperando aprobación; ZYH Studios lo revisa y luego aparece en la lista."), f);
  return frag;
}
routes["subir"] = () => packageForm(null);
routes["editar"] = (slug) => packageForm(slug);

// ------------------------------------------------------------------ planes
routes["planes"] = async () => {
  const { plans, paypal } = state.config;
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Planes"), el("p", { className: "muted" },
    "Los precios están en dólares. Paga por PayPal a ", el("b", {}, paypal), " indicando tu usuario ZYH y el plan; se activa en tu cuenta."));
  for (const [prod, info] of Object.entries(plans)) {
    frag.append(el("h2", {}, info.name),
      el("div", { className: "grid" }, ...Object.entries(info.plans).map(([pid, [label, usd, devices]]) =>
        el("div", { className: "card plan" }, el("h3", {}, label),
          el("div", { className: "price", textContent: `US$${usd}` }), el("p", { className: "muted small", textContent: "por " + info.cycle }),
          el("p", { className: "small" }, devices >= 999 ? "10 o más dispositivos" : `Hasta ${devices} dispositivo${devices > 1 ? "s" : ""}`)))));
  }
  frag.append(el("p", { className: "small muted", style: "margin-top:20px" }, "ZYH Browser, ZYH ZVID y el ZYHT32 IDE son gratis."));
  return frag;
};

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
      state.user = r.user; toast(mode === "register" ? `Cuenta creada. ¡Hola, ${r.user.username}!` : `Hola, ${r.user.username}`);
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
    el("h1", {}, state.user.username), el("div", { className: "row" }, el("span", { className: "tag", textContent: state.user.role === "admin" ? "administrador" : "cuenta ZYH" }), out)));

  frag.append(el("h2", {}, "Mis licencias"));
  if (!licenses.length) {
    frag.append(el("p", { className: "muted" }, "Todavía no tienes planes. ", el("a", { href: "#/planes" }, "Ver planes"), "."));
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

// ------------------------------------------------------------------ administración
routes["admin"] = async () => {
  if (state.user?.role !== "admin") { location.hash = "#/"; return el("p", {}); }
  const [{ users }, { licenses }, { packages }] = await Promise.all([api("admin/users"), api("admin/licenses"), api("packages?scope=all")]);
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Administrar"));

  // --- dar un plan
  const f = el("form", { className: "box wide" });
  const u = el("input", { required: true, placeholder: "usuario ZYH", maxLength: 40 });
  const prod = el("select", {}, ...Object.entries(state.config.plans).map(([k, v]) => el("option", { value: k, textContent: v.name })));
  const plan = el("select", {});
  const days = el("input", { type: "number", value: "30", min: "1", max: "3660" });
  const extra = el("input", { type: "number", value: "0", min: "0", max: "999" });
  const note = el("input", { maxLength: 200, placeholder: "referencia del pago (opcional)" });
  const err = el("p", { className: "err" });
  const fillPlans = () => plan.replaceChildren(...Object.entries(state.config.plans[prod.value].plans).map(([k, v]) => el("option", { value: k, textContent: `${v[0]} — US$${v[1]}` })));
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
  frag.append(f);

  // --- paquetes por revisar
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

  // --- licencias
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
      el("td", {}, el("div", { className: "row" }, soltar, quitar)));
    return tr;
  };
  frag.append(el("h2", {}, "Licencias"));
  frag.append(licenses.length
    ? el("div", { className: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, ...["Usuario", "Producto", "Plan", "Equipos", "Vence", ""].map((t) => el("th", {}, t)))),
        el("tbody", {}, ...licenses.map(licRow))))
    : el("p", { className: "muted" }, "Todavía no has activado ningún plan."));

  // --- cuentas
  const userRow = (x) => {
    const tr = el("tr");
    tr.append(el("td", {}, x.username), el("td", { className: "small muted" }, x.email || "—"), el("td", {}, x.role),
      el("td", {}, el("span", { className: "tag " + (x.disabled ? "bad" : "ok"), textContent: x.disabled ? "bloqueada" : "activa" })));
    if (x.id === 1 || x.username === state.user.username) {
      tr.append(el("td", {}, el("span", { className: "small muted" }, "—")));
      return tr;
    }
    const rol = el("button", { className: "btn ghost sm", textContent: x.role === "admin" ? "Quitar admin" : "Hacer admin", type: "button" });
    rol.onclick = async () => { await api("admin/users/" + x.id, { method: "POST", body: { role: x.role === "admin" ? "user" : "admin" } }); toast("Rol cambiado."); render(); };
    const blo = el("button", { className: "btn danger sm", textContent: x.disabled ? "Desbloquear" : "Bloquear", type: "button" });
    blo.onclick = async () => { await api("admin/users/" + x.id, { method: "POST", body: { disabled: !x.disabled } }); toast("Listo."); render(); };
    tr.append(el("td", {}, el("div", { className: "row" }, rol, blo)));
    return tr;
  };
  frag.append(el("h2", {}, "Cuentas"));
  frag.append(el("div", { className: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Usuario", "Correo", "Rol", "Estado", ""].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...users.map(userRow)))));
  return frag;
};

// ------------------------------------------------------------------ términos
routes["terminos"] = async () => {
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Términos y condiciones"), el("div", { className: "box wide desc" },
    `1. Licencia de uso. ZYH Studios te concede una licencia personal e intransferible para usar sus apps según el plan contratado y el número de dispositivos permitido.

2. Pagos. Los planes se cobran por adelantado a través de PayPal (${state.config?.paypal || ""}). Los precios se expresan en dólares. ZYH Browser, ZYH ZVID y el ZYHT32 IDE son gratuitos.

3. Cuenta ZYH. Eres responsable de tu usuario y contraseña (mínimo 8 caracteres). No compartas tu cuenta: cada licencia cubre un número limitado de dispositivos.

4. Paquetes de la comunidad. Lo que subas debe ser tuyo o tener permiso de su autor. ZYH Studios revisa los paquetes antes de publicarlos y puede rechazarlos o retirarlos, pero no responde por el contenido de terceros.

5. Prohibido modificar, descompilar, piratear o redistribuir el software o su sistema de licencias.

6. Datos. Los datos de tus negocios se guardan en tu equipo. En esta web guardamos solo tu cuenta, tus licencias y los paquetes que subas.

7. Garantía. El software se entrega "tal cual", sin garantía de estar libre de errores.

8. Cambios. ZYH Studios puede actualizar estos términos y las funciones de las apps en futuras versiones.

© ZYH Studios.`));
  return frag;
};

// ------------------------------------------------------------------ arranque
$("#menu-btn").onclick = () => $("#nav").classList.toggle("open");
addEventListener("hashchange", render);
(async () => {
  try {
    const [cfg, me] = await Promise.all([api("config"), api("me")]);
    state.config = cfg; state.user = me.user;
  } catch { state.config = { limits: { icon: 524288, image: 2097152, package: 15728640 }, plans: {}, paypal: "" }; }
  render();
})();
