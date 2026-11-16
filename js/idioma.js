/* FireCal · Idioma (English / Español)
 * La página está escrita en español. Si el idioma elegido es inglés (por defecto),
 * este archivo traduce todo el texto que aparece en pantalla: el HTML, lo que la app
 * escribe después (tablas, fichas, avisos) y los textos de los gráficos (ECharts).
 * El idioma se guarda en este navegador (localStorage "firecal_lang").
 */
(function () {
  "use strict";
  let lang = "en";
  try { lang = localStorage.getItem("firecal_lang") || "en"; } catch (e) { /* sin almacenamiento */ }
  if (lang !== "es") lang = "en";
  const EN = lang === "en";
  window.FC_LANG = lang;
  document.documentElement.lang = lang;

  // Diccionarios (js/idioma-en.js). En las claves: "#" = un número, "@" = un mes, "\#" = el signo #.
  const NUMC = "", MESC = "";
  const conv = (k) => k.replace(/\\#|#|@/g, (m) => (m === "\\#" ? "#" : m === "#" ? NUMC : MESC));
  const D = {};
  for (const [k, v] of Object.entries(window.FC_DICT || {})) D[conv(k)] = conv(v);
  const FRASES = (window.FC_FRASES || []).map(([es, en]) => [conv(es), conv(en)]);
  const NUM = /\d+(?:[.,]\d+)*/g;
  const MES = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;
  const LETRA = /\p{L}/u;
  const ESP = /[áéíóúñ¿¡]|\b(?:de|del|el|los|las|con|para|por|que|en|un|una|y)\b/i;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const frasesRe = FRASES.slice().sort((x, y) => y[0].length - x[0].length)
    .map(([es, en]) => [new RegExp((/^\p{L}/u.test(es) ? "(?<![\\p{L}])" : "") + esc(es) + (/\p{L}$/u.test(es) ? "(?![\\p{L}])" : ""), "gu"), en]);
  const faltan = (window.FC_FALTAN = new Set());

  function traducir(s) {
    if (!EN || typeof s !== "string" || !LETRA.test(s)) return s;
    const ini = s.match(/^\s*/)[0], fin = s.match(/\s*$/)[0];
    const t = s.trim().replace(/\s+/g, " ");
    if (!t) return s;
    const nums = [], meses = [];
    const clave = t.replace(MES, (m) => { meses.push(m); return MESC; }).replace(NUM, (m) => { nums.push(m); return NUMC; });
    let r;
    if (Object.prototype.hasOwnProperty.call(D, clave)) r = D[clave];
    else {
      r = clave;
      for (const [re, en] of frasesRe) r = r.replace(re, en);
      if (ESP.test(r)) faltan.add(clave.replace(//g, "#").replace(//g, "@"));
      if (r === clave) return s;
    }
    let i = 0, j = 0;
    r = r.replace(//g, () => nums[i++] ?? "").replace(//g, () => meses[j++] ?? "");
    return ini + r + fin;
  }
  window.FC_T = traducir;

  // ---------- Texto de la página (HTML y lo que la app escribe después) ----------
  const ATRIBUTOS = ["title", "placeholder", "aria-label", "alt", "data-tip"];
  const escrito = new WeakMap();
  const saltar = (n) => { const p = n.parentElement; return !p || p.closest("script,style,textarea,.no-traducir"); };
  function nodoTexto(n) {
    if (saltar(n) || escrito.get(n) === n.data) return;
    const t = traducir(n.data);
    if (t !== n.data) { n.data = t; }
    escrito.set(n, n.data);
  }
  function atributos(el) {
    for (const a of ATRIBUTOS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      const k = "__fc_" + a;
      if (el[k] === v) continue;
      const t = traducir(v);
      el[k] = t;
      if (t !== v) el.setAttribute(a, t);
    }
  }
  function recorrer(raiz) {
    if (raiz.nodeType === 3) return nodoTexto(raiz);
    if (raiz.nodeType !== 1 && raiz.nodeType !== 9 && raiz.nodeType !== 11) return;
    if (raiz.nodeType === 1) { if (raiz.closest("script,style,.no-traducir")) return; atributos(raiz); }
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) nodoTexto(n); else atributos(n); }
  }

  if (EN) {
    const obs = new MutationObserver((lista) => {
      for (const m of lista) {
        if (m.type === "characterData") nodoTexto(m.target);
        else if (m.type === "attributes") atributos(m.target);
        else m.addedNodes.forEach(recorrer);
      }
    });
    const empezar = () => {
      if (document.title) document.title = traducir(document.title);
      recorrer(document.body);
      obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
    };
    if (document.body) empezar(); else document.addEventListener("DOMContentLoaded", empezar);
  }

  // ---------- Gráficos (ECharts dibuja en canvas: se traducen sus opciones) ----------
  const NO_TEXTO = new Set(["type", "id", "color", "borderColor", "backgroundColor", "shadowColor", "fontFamily", "fontWeight", "symbol", "stack", "position", "orient", "align", "verticalAlign", "trigger", "coordinateSystem", "left", "right", "top", "bottom", "width", "height", "cellSize", "range", "renderer"]);
  function opciones(o, clave) {
    if (typeof o === "string") return NO_TEXTO.has(clave) ? o : traducir(o);
    if (typeof o === "function") return function () { const r = o.apply(this, arguments); return typeof r === "string" ? traducir(r) : r; };
    if (Array.isArray(o)) return o.map((x) => opciones(x, clave));
    if (o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype) {
      const r = {};
      for (const k in o) r[k] = opciones(o[k], k);
      return r;
    }
    return o;
  }
  if (EN && window.echarts) {
    const init = window.echarts.init;
    window.echarts.init = function () {
      const g = init.apply(this, arguments);
      const set = g.setOption;
      g.setOption = function (o) { const a = Array.prototype.slice.call(arguments); a[0] = opciones(o, ""); return set.apply(this, a); };
      return g;
    };
  }

  // ---------- Botón para cambiar de idioma ----------
  window.FC_CAMBIAR_IDIOMA = function (nuevo) {
    try { localStorage.setItem("firecal_lang", nuevo); } catch (e) { /* nada */ }
    location.reload();
  };
})();
