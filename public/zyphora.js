// Zyphora en la web — mismos chats, grupos, sala, temas y fondos que Zyphora 2 del ZYHT32. Usa tu Cuenta ZYH.
"use strict";
(() => {
  // Temas: los mismos 8 del ZYHT32 (fondo, panel, burbuja mía, burbuja de otro, texto, texto suave, acento, texto sobre acento)
  const THEMES = [
    ["Zyphora", [199, 223, 154], [167, 199, 127], [234, 247, 225], [247, 248, 243], [17, 17, 17], [86, 98, 74], [70, 125, 50], [255, 255, 255]],
    ["Noche", [16, 18, 28], [34, 38, 58], [52, 84, 150], [48, 52, 76], [235, 235, 245], [140, 150, 180], [110, 160, 255], [0, 0, 0]],
    ["Océano", [12, 70, 105], [205, 232, 242], [160, 220, 240], [240, 250, 252], [10, 30, 45], [60, 100, 120], [0, 120, 170], [255, 255, 255]],
    ["Atardecer", [250, 170, 90], [255, 224, 190], [255, 200, 150], [255, 245, 235], [60, 25, 10], [150, 80, 40], [220, 90, 40], [255, 255, 255]],
    ["Rosa", [245, 190, 210], [255, 230, 240], [250, 200, 225], [255, 250, 252], [70, 20, 40], [160, 90, 120], [210, 60, 130], [255, 255, 255]],
    ["Claro", [232, 232, 232], [255, 255, 255], [215, 235, 255], [242, 242, 242], [20, 20, 20], [120, 120, 120], [30, 120, 220], [255, 255, 255]],
    ["Robot", [40, 10, 10], [70, 22, 22], [150, 34, 34], [92, 32, 32], [255, 232, 232], [200, 140, 140], [255, 80, 70], [0, 0, 0]],
    ["Matrix", [0, 0, 0], [0, 30, 0], [0, 80, 0], [0, 45, 0], [130, 255, 130], [40, 160, 40], [0, 230, 90], [0, 0, 0]],
  ];
  const VARS = ["zf", "zp", "zb", "zo", "zt", "zs", "za", "zh"];
  const FONDOS = ["Color del tema", "Aurora", "Noche", "Costa", "Atardecer", "Circuito", "Papel", "Fondo del ZYHT32", "Mi imagen"];
  const WALLS = ["Degradado", "Aurora", "Retro", "Circuito", "Espacio", "Negro"];   // los 6 fondos de pantalla integrados del ZYHT32

  // ---- los fondos de pantalla del ZYHT32 (mismo dibujo que el firmware, a 160×118)
  function drawWall(cv, idx) {
    const w = 160, h = 118; cv.width = w; cv.height = h;
    const g = cv.getContext("2d"); let seed = 7 + idx * 131;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) & 0x7fff; };
    const c = (r, gg, b) => `rgb(${Math.max(0, Math.min(255, r | 0))},${Math.max(0, Math.min(255, gg | 0))},${Math.max(0, Math.min(255, b | 0))})`;
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    const hl = (x, y, len, col) => { g.fillStyle = col; g.fillRect(x, y, len, 1); };
    const line = (x0, y0, x1, y1, col) => { let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy; for (;;) { px(x0, y0, col); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } } };
    const disc = (cx, cy, r, col) => { g.fillStyle = col; for (let y = -r; y <= r; y++) { const dx = Math.floor(Math.sqrt(r * r - y * y)); g.fillRect(cx - dx, cy + y, dx * 2 + 1, 1); } };
    const ring = (cx, cy, r, col) => { for (let a = 0; a < 360; a += 2) px(Math.round(cx + r * Math.cos(a * Math.PI / 180)), Math.round(cy + r * Math.sin(a * Math.PI / 180)), col); };
    if (idx === 1) {
      for (let y = 0; y < h; y++) hl(0, y, w, c(4, 8 + y * 20 / h, 24 + y * 30 / h));
      for (let band = 0; band < 3; band++) for (let x = 0; x < w; x++) {
        const yy = h * (0.30 + band * 0.12) + Math.sin((x + band * 37) * 0.06) * 10 + Math.sin(x * 0.021 + band) * 6;
        for (let k = 0; k < 18; k++) { const py = Math.trunc(yy) + k; if (py < 0 || py >= h) continue; const a = 18 - k; px(x, py, c(20 + a * 2, 90 + a * 8 - band * 20, 80 + a * 5 + band * 15)); }
      }
      for (let i = 0; i < 25; i++) { const x = rnd() % w, y = rnd() % Math.floor(h / 3); px(x, y, "#fff"); }
    } else if (idx === 2) {
      const hz = Math.floor(h * 55 / 100);
      for (let y = 0; y < hz; y++) hl(0, y, w, c(30 + y * 140 / hz, 8, 60 + y * 30 / hz));
      for (let y = hz; y < h; y++) hl(0, y, w, c(12, 4, 28));
      const cx = w >> 1, r = w >> 2;
      for (let y = -r; y <= 0; y++) { if (Math.trunc(y / 3) % 2 && y < -Math.trunc(r / 3)) continue; const dx = Math.floor(Math.sqrt(r * r - y * y)); hl(cx - dx, hz + y - 2, dx * 2, c(255, 120 + (y + r) * 100 / r, 40)); }
      for (let i = 0; i < 9; i++) hl(0, hz + Math.floor(i * i * (h - hz) / 64), w, c(255, 40, 200));
      for (let i = -8; i <= 8; i++) line(cx + i * 6, hz, cx + Math.trunc(i * w / 4), h, c(255, 40, 200));
    } else if (idx === 3) {
      g.fillStyle = c(4, 26, 18); g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        const x = (rnd() % (w >> 3)) * 8 + 4, y = (rnd() % (h >> 3)) * 8 + 4, col = c(30, 150 + rnd() % 80, 90), len = 8 * (2 + rnd() % 6), horiz = rnd() & 1;
        const x2 = horiz ? Math.min(w - 4, x + len) : x, y2 = horiz ? y : Math.min(h - 4, y + len);
        line(x, y, x2, y2, col);
        const x3 = x2 + (horiz ? 0 : 8), y3 = y2 + (horiz ? 8 : 0);
        if (x3 < w && y3 < h) line(x2, y2, x3, y3, col);
        disc(x, y, 2, c(200, 170, 60)); disc(x3 < w ? x3 : x2, y3 < h ? y3 : y2, 2, c(200, 170, 60));
      }
      g.fillStyle = c(20, 20, 24); g.fillRect(w / 2 - 14, h / 2 - 14, 28, 28);
      for (let k = 0; k < 6; k++) { hl(w / 2 - 18, h / 2 - 11 + k * 4, 4, c(180, 180, 190)); hl(w / 2 + 14, h / 2 - 11 + k * 4, 4, c(180, 180, 190)); }
    } else if (idx === 4) {
      for (let y = 0; y < h; y++) hl(0, y, w, c(2, 2, 10 + y * 18 / h));
      for (let i = 0; i < 90; i++) { const b = 120 + rnd() % 135, x = rnd() % w, y = rnd() % h; px(x, y, c(b, b, 255)); }
      const cx = Math.floor(w * 3 / 4), cy = Math.floor(h * 3 / 4), r = Math.floor(w / 5);
      disc(cx, cy, r, c(60, 40, 120)); disc(cx - 4, cy - 4, r - 4, c(110, 80, 190)); ring(cx, cy, r + 6, c(200, 160, 255));
    } else if (idx === 5) { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); }
    else for (let y = 0; y < h; y += 2) { const v = 6 + Math.floor(y * 10 / h); g.fillStyle = c(v, v + 4, v * 2 + 10); g.fillRect(0, y, w, 2); }
    return cv;
  }
  const wallURL = (idx) => drawWall(document.createElement("canvas"), idx).toDataURL("image/png");


  // ---------------------------------------------------------------- voz: grabar (MP3 mono 16 kHz 64 kbps, como el ZYHT32) y reproducir
  const EMOJIS = "😀 😂 🤣 😊 😍 😘 😎 🤔 😅 😢 😭 😡 👍 👎 👏 🙏 💪 🔥 ❤️ 💚 ✨ 🎉 🎮 🤖 📡 🔧 💡 📷 🎵 🍕 ☕ 🚀 ✅ ❌ ⚡ 🌎 👀 🙌 😴 🤝".split(" ");
  let lameP = null;
  const loadLame = () => lameP || (lameP = new Promise((ok, no) => { if (window.lamejs) return ok(); const sc = document.createElement("script"); sc.src = "/vendor/lame.min.js"; sc.onload = ok; sc.onerror = () => { lameP = null; no(new Error("No se pudo cargar el codificador de audio.")); }; document.head.append(sc); }));
  async function toMp3(blob) {
    await loadLame();
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
    const dur = Math.min(30, buf.duration), n = Math.max(1, Math.ceil(dur * 16000));
    const off = new OfflineAudioContext(1, n, 16000), src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0), i16 = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) i16[i] = Math.max(-1, Math.min(1, pcm[i])) * 32767;
    const enc = new lamejs.Mp3Encoder(1, 16000, 64), parts = [];
    for (let i = 0; i < i16.length; i += 1152) { const c = enc.encodeBuffer(i16.subarray(i, i + 1152)); if (c.length) parts.push(new Uint8Array(c)); }
    const e = enc.flush(); if (e.length) parts.push(new Uint8Array(e));
    return { blob: new Blob(parts, { type: "audio/mpeg" }), dur: Math.max(1, Math.round(dur)) };
  }
  const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  let playing = null;
  function voiceBubble(m) {
    const btn = el("button", { type: "button", className: "zy-play", textContent: "▶", title: "Escuchar" }), bar = el("i", {}), t = el("small", { textContent: mmss(m.dur || 0) });
    if (m.expired) { btn.disabled = true; return el("div", { className: "zy-voice" }, btn, el("span", { className: "small", textContent: "Audio vencido" })); }
    let au = null;
    btn.onclick = () => {
      if (au && !au.paused) { au.pause(); return; }
      if (playing && playing !== au) playing.pause();
      if (!au) {
        au = new Audio("/api/zy/voice/" + encodeURIComponent(m.voice)); au.preload = "auto";
        au.onplay = () => { btn.textContent = "❚❚"; playing = au; }; au.onpause = () => { btn.textContent = "▶"; };
        au.ontimeupdate = () => { bar.style.width = (au.duration ? au.currentTime / au.duration * 100 : 0) + "%"; t.textContent = mmss(au.currentTime); };
        au.onended = () => { btn.textContent = "▶"; bar.style.width = "0"; t.textContent = mmss(m.dur || 0); };
        au.onerror = () => { toast("No se pudo reproducir el audio."); btn.textContent = "▶"; au = null; };
      }
      au.play().catch(() => {});
    };
    return el("div", { className: "zy-voice" }, btn, el("div", { className: "zy-wave" }, bar), t);
  }
  function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.14); setTimeout(() => a.close(), 400); } catch { /* sin audio */ } }
  const dayLabel = (t) => { const d = new Date(t * 1000), n = new Date(), y = new Date(Date.now() - 864e5); return d.toDateString() === n.toDateString() ? "Hoy" : d.toDateString() === y.toDateString() ? "Ayer" : d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }); };

  const ZS = { me: null, chats: [], key: "*", msgs: [], last: 0, theme: 0, fondo: 0, wall: 0, img: "", timer: null, busy: false, mobileChat: false };
  const css = (el0, t) => { THEMES[t].slice(1).forEach((rgb, i) => el0.style.setProperty("--" + VARS[i], `rgb(${rgb.join(",")})`)); };
  const bgStyle = (st) => {
    const f = st.fondo;
    if (f >= 1 && f <= 6) return `url('/zyphora/fondos/f${f}.png')`;
    if (f === 7) return `url('${wallURL(st.wall)}')`;
    if (f === 8 && st.img) return `url('${st.img}')`;
    return "none";
  };
  const when = (t) => { const d = new Date(t * 1000), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("es", { day: "numeric", month: "short" }); };
  const chatTitle = (k) => { const c = ZS.chats.find((x) => x.key === k); return k === "*" ? "# Sala general" : c ? (k[0] === "#" ? "# " + c.title : c.title + " " + (c.handle || "")) : k; };

  function applyLook(root) { css(root, ZS.theme); root.style.setProperty("--zbg", bgStyle(ZS)); }

  async function loadMe() {
    const r = await api("zy/me");
    ZS.me = r.me; ZS.chats = r.chats; ZS.unread = r.unread;
    if (!ZS.loaded) { ZS.theme = r.me.theme; ZS.fondo = r.me.fondo; ZS.wall = r.me.wall; ZS.loaded = true; if (r.me.has_img) ZS.img = (await api("zy/wallpaper")).img; }
  }
  async function loadChat(reset) {
    const key = ZS.key, after = reset ? 0 : ZS.last;
    const r = await api("zy/chat?key=" + encodeURIComponent(key) + (after ? "&after=" + after : ""));
    if (key !== ZS.key) return false;
    if (reset) ZS.msgs = [];
    const have = new Set(ZS.msgs.map((x) => x.id)); ZS.msgs.push(...r.messages.filter((x) => !have.has(x.id))); if (r.last) ZS.last = Math.max(ZS.last, r.last);
    return r.messages.length > 0 || reset;
  }

  function view() {
    const root = el("div", { className: "zy" });
    if (!state.user) { location.hash = "#/entrar"; return root; }
    ZS.mobileChat = false;
    const list = el("aside", { className: "zy-list" }), pane = el("section", { className: "zy-pane" });
    root.append(list, pane);
    const stop = () => { clearInterval(ZS.timer); ZS.timer = null; };
    stop();

    function paintList() {
      const me = ZS.me;
      list.replaceChildren(
        el("div", { className: "zy-head" },
          el("div", { className: "zy-av", textContent: (me.name || "?")[0].toUpperCase() }),
          el("div", { className: "zy-who" }, el("b", { textContent: me.name }), el("span", { textContent: "@" + me.username })),
          ZS.unread ? el("span", { className: "zy-badge", textContent: ZS.unread > 9 ? "9+" : ZS.unread }) : "",
          el("button", { className: "zy-ic", title: "Activar avisos", textContent: "🔔", onclick: askNotif }),
          el("button", { className: "zy-ic", title: "Temas y fondos", textContent: "🎨", onclick: openLook }),
          el("button", { className: "zy-ic", title: "Vincular mi ZYHT32", textContent: "🔗", onclick: openPair })),
        el("div", { className: "zy-tools" },
          el("button", { className: "zy-btn", textContent: "+ Contacto", onclick: addContact }),
          el("button", { className: "zy-btn", textContent: "+ Grupo", onclick: addGroup })),
        el("div", { style: "padding:0 8px 6px" }, Object.assign(el("input", { className: "zy-in", placeholder: "Buscar chat…", value: ZS.q || "", style: "width:100%" }), { oninput: (e) => { ZS.q = e.target.value; paintList(); list.querySelector(".zy-in").focus(); } })),
        el("div", { className: "zy-chats" }, ...ZS.chats.filter((c) => !ZS.q || (c.title + " " + (c.handle || "")).toLowerCase().includes(ZS.q.toLowerCase())).map((c) => el("button", { className: "zy-chat" + (c.key === ZS.key ? " on" : ""), onclick: () => openChat(c.key) },
          el("div", { className: "zy-av sm", textContent: c.key === "*" ? "#" : c.key[0] === "#" ? "#" : c.title[0].toUpperCase() }),
          el("div", { className: "zy-ct" }, el("b", { textContent: c.key === "*" ? "Sala general" : c.key[0] === "#" ? "# " + c.title : c.title }),
            el("span", { textContent: c.last ? (c.last.mine ? "Tú: " : "") + c.last.text : c.key === "*" ? "Di hola a todos" : "Sin mensajes" })),
          el("div", { className: "zy-cm" }, c.last ? el("small", { textContent: when(c.last.at) }) : "", c.unread ? el("span", { className: "zy-badge", textContent: c.unread > 9 ? "9+" : c.unread }) : "")))),
        el("a", { className: "zy-back", href: "#/cuenta", textContent: "⚙ Cuenta ZYH" }));
    }
    function paintPane(scroll) {
      const near = pane.querySelector(".zy-msgs");
      const stick = !near || near.scrollHeight - near.scrollTop - near.clientHeight < 80;
      const input = el("input", { className: "zy-in", placeholder: "Mensaje…", maxLength: 500, autocomplete: "off" });
      const emo = el("div", { className: "zy-emo", hidden: true }, ...EMOJIS.map((e) => el("button", { type: "button", textContent: e, onclick: () => { input.value += e; input.focus(); } })));
      const recBar = el("div", { className: "zy-rec", hidden: true }), form = el("form", { className: "zy-form" },
        el("button", { className: "zy-ic dark", type: "button", title: "Emojis", textContent: "😊", onclick: () => { emo.hidden = !emo.hidden; } }), input,
        el("button", { className: "zy-ic dark", type: "button", title: "Nota de voz", textContent: "🎤", onclick: () => startRec(recBar, form) }),
        el("button", { className: "zy-send", type: "submit", textContent: "Enviar ➤" }));
      form.onsubmit = async (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ""; emo.hidden = true;
        try { await api("zy/send", { method: "POST", body: { to: ZS.key, text: t } }); await refresh(true); } catch (er) { toast(er.message); input.value = t; } };
      const grp = ZS.key[0] === "#", dm = ZS.key[0] === "@";
      const rows = []; let lastDay = "";
      for (const m of ZS.msgs) {
        const dl = dayLabel(m.at); if (dl !== lastDay) { rows.push(el("div", { className: "zy-day" }, el("span", { textContent: dl }))); lastDay = dl; }
        const nm = (!m.mine && ZS.key !== "@" + m.from) ? el("small", { className: "zy-nm", textContent: m.name }) : "";
        const del = m.mine ? el("button", { type: "button", className: "zy-del", title: "Borrar", textContent: "🗑", onclick: async () => { if (!confirm("¿Borrar este mensaje para todos?")) return; await api("zy/msg/" + m.id, { method: "DELETE" }).catch((e) => toast(e.message)); await loadChat(true); paintPane(false); } }) : "";
        rows.push(el("div", { className: "zy-row" + (m.mine ? " me" : "") }, del, el("div", { className: "zy-bub" }, nm, m.voice ? voiceBubble(m) : el("span", { textContent: m.text }), el("small", { className: "zy-tm", textContent: when(m.at) }))));
      }
      const msgs = el("div", { className: "zy-msgs" }, ...(rows.length ? rows : [el("div", { className: "zy-empty" }, el("b", { textContent: "Sin mensajes" }), el("span", { textContent: "¡Di hola!" }))]));
      pane.replaceChildren(
        el("div", { className: "zy-bar" }, el("button", { className: "zy-ic back", textContent: "‹", onclick: () => { ZS.mobileChat = false; root.classList.remove("chat"); } }),
          el("b", { textContent: chatTitle(ZS.key) }),
          grp ? el("button", { className: "zy-btn sm", textContent: "Salir del grupo", onclick: async () => { await api("zy/groups/" + encodeURIComponent(ZS.key.slice(1)), { method: "DELETE" }); ZS.key = "*"; await refresh(true, true); } })
            : dm ? el("button", { className: "zy-btn sm", textContent: "Quitar contacto", onclick: async () => { await api("zy/contacts/" + encodeURIComponent(ZS.key.slice(1)), { method: "DELETE" }); ZS.key = "*"; await refresh(true, true); } }) : ""),
        msgs, emo, recBar, form);
      const box = pane.querySelector(".zy-msgs"); if (stick || scroll) box.scrollTop = box.scrollHeight;
      if (scroll) input.focus({ preventScroll: true });
    }

    async function startRec(bar, form) {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Tu navegador no puede grabar audio."); return; }
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast("Permite el micrófono para enviar notas de voz."); return; }
      const mr = new MediaRecorder(stream), chunks = []; let t0 = Date.now(), cancel = false, tick;
      const stopAll = () => { clearInterval(tick); stream.getTracks().forEach((x) => x.stop()); bar.hidden = true; form.hidden = false; };
      const time = el("b", { textContent: "0:00" });
      bar.replaceChildren(el("span", { className: "zy-dot" }), el("span", { textContent: "Grabando " }), time, el("small", { textContent: " (máx. 30 s)" }),
        el("button", { type: "button", className: "zy-btn sm", textContent: "Cancelar", onclick: () => { cancel = true; mr.stop(); } }),
        el("button", { type: "button", className: "zy-send", textContent: "Enviar ➤", onclick: () => mr.stop() }));
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stopAll(); if (cancel) return;
        try {
          toast("Enviando nota de voz…");
          const { blob, dur } = await toMp3(new Blob(chunks, { type: mr.mimeType }));
          if (blob.size > 262144) throw new Error("La nota quedó muy larga.");
          const r = await fetch("/api/zy/voice?to=" + encodeURIComponent(ZS.key) + "&dur=" + dur + "&mime=audio%2Fmpeg", { method: "POST", credentials: "same-origin", headers: { "content-type": "audio/mpeg" }, body: blob });
          const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "No se pudo enviar.");
          await refresh(true);
        } catch (e) { toast(e.message); }
      };
      form.hidden = true; bar.hidden = false; mr.start();
      tick = setInterval(() => { const s = (Date.now() - t0) / 1000; time.textContent = mmss(s); if (s >= 30) mr.stop(); }, 250);
    }

    function notify(prevUnread, prevMap) {
      document.title = (ZS.unread ? "(" + ZS.unread + ") " : "") + "ZyhStudios · Zyphora";
      if (ZS.unread <= prevUnread) return;
      const fresh = ZS.chats.find((c) => c.unread > (prevMap[c.key] || 0) && c.key !== ZS.key || (c.key === ZS.key && c.unread > (prevMap[c.key] || 0) && document.hidden));
      if (!fresh) return;
      if (ZS.sound !== false) beep();
      if (document.hidden && "Notification" in window && Notification.permission === "granted") { try { new Notification(chatTitleOf(fresh), { body: fresh.last ? fresh.last.text : "Mensaje nuevo" }); } catch { /* sin avisos */ } }
    }
    const chatTitleOf = (c) => c.key === "*" ? "Sala general" : c.key[0] === "#" ? "# " + c.title : c.title;
    async function askNotif() {
      if (!("Notification" in window)) return toast("Tu navegador no tiene avisos.");
      const p = await Notification.requestPermission(); toast(p === "granted" ? "Avisos activados." : "Avisos desactivados.");
    }
    async function refresh(force, reset) {
      if (ZS.busy) return; ZS.busy = true;
      try {
        const before = JSON.stringify(ZS.chats.map((c) => [c.key, c.unread, c.last?.at]));
        const prevUnread = ZS.unread || 0, prevMap = Object.fromEntries(ZS.chats.map((c) => [c.key, c.unread]));
        await loadMe();
        notify(prevUnread, prevMap);
        const changed = await loadChat(reset || false);
        if (changed || force || before !== JSON.stringify(ZS.chats.map((c) => [c.key, c.unread, c.last?.at]))) { paintList(); if (changed || force) paintPane(force); }
        else paintList();
      } catch (e) { if (/401|sesión/i.test(e.message)) location.hash = "#/entrar"; }
      ZS.busy = false;
    }
    async function openChat(key) { ZS.key = key; ZS.msgs = []; ZS.last = 0; ZS.mobileChat = true; root.classList.add("chat"); await loadChat(true); await refresh(true); }
    async function addContact() {
      const u = prompt("Usuario del contacto (su nombre de usuario ZYH):"); if (!u) return;
      try { const r = await api("zy/contacts", { method: "POST", body: { username: u.replace(/^@/, "") } }); await openChat(r.key); } catch (e) { toast(e.message); }
    }
    async function addGroup() {
      const n = prompt("Nombre del grupo (para unirte o crearlo; sin espacios):"); if (!n) return;
      try { const r = await api("zy/groups", { method: "POST", body: { name: n } }); await openChat(r.key); } catch (e) { toast(e.message); }
    }
    async function openPair() {
      try {
        const r = await api("zy/pair", { method: "POST" });
        const ov = el("div", { className: "tt-ov" }), close = () => ov.remove();
        ov.append(el("div", { className: "tt-box" }, el("h2", { style: "margin:0 0 6px" }, "Vincular tu ZYHT32"),
          el("p", { className: "small muted" }, "En el ZYHT32: Zyphora → Mi cuenta ZYH → Vincular con la web, y escribe este código."),
          el("p", { className: "tt-handle", style: "letter-spacing:8px;font-size:40px", textContent: r.code }),
          el("p", { className: "small muted" }, "Sirve una vez y vence en 10 minutos. Así no escribes tu clave en el aparato."),
          el("button", { className: "btn", type: "button", textContent: "Listo", onclick: close })));
        ov.onclick = (e) => { if (e.target === ov) close(); }; document.body.append(ov);
      } catch (e) { toast(e.message); }
    }
    function openLook() {
      const draft = { theme: ZS.theme, fondo: ZS.fondo, wall: ZS.wall, img: ZS.img, newImg: undefined, name: ZS.me.name, descr: ZS.me.descr || "" };
      const ov = el("div", { className: "tt-ov" }), box = el("div", { className: "zy zy-look" });
      const prev = el("div", { className: "zy-prev" }, el("div", { className: "zy-bar" }, el("b", { textContent: "Vista previa" })),
        el("div", { className: "zy-msgs" }, el("div", { className: "zy-row" }, el("div", { className: "zy-bub" }, el("span", { textContent: "Hola! que tal?" }))),
          el("div", { className: "zy-row me" }, el("div", { className: "zy-bub" }, el("span", { textContent: "Muy bien :)" })))));
      const themes = el("div", { className: "zy-chips" }), fondos = el("div", { className: "zy-fgrid" });
      const paint = () => {
        applyLook2(prev, draft); applyLook2(box, draft, true);
        themes.replaceChildren(...THEMES.map((t, i) => el("button", { type: "button", className: "zy-chip" + (draft.theme === i ? " on" : ""), onclick: () => { draft.theme = i; paint(); } },
          el("i", { style: `background:rgb(${t[1].join(",")});border-color:rgb(${t[7].join(",")})` }), t[0])));
        fondos.replaceChildren(...FONDOS.map((n, i) => {
          const th = el("div", { className: "zy-th" });
          if (i >= 1 && i <= 6) th.style.backgroundImage = `url('/zyphora/fondos/f${i}.png')`;
          if (i === 7) th.style.backgroundImage = `url('${wallURL(draft.wall)}')`;
          if (i === 8 && draft.img) th.style.backgroundImage = `url('${draft.img}')`;
          if (i === 0) th.style.background = `rgb(${THEMES[draft.theme][1].join(",")})`;
          return el("button", { type: "button", className: "zy-f" + (draft.fondo === i ? " on" : ""), onclick: () => { draft.fondo = i; paint(); } }, th, el("span", { textContent: n }));
        }));
        wallSel.style.display = draft.fondo === 7 ? "" : "none"; fileRow.style.display = draft.fondo === 8 ? "" : "none";
      };
      const wallSel = el("div", { className: "zy-chips" }, ...WALLS.map((n, i) => el("button", { type: "button", className: "zy-chip", onclick: () => { draft.wall = i; paint(); } }, n)));
      const file = el("input", { type: "file", accept: "image/png,image/jpeg" });
      file.onchange = () => {
        const f = file.files[0]; if (!f) return;
        const url = URL.createObjectURL(f), im = new Image();
        im.onload = () => {                                   // se reduce a 160×118 como el ZYHT32 (y pesa poco)
          const cv = document.createElement("canvas"); cv.width = 160; cv.height = 118; const g = cv.getContext("2d");
          const s = Math.max(160 / im.width, 118 / im.height), w = im.width * s, h = im.height * s; g.drawImage(im, (160 - w) / 2, (118 - h) / 2, w, h);
          draft.img = cv.toDataURL("image/jpeg", 0.85); draft.newImg = draft.img; URL.revokeObjectURL(url); paint();
        }; im.src = url;
      };
      const fileRow = el("div", { style: "margin:8px 0" }, el("label", { className: "small" }, "Elige una imagen de tu equipo (se ajusta a la pantalla del ZYHT32): "), file);
      const nm = el("input", { value: draft.name, maxLength: 24, placeholder: "Nombre visible" }), ds = el("input", { value: draft.descr, maxLength: 60, placeholder: "Descripción" });
      nm.oninput = () => draft.name = nm.value; ds.oninput = () => draft.descr = ds.value;
      const err = el("p", { className: "err" });
      box.append(el("h2", { style: "margin:0 0 8px" }, "Temas y fondos"), prev, el("h3", {}, "Tema"), themes, el("h3", {}, "Fondo"), fondos,
        el("div", {}, el("p", { className: "small muted", style: "margin:8px 0 4px" }, "Fondo de pantalla del ZYHT32:"), wallSel), fileRow,
        el("h3", {}, "Tu perfil en Zyphora"), nm, ds, err,
        el("div", { className: "row", style: "justify-content:flex-end;margin-top:14px" },
          el("button", { className: "btn ghost", type: "button", textContent: "Cancelar", onclick: () => ov.remove() }),
          el("button", { className: "btn", type: "button", textContent: "Guardar", onclick: async () => {
            try {
              const body = { name: draft.name, descr: draft.descr, theme: draft.theme, fondo: draft.fondo, wall: draft.wall };
              if (draft.newImg) body.img = draft.newImg;
              await api("zy/profile", { method: "PUT", body });
              ZS.theme = draft.theme; ZS.fondo = draft.fondo; ZS.wall = draft.wall; if (draft.newImg) ZS.img = draft.newImg;
              applyLook(root); ov.remove(); toast("Guardado. Tu ZYHT32 también lo usará."); await refresh(true, true);
            } catch (e) { err.textContent = e.message; } } })));
      ov.append(box); ov.onclick = (e) => { if (e.target === ov) ov.remove(); }; document.body.append(ov); paint();
    }
    function applyLook2(node, d, noBg) { css(node, d.theme); if (!noBg) { node.style.setProperty("--zbg", bgStyle({ fondo: d.fondo, wall: d.wall, img: d.img })); } }

    (async () => {
      try { await loadMe(); applyLook(root); await loadChat(true); paintList(); paintPane(false); } catch (e) { root.replaceChildren(el("p", { className: "err", textContent: e.message })); return; }
      ZS.timer = setInterval(() => { if (document.hidden) return; if (!location.hash.startsWith("#/zyphora")) { stop(); return; } refresh(false); }, 3000);
    })();
    return root;
  }
  window.ZY = { view };
})();
