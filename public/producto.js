// ZyhStudios — páginas de producto (/productos/<producto>/<version>/). Todo sale de manifiesto.json.
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) n.append(k?.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const view = $("#view");
const fmtSize = (n) => !n ? "" : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const usd = (n) => "US$" + n.toFixed(2).replace(".", ",");
const vkey = (v) => v.split(".").map((x) => +x || 0);
const vcmp = (a, b) => { const x = vkey(a), y = vkey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const latest = (p) => p.versiones.map((v) => v.version).sort(vcmp).pop();

$("#nav").replaceChildren(el("a", { href: "/", textContent: "Inicio" }), el("a", { href: "/productos/", className: "on", textContent: "Productos" }),
  el("a", { href: "/#/paquetes", textContent: "Paquetes" }), el("a", { href: "/#/cuenta", className: "cta", textContent: "Mi cuenta" }));
$("#menu-btn").onclick = () => $("#nav").classList.toggle("open");

// ---- PayPal: enlace público de pago y carrito (suma planes + equipos adicionales)
let cartReady = null;
function loadCart(merchantId) {
  if (cartReady) return cartReady;
  cartReady = new Promise((ok, fail) => {
    const s = el("script", { src: "https://www.paypalobjects.com/ncp/cart/cart.js" });
    s.dataset.merchantId = merchantId; s.onload = () => ok(window.cartPaypal); s.onerror = () => fail(new Error("carrito"));
    document.head.append(s);
  });
  return cartReady;
}
const payLink = (id) => el("a", { className: "btn", href: "https://www.paypal.com/ncp/payment/" + id, target: "_blank", rel: "noopener noreferrer", textContent: "Pagar con PayPal" });
function addToCart(m, id) {
  const box = el("div", { className: "pay" }), tag = el("paypal-add-to-cart-button"); tag.setAttribute("data-id", id); box.append(tag);
  loadCart(m.pagos.paypal_merchant_id).then((c) => c.AddToCart({ id })).catch(() => box.replaceChildren(el("span", { className: "err", textContent: "No se pudo cargar el carrito de PayPal." })));
  return box;
}
function viewCart(m) {
  const box = el("div", { className: "pay" }), tag = el("paypal-cart-button"); tag.setAttribute("data-id", "pp-view-cart"); box.append(tag);
  loadCart(m.pagos.paypal_merchant_id).then((c) => c.Cart({ id: "pp-view-cart" })).catch(() => {});
  return box;
}
function videoEl(v, auto) {
  const props = { src: v.url, controls: true, preload: "metadata", playsInline: true, muted: !!auto, loop: !!auto, autoplay: !!auto, className: "vid" };
  return el("figure", { className: "vfig" }, el("video", props), v.titulo ? el("figcaption", { className: "small muted", textContent: v.titulo }) : "");
}

function card(p) {
  return el("a", { className: "card pkg", href: `/productos/${p.slug}/${latest(p)}/` },
    el("img", { src: p.logo, alt: "", width: 56, height: 56, loading: "lazy" }),
    el("div", {}, el("h3", {}, p.nombre), el("p", { className: "muted small", textContent: p.descripcion }),
      el("div", { style: "margin-top:6px" }, el("span", { className: "tag", textContent: "v" + latest(p) }),
        el("span", { className: "tag " + (p.gratis ? "ok" : ""), textContent: p.gratis ? "Gratis" : (p.planes.length ? "Desde " + usd(Math.min(...p.planes.map((x) => x.usd))) : "") }))));
}

function lista(m) {
  const frag = document.createDocumentFragment();
  frag.append(el("h1", {}, "Productos ZyhStudios"), el("p", { className: "muted" }, "Cada producto tiene su página, sus capturas, sus videos y sus versiones."),
    el("div", { className: "grid" }, ...m.productos.map(card)));
  return frag;
}

function producto(m, p, ver) {
  const vers = p.versiones.map((v) => v.version).sort(vcmp).reverse();
  if (!ver || !vers.includes(ver)) { location.replace(`/productos/${p.slug}/${vers[0]}/`); return el("p", {}); }
  document.title = `${p.nombre} ${ver} · ZyhStudios`;
  const v = p.versiones.find((x) => x.version === ver);

  const sel = el("select", { "aria-label": "Versión" }, ...vers.map((x) => el("option", { value: x, textContent: "Versión " + x, selected: x === ver })));
  sel.onchange = () => { location.href = `/productos/${p.slug}/${sel.value}/`; };

  const imgs = v.imagenes.length ? v.imagenes : [p.logo];
  const shown = el("img", { className: "shot-main", src: imgs[0], alt: p.nombre });
  const thumbs = imgs.length > 1 ? el("div", { className: "thumbs" }, ...imgs.map((src) => { const t = el("img", { src, alt: "", loading: "lazy" }); t.onclick = () => { shown.src = src; }; return t; })) : "";
  const left = el("div", { className: "pcol" }, el("h1", {}, p.nombre), el("p", { className: "muted" }, p.descripcion), el("div", { className: "shotbox" }, shown), thumbs);

  // "incluyendo ZYH OS" solo aparece cuando config.json pone "zyhos": true (ZYH OS está en desarrollo).
  const compat = "Compatible con " + p.compatible.join(" y ") + (p.zyhos ? ", incluyendo ZYH OS" : "") + ".";
  const right = el("div", { className: "pside box" },
    el("div", { className: "row", style: "justify-content:space-between" }, el("b", {}, "Versión " + ver), sel),
    el("p", { className: "muted small" }, v.notas), el("p", {}, compat),
    v.paquete ? el("a", { className: "btn", style: "width:100%;text-align:center", href: v.paquete.url, download: "", textContent: "Descargar la versión seleccionada" })
              : el("p", { className: "muted" }, "El paquete de esta versión estará disponible pronto."),
    v.paquete ? el("p", { className: "hint", textContent: `${v.paquete.nombre} · ${fmtSize(v.paquete.size)}` }) : "",
    p.gratis ? el("p", { className: "small" }, "Es gratis: descárgala y úsala con o sin cuenta.")
             : el("p", { className: "small" }, "Descárgala y pruébala; para seguir usándola elige un plan abajo y activa tu cuenta ZYH."));

  const frag = document.createDocumentFragment();
  frag.append(el("p", { className: "small" }, el("a", { href: "/productos/" }, "← Todos los productos")), el("div", { className: "pgrid" }, left, right));
  if (v.videos.length) frag.append(el("h2", {}, "Videos"), el("div", { className: "vgrid" }, ...v.videos.map((x) => videoEl(x, false))));

  if (!p.gratis && (p.planes.length || p.extras.length)) {
    const hasCart = p.planes.some((x) => x.carrito) || p.extras.some((x) => x.carrito);
    frag.append(el("h2", {}, "Planes"),
      el("p", { className: "muted small" }, "Precios en dólares. Pagas con PayPal desde tu banco o tarjeta preferida, y el plan se activa en tu cuenta ZYH."),
      hasCart ? el("div", { className: "cartbar" }, el("span", { className: "small muted" }, "Agrega el plan y los equipos que necesites: el total se suma en el carrito."), viewCart(m)) : "",
      el("div", { className: "grid" }, ...p.planes.map((pl) => el("div", { className: "card plan" }, el("h3", {}, pl.nombre),
        el("div", { className: "price", textContent: usd(pl.usd) }), el("p", { className: "muted small", textContent: `${pl.dispositivos} · por ${pl.ciclo}` }),
        pl.carrito ? addToCart(m, pl.carrito) : "",
        pl.boton ? el("div", { className: "pay" }, payLink(pl.boton)) : el("span", { className: "tag", textContent: "Pago disponible pronto" })))));
    if (p.extras.length) frag.append(el("h2", {}, "Equipos adicionales"),
      el("p", { className: "muted small" }, "Agrega uno o varios y el total se suma en el carrito de PayPal."),
      el("div", { className: "grid" }, ...p.extras.map((x) => el("div", { className: "card plan" }, el("h3", {}, x.nombre),
        el("div", { className: "price", textContent: usd(x.usd) }), el("p", { className: "muted small" }, "por equipo"),
        x.carrito ? addToCart(m, x.carrito) : el("span", { className: "tag", textContent: "Pago disponible pronto" })))));
  }
  return frag;
}

(async () => {
  try {
    const m = await (await fetch("/manifiesto.json")).json();
    const slug = view.dataset.slug, ver = view.dataset.version;
    if (!slug) { view.replaceChildren(lista(m)); return; }
    const p = m.productos.find((x) => x.slug === slug);
    view.replaceChildren(p ? producto(m, p, ver) : el("p", { className: "err" }, "Producto no encontrado."));
  } catch (e) { view.replaceChildren(el("p", { className: "err" }, "No se pudo cargar: " + e.message)); }
})();
