/*
 * FireCal — aplicación principal.
 * Mapa mundial (Leaflet + NASA GIBS), calendario de fuego (ECharts),
 * anomalías, temporada crítica, tendencia y clima (NASA POWER).
 */
(function () {
  "use strict";
  const S = window.FCStats;
  // Errores visibles en la página (para encontrar fallas sin abrir la consola)
  function mostrarError(msg) {
    let caja = document.getElementById("caja-error");
    if (!caja) {
      caja = document.createElement("div");
      caja.id = "caja-error";
      document.body.appendChild(caja);
    }
    caja.innerHTML = `⚠️ <b>Error en FireCal:</b> ${String(msg).replace(/</g, "&lt;")} <button type="button" onclick="this.parentNode.remove()">✕</button>`;
    console.error("[FireCal]", msg);
  }
  window.addEventListener("error", (e) => mostrarError(`${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => mostrarError(e.reason && e.reason.message ? e.reason.message : e.reason));

  // ---------- Configuración ----------
  const URL_PAISES = [
    "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson",
    "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson",
  ];
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
  const EN = window.FC_LANG === "en"; // idioma elegido (js/idioma.js)
  const MESES = EN ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] : ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const MESES_LARGOS = EN ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] : ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  // Paletas (tema oscuro): secuencial naranja (magnitud) y divergente azul–gris–rojo (anomalía)
  const C = {
    texto: "#f0efec", texto2: "#c3c2b7", tenue: "#8f8e85", rejilla: "#2f2f2c", superficie: "#1a1a19",
    secuencial: ["#26211e", "#4a2a1a", "#7a3414", "#ad430f", "#d95926", "#ec835a", "#f6b48e", "#fde3cf"],
    divergente: ["#86b6ef", "#3987e5", "#1c5cab", "#383835", "#9e2f2c", "#d03b3b", "#f08a7e"],
    serieAnio: "#ec835a", serieNormal: "#c3c2b7", banda: "rgba(195,194,183,0.16)",
    lluvia: "#3987e5", humedad: "#199e70",
    estado: { critico: "#d03b3b", serio: "#ec835a", normal: "#0ca30c", bajo: "#3987e5" },
  };
  const fmt = new Intl.NumberFormat("es-PE");
  const fmt1 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  // Eras de satélites: antiguos (MODIS, 1 km) hasta 2011 y modernos (VIIRS, 375 m) desde 2012
  const COLOR_MODIS = "#3987e5", COLOR_VIIRS = "#d95926";
  function eraDe(y) {
    if (estado.serie && estado.serie.origen === "navegador") return "VIIRS"; // descargado en vivo: solo VIIRS
    return y < 2012 ? "MODIS" : "VIIRS";
  }
  function eraTexto(y, corto) {
    const e = eraDe(y);
    if (corto) return e === "MODIS" ? "MODIS · antiguo" : "VIIRS · moderno";
    return e === "MODIS" ? "satélites antiguos MODIS (Terra/Aqua, 1 km), ajustados a VIIRS" : "satélites modernos VIIRS (375 m)";
  }
  const hoy = new Date();
  const AYER_ISO = S.isoFecha(new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1)));

  const reales = (window.FIRECAL_DATOS_REALES && window.FIRECAL_DATOS_REALES.areas) || {};

  // ---------- Estado ----------
  const estado = {
    area: null,      // { clave, nombre, bbox, lat, lon, comando }
    serie: null,     // { inicio, diario, ejemplo, viirs_desde }
    anio: null,
    metrica: "actividad",
    base: null,      // [anioIni, anioFin]
    calc: null,      // resultados calculados
  };
  const graficos = {};
  let ignorarClicHasta = 0;
  let RENDER = null, RENDER_DENS = null; // un solo lienzo para todos los puntos y áreas (varios lienzos se tapan los clics entre sí)
  let capaVivo = null, capaDensidad = null, leyendaDensidad = null;
  const regionesEnfoque = (window.FIRECAL_REGIONES && window.FIRECAL_REGIONES.features) || [];
  const densidadProyecto = (window.FIRECAL_DENSIDAD && window.FIRECAL_DENSIDAD.areas) || {};
  let capaPaises = null, capaSeleccion = null, capaDiaria = null, mapa = null, controlCapas = null;
  const paisesPorNombre = new Map();

  // ---------- Utilidades ----------
  const $ = (id) => document.getElementById(id);
  function grafico(id) {
    if (!graficos[id]) graficos[id] = echarts.init($(id), null, { renderer: "canvas" });
    return graficos[id];
  }
  window.addEventListener("resize", () => Object.values(graficos).forEach((g) => g.resize()));

  const ejeBase = {
    axisLine: { lineStyle: { color: C.rejilla } },
    axisTick: { show: false },
    axisLabel: { color: C.texto2, fontSize: 11 },
    splitLine: { lineStyle: { color: C.rejilla, opacity: 0.6 } },
  };
  const tooltipBase = {
    backgroundColor: "#232321", borderColor: "#3a3a36", textStyle: { color: C.texto, fontSize: 12 },
  };
  function suavizar7(a) {
    return a.map((_, i) => {
      let s = 0, n = 0;
      for (let k = -3; k <= 3; k++) if (a[i + k] != null) { s += a[i + k]; n++; }
      return n ? s / n : null;
    });
  }

  // ---------- Mapa ----------
  function gibsCapa(capa, matriz, ext, fecha, maxNativo, nombre) {
    const url = `${GIBS}/${capa}/default/${fecha || "default"}/${matriz}/{z}/{y}/{x}.${ext}`;
    return L.tileLayer(url, {
      maxNativeZoom: maxNativo, maxZoom: 12, tileSize: 256, noWrap: false,
      attribution: `<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA GIBS</a> · ${nombre}`,
    });
  }

  function iniciarMapa() {
    mapa = L.map("mapa", { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([5, -40], 2);

    const blueMarble = gibsCapa("BlueMarble_ShadedRelief_Bathymetry", "GoogleMapsCompatible_Level8", "jpeg", null, 8, "Blue Marble");
    const blackMarble = gibsCapa("VIIRS_Black_Marble", "GoogleMapsCompatible_Level8", "png", "2016-01-01", 8, "Black Marble (luces nocturnas)");
    const oscuro = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO", subdomains: "abcd", maxZoom: 12,
    });
    capaDiaria = gibsCapa("VIIRS_SNPP_CorrectedReflectance_TrueColor", "GoogleMapsCompatible_Level9", "jpg", "2024-09-01", 9, "Imagen del día");

    blueMarble.addTo(mapa);
    // Capas propias por ENCIMA de los contornos (en Leaflet el SVG de los países queda sobre el lienzo y le roba el mouse)
    mapa.createPane("densidad"); mapa.getPane("densidad").style.zIndex = 600;
    mapa.createPane("incendios"); mapa.getPane("incendios").style.zIndex = 650;
    RENDER = L.canvas({ pane: "incendios", padding: 0.5, tolerance: 6 });
    RENDER_DENS = L.canvas({ pane: "densidad", padding: 0.5 });
    capaDensidad = L.layerGroup(); // "dónde hubo fuego": se activa desde el selector de capas
    capaVivo = L.layerGroup().addTo(mapa);
    controlCapas = L.control.layers(
      {
        "🌍 Blue Marble (NASA)": blueMarble,
        "🛰️ Imagen del día elegido (NASA)": capaDiaria,
        "🌃 Luces nocturnas (NASA)": blackMarble,
        "🗺️ Mapa oscuro": oscuro,
      },
      { "🗺️ Dónde hubo fuego (año elegido)": capaDensidad, "🔥 Focos consultados en vivo (FIRMS)": capaVivo }, { collapsed: true }
    ).addTo(mapa);

    // Dibujo de rectángulo: arrastrando (o con dos clics)
    let dibujando = false, esquina = null, rectTemp = null, arrastrando = false, inicioPx = null;
    const ponerModo = (on) => {
      dibujando = on; esquina = null; arrastrando = false;
      if (rectTemp) { mapa.removeLayer(rectTemp); rectTemp = null; }
      $("btn-dibujar").classList.toggle("activo", on);
      $("btn-dibujar").innerHTML = on ? "✖ Cancelar dibujo" : "✏️ Dibujar un área (rectángulo)";
      $("ayuda-dibujo").hidden = !on;
      mapa.getContainer().style.cursor = on ? "crosshair" : "";
      if (on) { mapa.dragging.disable(); mapa.doubleClickZoom.disable(); } else { mapa.dragging.enable(); mapa.doubleClickZoom.enable(); }
    };
    const terminar = (a, b) => {
      ignorarClicHasta = Date.now() + 500; // el "click" que sigue al soltar no debe elegir un país
      const bnd = L.latLngBounds(a, b);
      ponerModo(false);
      const r = (x) => Math.round(x * 100) / 100;
      const bbox = [r(bnd.getWest()), r(bnd.getSouth()), r(bnd.getEast()), r(bnd.getNorth())];
      if (bbox[2] - bbox[0] < 0.02 || bbox[3] - bbox[1] < 0.02) { $("vivo-estado").textContent = "El área es muy pequeña: vuelve a dibujarla más grande."; return; }
      const clave = "AREA_" + bbox.join("_").replace(/[-.]/g, (c) => (c === "-" ? "m" : "p"));
      const dep = regionDe((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2);
      seleccionarArea({
        clave, nombre: dep ? `Área dibujada (${dep})` : "Área dibujada", bbox, lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2,
        comando: `python scripts/descargar_datos.py --bbox ${bbox.join(",")} --clave ${clave} --nombre "Mi área"`,
        geo: L.rectangle(bnd),
      });
      if (!claveActual()) $("vivo-estado").innerHTML = '<span class="vivo-error">Área lista. Para ver sus incendios, pega tu MAP_KEY en el panel 3.</span>';
    };
    $("btn-dibujar").addEventListener("click", () => ponerModo(!dibujando));
    mapa.on("mousedown", (e) => {
      if (!dibujando) return;
      if (esquina) { terminar(esquina, e.latlng.wrap()); return; } // segundo clic (modo dos clics)
      esquina = e.latlng.wrap(); arrastrando = true; inicioPx = e.containerPoint;
      rectTemp = L.rectangle([esquina, esquina], { color: C.serieAnio, weight: 2, dashArray: "4", interactive: false }).addTo(mapa);
    });
    mapa.on("mousemove", (e) => { if (dibujando && rectTemp && esquina) rectTemp.setBounds(L.latLngBounds(esquina, e.latlng)); });
    mapa.on("mouseup", (e) => {
      if (!dibujando || !arrastrando) return;
      arrastrando = false;
      if (inicioPx && e.containerPoint.distanceTo(inicioPx) > 8) terminar(esquina, e.latlng.wrap()); // arrastre
      // si no se movió, queda esperando el segundo clic
    });
    mapa.on("click", (e) => {
      if (dibujando || !puntosClic || !puntosClic.lista.length) return;
      // respaldo: si el clic cayó a menos de 12 px de un incendio, abrirlo
      const p = mapa.latLngToContainerPoint(e.latlng);
      let mejor = null, dmin = 12;
      puntosClic.lista.forEach((x) => { const d = mapa.latLngToContainerPoint(x.centro).distanceTo(p); if (d < dmin) { dmin = d; mejor = x; } });
      if (mejor) { enfocarIncendio(mejor, puntosClic.hasta); return; }
    });
    // Elegir un país con clic (los lienzos de arriba no dejan pasar el clic a los contornos)
    mapa.on("click", (e) => {
      if (dibujando || Date.now() < ignorarClicHasta || !capaPaises) return;
      if (puntosClic && puntosClic.lista.some((x) => mapa.latLngToContainerPoint(x.centro).distanceTo(e.containerPoint) < 12)) return;
      const { lat, lng } = e.latlng.wrap();
      if (estado.area && filtroArea(estado.area)(lat, lng)) return; // clic dentro del área actual: no cambiar
      let hit = null;
      capaPaises.eachLayer((c) => {
        if (hit) return;
        const g = c.feature.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        if (polys.some((q) => enAnillo(lng, lat, q[0]))) hit = c;
      });
      if (hit) seleccionarPais(hit.feature, hit);
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && dibujando) ponerModo(false);
      else if (ev.key === "Escape") { limpiarResaltado(); mapa.closePopup(); }
    });
  }

  async function cargarPaises() {
    for (const url of URL_PAISES) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        return await r.json();
      } catch (e) { /* probar el siguiente */ }
    }
    return null;
  }

  function codigoPais(p) {
    const iso = p.ISO_A3 && p.ISO_A3 !== "-99" ? p.ISO_A3 : p.ADM0_A3;
    return iso;
  }

  function prepararPaises(geo) {
    const lista = $("lista-paises");
    capaPaises = L.geoJSON(geo, {
      style: () => ({ color: "#f0efec", weight: 0.6, opacity: 0.45, fillOpacity: 0.02, fillColor: "#000" }),
      onEachFeature: (f, capa) => {
        const p = f.properties;
        const nombre = (EN ? p.NAME : p.NAME_ES) || p.NAME;
        const iso = codigoPais(p);
        paisesPorNombre.set(nombre.toLowerCase(), { f, capa });
        if (iso) paisesPorNombre.set(iso.toLowerCase(), { f, capa });
        capa.bindTooltip(nombre + (reales[iso] ? " · datos reales" : ""), { sticky: true, className: "etiqueta-pais" });
        capa.on("mouseover", () => capa.setStyle({ fillOpacity: 0.12, fillColor: C.serieAnio }));
        capa.on("mouseout", () => capaPaises.resetStyle(capa));
        capa.on("click", (e) => {
          if ($("btn-dibujar").classList.contains("activo") || Date.now() < ignorarClicHasta) return; // en modo dibujo
          L.DomEvent.stopPropagation(e);
          seleccionarPais(f, capa);
        });
      },
    }).addTo(mapa);
    const nombres = [...new Set(geo.features.map((f) => (EN ? f.properties.NAME : f.properties.NAME_ES) || f.properties.NAME))].sort((a, b) => a.localeCompare(b, "es"));
    lista.innerHTML = nombres.map((n) => `<option value="${n}"></option>`).join("");
    $("buscador").addEventListener("change", (e) => {
      const hit = paisesPorNombre.get(e.target.value.trim().toLowerCase());
      if (hit) seleccionarPais(hit.f, hit.capa);
    });
  }

  function seleccionarPais(f, capa) {
    const p = f.properties;
    const b = capa.getBounds();
    const iso = codigoPais(p);
    seleccionarArea({
      clave: iso,
      nombre: (EN ? p.NAME : p.NAME_ES) || p.NAME,
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => Math.round(x * 100) / 100),
      lat: p.LABEL_Y != null ? p.LABEL_Y : b.getCenter().lat,
      lon: p.LABEL_X != null ? p.LABEL_X : b.getCenter().lng,
      comando: `python scripts/descargar_datos.py --pais ${iso}`,
      geo: L.geoJSON(f),
      feature: f,
    });
    $("buscador").value = (EN ? p.NAME : p.NAME_ES) || p.NAME;
  }

  // ---------- Regiones de enfoque (Huánuco y Amazonía peruana) ----------
  function seleccionarRegion(f) {
    const p = f.properties;
    const b = p.bbox;
    seleccionarArea({
      clave: p.clave, nombre: p.nombre, bbox: b,
      lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2,
      comando: "(región ya incluida en el proyecto)",
      geo: L.geoJSON(f), feature: f,
    });
    $("buscador").value = "";
  }
  function prepararRegiones() {
    const sel = $("sel-region");
    const orden = ["HCO", "AMZ", "UCA", "LOR", "MDD", "SAM", "AMA"];
    const regiones = orden.map((k) => regionesEnfoque.find((f) => f.properties.clave === k)).filter(Boolean);
    sel.innerHTML = '<option value="">— Otro país o área dibujada —</option>' +
      regiones.map((f) => `<option value="${f.properties.clave}" title="${f.properties.departamentos.join(", ")}">${f.properties.clave === "AMZ" ? "🌳 " : f.properties.clave === "HCO" ? "⛰️ " : "📍 "}${f.properties.nombre}</option>`).join("") +
      '<option value="PER">🇵🇪 Perú completo</option>';
    sel.addEventListener("change", () => {
      const k = sel.value;
      if (!k) return;
      if (k === "PER") { const hit = paisesPorNombre.get("per"); if (hit) seleccionarPais(hit.f, hit.capa); return; }
      const f = regionesEnfoque.find((x) => x.properties.clave === k);
      if (f) seleccionarRegion(f);
    });
    marcarBotonRegion();
  }
  function marcarBotonRegion() {
    const sel = $("sel-region");
    if (!sel) return;
    const k = estado.area ? estado.area.clave : "";
    sel.value = [...sel.options].some((o) => o.value === k) ? k : "";
  }

  // ---------- Selección de área y datos ----------
  function seleccionarArea(area) {
    estado.area = area;
    marcarBotonRegion();
    estado.vivo = null;
    capaVivo.clearLayers();
    if (marcoIncendio) { mapa.removeLayer(marcoIncendio); marcoIncendio = null; }
    if (capaDetalle) { mapa.removeLayer(capaDetalle); capaDetalle = null; }
    $("tarjeta-incendios").hidden = true;
    $("panel-incendio").hidden = true; puntosClic = null;
    $("sin-incendios").hidden = false;
    if (capaRiesgo) capaRiesgo.clearLayers();
    if (leyendaRiesgo) { mapa.removeControl(leyendaRiesgo); leyendaRiesgo = null; }
    $("rg-resumen").innerHTML = ""; $("rg-tabla").innerHTML = ""; $("rg-estado").textContent = "";
    $("rg-area").textContent = area.nombre;
    $("vivo-estado").textContent = "";
    if (!leerClave()) $("mapa-fecha").innerHTML = "👉 Para ver los focos de incendio en el mapa, pega tu MAP_KEY en el panel <b>3 · En vivo</b>";
    if (capaSeleccion) mapa.removeLayer(capaSeleccion);
    // el contorno del área no debe "atrapar" los clics de los puntos de incendio
    const estiloArea = { color: C.serieAnio, weight: 2.5, fillOpacity: 0.05, fillColor: C.serieAnio, interactive: false };
    capaSeleccion = area.feature ? L.geoJSON(area.feature, { style: () => estiloArea, interactive: false })
      : L.rectangle(area.geo.getBounds(), estiloArea);
    capaSeleccion.addTo(mapa);
    mapa.fitBounds(capaSeleccion.getBounds(), { padding: [20, 20], maxZoom: 8 });

    // Solo datos reales: 1) historial del proyecto (data/focos.js), 2) historial guardado en este navegador
    const real = reales[area.clave];
    const local = leerHistLocal(area.clave);
    if (real) {
      estado.serie = { inicio: window.FIRECAL_DATOS_REALES.inicio || real.inicio, diario: real.diario.slice(), origen: "proyecto",
        detalle: real.fuente || "NASA FIRMS", actualizado: real.actualizado, dens: densidadProyecto[area.clave] || null };
    } else if (local) {
      estado.serie = { inicio: local.inicio, diario: local.diario, origen: "navegador", detalle: local.fuente, actualizado: local.actualizado, dens: local.dens || null };
    } else {
      estado.serie = null;
    }
    $("aviso-ejemplo").hidden = !!estado.serie;
    $("aviso-reales").innerHTML = Object.entries(reales)
      .map(([k, v]) => `<button type="button" class="enlace-pais" data-iso="${k}">${v.nombre}</button>`).join(", ") || "ninguno aún";
    $("aviso-reales").querySelectorAll("[data-iso]").forEach((b) => b.addEventListener("click", () => {
      const hit = paisesPorNombre.get(b.dataset.iso.toLowerCase());
      if (hit) seleccionarPais(hit.f, hit.capa);
    }));
    $("aviso-area").textContent = area.nombre;
    $("aviso-comando").textContent = area.comando;

    estado.base = null;
    aplicarSerie();
    dibujarExplicacion(pasoExp);
    actualizarEstimacion();
    if (leerClave()) consultarVivo();
  }

  // Muestra los gráficos si hay datos reales; si no, el aviso de "sin historial"
  function aplicarSerie() {
    const hay = !!estado.serie;
    $("bloque-graficos").hidden = !hay;
    $("vacio").hidden = hay;
    $("vacio-area").textContent = estado.area.nombre;
    $("kpi-titulo").textContent = "Resumen · " + estado.area.nombre;
    if (!hay) {
      estado.calc = null;
      ["kpi-temporada", "kpi-reciente", "kpi-anio", "kpi-tendencia"].forEach((k) => ($(k).textContent = "—"));
      ["kpi-pico", "kpi-reciente-sub", "kpi-anio-sub", "kpi-tendencia-sub"].forEach((k) => ($(k).textContent = ""));
      $("kpi-pico").textContent = "Descarga el historial (panel 3, opción C)";
      $("sel-anio").innerHTML = ""; $("sel-base").innerHTML = "";
      dibujarDensidad();
      $("mapa-titulo").textContent = `${estado.area.nombre} · imágenes de la NASA (GIBS)`;
      return;
    }
    const s = estado.serie;
    document.querySelector(".leyenda-eras").hidden = s.origen !== "proyecto";
    $("origen-datos").textContent = s.origen === "proyecto"
      ? `Fuente: ${s.detalle} · guardado en el proyecto${s.actualizado ? " · actualizado " + s.actualizado : ""}`
      : `Fuente: ${s.detalle} · descargado en vivo y guardado en este navegador (${s.actualizado})`;
    calcular();
    llenarSelectores();
    dibujarTodo();
    cargarClima();
    Object.values(graficos).forEach((g) => g.resize());
  }

  function calcular() {
    const { inicio, diario } = estado.serie;
    const mensual = S.agregarMensual(diario, inicio);
    let aniosCompletos = mensual.anios.filter((y, yi) => mensual.completo[yi].every(Boolean));
    if (!aniosCompletos.length) aniosCompletos = mensual.anios.slice(0, 1);
    // Desde 2003: MODIS Aqua empezó a mediados de 2002 (antes solo Terra, menos detecciones)
    if (!estado.base) estado.base = [Math.max(2003, aniosCompletos[0]), aniosCompletos[aniosCompletos.length - 1]];
    const [b0, b1] = estado.base;
    const climM = S.climatologiaMensual(mensual, b0, b1);
    const anom = S.anomaliasMensuales(mensual, climM);
    const climD = S.climatologiaDiaria(diario, inicio, b0, b1);
    const temporada = S.temporadaCritica(climD.media);
    const totales = mensual.anios.map((y, yi) => ({
      anio: y, total: mensual.valores[yi].reduce((s, v) => s + (v || 0), 0), completo: mensual.completo[yi].every(Boolean),
    }));
    const mk = S.mannKendall(totales.filter((t) => t.completo).map((t) => t.total));
    const reciente = S.estadoReciente(diario, inicio, 30);
    const p99 = S.percentil(diario.filter((v) => v > 0), 0.99) || 1;
    estado.calc = { mensual, climM, anom, climD, temporada, totales, mk, reciente, p99, aniosCompletos };
  }

  function llenarSelectores() {
    const { mensual, aniosCompletos } = estado.calc;
    const selA = $("sel-anio");
    const ult = mensual.anios[mensual.anios.length - 1];
    if (!estado.anio || !mensual.anios.includes(estado.anio)) estado.anio = ult;
    selA.innerHTML = mensual.anios.slice().reverse()
      .map((y) => `<option value="${y}" ${y === estado.anio ? "selected" : ""}>${y}${y === ult && !aniosCompletos.includes(y) ? " (en curso)" : ""}</option>`).join("");

    const a0 = aniosCompletos[0], a1 = aniosCompletos[aniosCompletos.length - 1];
    let opciones = [[Math.max(2003, a0), a1], [a0, a1], [Math.max(2003, a0), Math.min(2020, a1)], [2012, a1]].filter(([x, y]) => y - x >= 5);
    opciones = opciones.filter(([x]) => x >= a0);
    if (!opciones.length && a0 != null) opciones = [[a0, a1]];
    opciones = opciones.filter((o, i) => opciones.findIndex((q) => q[0] === o[0] && q[1] === o[1]) === i);
    const selB = $("sel-base");
    selB.innerHTML = opciones.map(([x, y]) =>
      `<option value="${x}-${y}" ${estado.base[0] === x && estado.base[1] === y ? "selected" : ""}>${x}–${y}${x === 2012 ? " (era VIIRS)" : x === 2003 ? " (MODIS Terra + Aqua)" : ""}</option>`).join("");
  }

  // ---------- Dibujo ----------
  function dibujarTodo() {
    $("cal-area").textContent = estado.area.nombre;
    $("dia-anio").innerHTML = `${estado.anio} <span class="era ${eraDe(estado.anio).toLowerCase()}">${eraTexto(estado.anio, true)}</span>`;
    $("ciclo-anio").textContent = estado.anio;
    $("kpi-titulo").textContent = "Resumen · " + estado.area.nombre;
    dibujarKPIs();
    dibujarDensidad();
    dibujarCalendario();
    dibujarEstadistica();
    dibujarDiario();
    dibujarCiclo();
    dibujarAnual();
    dibujarTabla();
  }

  function etiquetaEstado(razon) {
    if (razon == null) return ["Sin datos", "#888"];
    if (razon >= 2) return ["Muy por encima de lo normal", C.estado.critico];
    if (razon >= 1.3) return ["Por encima de lo normal", C.estado.serio];
    if (razon > 0.7) return ["Dentro de lo normal", C.estado.normal];
    return ["Por debajo de lo normal", C.estado.bajo];
  }

  function dibujarKPIs() {
    const { temporada, reciente, totales, mk } = estado.calc;
    ["kpi-temporada", "kpi-reciente", "kpi-anio", "kpi-tendencia"].forEach((k) => ($(k).textContent = "—"));
    ["kpi-pico", "kpi-reciente-sub", "kpi-anio-sub"].forEach((k) => ($(k).textContent = ""));
    $("kpi-tendencia-sub").textContent = "Se necesitan al menos 4 años completos";
    if (temporada) {
      $("kpi-temporada").textContent = `${S.doyATexto(temporada.inicioDoy)} – ${S.doyATexto(temporada.finDoy)}`;
      $("kpi-pico").textContent = `Pico típico: ${S.doyATexto(temporada.picoDoy)} · concentra el 80 % del fuego`;
    }
    const [txt, col] = etiquetaEstado(reciente.razon);
    $("kpi-reciente").textContent = reciente.razon != null ? `${fmt1.format(reciente.razon)}× lo normal` : "—";
    $("kpi-reciente-sub").innerHTML = `<span class="estado" style="--c:${col}">${txt}</span><br>${fmt.format(reciente.actual)} días-celda hasta el ${reciente.fechaFin}`;

    const t = totales.find((x) => x.anio === estado.anio);
    const prom = S.media(totales.filter((x) => x.completo && x.anio >= estado.base[0] && x.anio <= estado.base[1]).map((x) => x.total));
    if (t) {
      $("kpi-anio").textContent = fmt.format(t.total);
      if (t.completo && prom) {
        const r = t.total / prom;
        const [tx, c2] = etiquetaEstado(r);
        $("kpi-anio-sub").innerHTML = `<span class="estado" style="--c:${c2}">${fmt1.format(r)}× el promedio</span> (${fmt.format(Math.round(prom))})<br><span class="era ${eraDe(estado.anio).toLowerCase()}">${eraTexto(estado.anio, true)}</span>`;
      } else {
        $("kpi-anio-sub").textContent = "Año en curso: total parcial";
      }
    }
    if (mk) {
      const sig = mk.p < 0.05;
      const signo = mk.pendientePct > 0 ? "+" : "";
      $("kpi-tendencia").textContent = `${signo}${fmt1.format(mk.pendientePct)} % / año`;
      const fmt3 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3, minimumFractionDigits: 3 });
      const pTxt = mk.p < 0.001 ? "< " + fmt3.format(0.001) : "= " + fmt3.format(mk.p);
      $("kpi-tendencia-sub").textContent = (sig ? "Estadísticamente significativa" : "No significativa") + ` (p ${pTxt}, ${mk.n} años)`;
    }
  }

  function dibujarCalendario() {
    const { mensual, anom, climM } = estado.calc;
    const esAnom = estado.metrica === "anomalia";
    const anios = mensual.anios.slice().reverse(); // más recientes arriba
    const datos = [];
    let maxV = 0;
    mensual.anios.forEach((y, yi) => {
      for (let m = 0; m < 12; m++) {
        const v = mensual.valores[yi][m];
        if (v == null) continue;
        maxV = Math.max(maxV, v);
        const z = anom[yi][m];
        const valor = esAnom ? (z == null ? 0 : Math.max(-3, Math.min(3, z))) : v;
        datos.push({
          value: [m, anios.indexOf(y), valor, v, z, climM.medias[m], mensual.completo[yi][m] ? 1 : 0],
          itemStyle: mensual.completo[yi][m] ? undefined : { opacity: 0.45 },
        });
      }
    });
    $("cal-leyenda-txt").textContent = esAnom
      ? "Anomalía mensual (puntaje z respecto al periodo " + estado.base.join("–") + ")"
      : "Días-celda con fuego por mes (equivalente VIIRS 375 m)";
    const g = grafico("graf-calendario");
    g.setOption({
      animation: false,
      grid: { left: 52, right: 16, top: 10, bottom: 64 },
      tooltip: {
        ...tooltipBase,
        formatter: (p) => {
          const [m, yi, , v, z, med, completo] = p.value;
          const razon = med ? v / med : null;
          return `<b>${MESES_LARGOS[m]} ${anios[yi]}</b>${completo ? "" : " (mes incompleto)"}<br>` +
            `${fmt.format(v)} días-celda con fuego<br>` +
            (med ? `Normal: ${fmt.format(Math.round(med))} · ${fmt1.format(razon)}× lo normal<br>` : "") +
            (z != null ? `Puntaje z: ${z > 0 ? "+" : ""}${fmt1.format(z)}<br>` : "") +
            `<span style="color:${eraDe(anios[yi]) === "MODIS" ? COLOR_MODIS : COLOR_VIIRS}">●</span> ${eraTexto(anios[yi])}`;
        },
      },
      xAxis: { type: "category", data: MESES, ...ejeBase, splitLine: { show: false }, position: "top" },
      yAxis: { type: "category", data: anios, ...ejeBase, splitLine: { show: false },
        axisLabel: { color: C.texto2, fontSize: 11, formatter: (v) => `${v} {${eraDe(+v) === "MODIS" ? "m" : "v"}|●}`,
          rich: { m: { color: COLOR_MODIS, fontSize: 10 }, v: { color: COLOR_VIIRS, fontSize: 10 } } } },
      visualMap: esAnom
        ? {
          type: "continuous", min: -3, max: 3, dimension: 2, orient: "horizontal", left: "center", bottom: 4,
          inRange: { color: C.divergente }, text: ["+3 (mucho más fuego)", "−3 (mucho menos)"],
          textStyle: { color: C.texto2 }, itemWidth: 12, itemHeight: 180, calculable: false,
        }
        : {
          type: "continuous", min: 0, max: maxV || 1, dimension: 2, orient: "horizontal", left: "center", bottom: 4,
          inRange: { color: C.secuencial }, text: ["Más fuego", "Sin fuego"],
          textStyle: { color: C.texto2 }, itemWidth: 12, itemHeight: 180, calculable: false,
        },
      series: [{
        type: "heatmap", data: datos,
        itemStyle: { borderColor: C.superficie, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: C.texto, borderWidth: 2 } },
      }],
    }, true);
    g.off("click");
    g.on("click", (p) => {
      const y = anios[p.value[1]], m = p.value[0] + 1;
      if (y !== estado.anio) { estado.anio = y; $("sel-anio").value = y; dibujarTodo(); cargarClima(); }
      elegirFecha(y, m, null);
      $("mapa").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // Cuadro estadístico mensual: normal, variabilidad, extremos, año elegido, anomalía y tendencia por mes
  function dibujarEstadistica() {
    const { mensual, climM, temporada } = estado.calc;
    const [b0, b1] = estado.base;
    const y = estado.anio;
    const yi = mensual.anios.indexOf(y);
    $("est-titulo").textContent = `${estado.area.nombre} · ${y}`;
    $("est-base").textContent = `${b0}–${b1}`;
    const sumaMedias = climM.medias.reduce((a, v) => a + (v || 0), 0);
    const critico = (m) => {
      if (!temporada) return false;
      const medio = S.diaDelAnio(new Date(Date.UTC(2001, m, 15)));
      const { inicioDoy: a, finDoy: b } = temporada;
      return a <= b ? medio >= a && medio <= b : medio >= a || medio <= b;
    };
    let filas = "";
    let totSel = 0, selCompleto = true, totMin = 0, totMax = 0;
    for (let m = 0; m < 12; m++) {
      const serie = [], anios = [];
      mensual.anios.forEach((yy, i) => {
        if (yy >= b0 && yy <= b1 && mensual.completo[i][m]) { serie.push(mensual.valores[i][m]); anios.push(yy); }
      });
      let iMin = 0, iMax = 0;
      serie.forEach((v, i) => { if (v < serie[iMin]) iMin = i; if (v > serie[iMax]) iMax = i; });
      const med = climM.medias[m], de = climM.desv[m];
      const v = yi >= 0 ? mensual.valores[yi][m] : null;
      const completo = yi >= 0 && mensual.completo[yi][m];
      if (v != null) totSel += v; if (!completo) selCompleto = false;
      const z = v != null && de ? (v - med) / de : null;
      const razon = v != null && med ? v / med : null;
      const [txtEst, colEst] = etiquetaEstado(razon);
      const mk = S.mannKendall(serie);
      const tend = mk && mk.pendientePct != null
        ? `<span class="${mk.p < 0.05 ? "sig" : "nosig"}">${mk.pendientePct > 0 ? "+" : ""}${fmt1.format(mk.pendientePct)} %/año ${mk.p < 0.05 ? (mk.pendientePct > 0 ? "↑" : "↓") + " signif." : "(n.s.)"}</span>`
        : "—";
      filas += `<tr class="${critico(m) ? "critico" : ""}"><td>${critico(m) ? "🔥 " : ""}${MESES_LARGOS[m]}</td>` +
        `<td>${med == null ? "—" : fmt.format(Math.round(med))}</td><td>${de == null ? "—" : fmt.format(Math.round(de))}</td>` +
        `<td>${serie.length ? fmt.format(serie[iMin]) + " (" + anios[iMin] + ")" : "—"}</td>` +
        `<td>${serie.length ? fmt.format(serie[iMax]) + " (" + anios[iMax] + ")" : "—"}</td>` +
        `<td><b>${v == null ? "—" : fmt.format(v)}</b>${v != null && !completo ? " *" : ""}</td>` +
        `<td>${razon == null ? "—" : fmt1.format(razon) + "×"}</td>` +
        `<td>${z == null ? "—" : (z > 0 ? "+" : "") + fmt1.format(z)}</td>` +
        `<td>${razon == null || !completo ? "—" : `<span class="estado" style="--c:${colEst}">${txtEst.replace(" de lo normal", "")}</span>`}</td>` +
        `<td>${med == null || !sumaMedias ? "—" : fmt1.format((100 * med) / sumaMedias) + " %"}</td><td>${tend}</td></tr>`;
    }
    const totales = mensual.anios.map((yy, i) => ({ yy, t: mensual.valores[i].reduce((a, v) => a + (v || 0), 0), ok: mensual.completo[i].every(Boolean) }))
      .filter((x) => x.ok && x.yy >= b0 && x.yy <= b1);
    const tMin = totales.reduce((a, x) => (!a || x.t < a.t ? x : a), null), tMax = totales.reduce((a, x) => (!a || x.t > a.t ? x : a), null);
    const deT = S.desviacion(totales.map((x) => x.t));
    filas += `<tr class="total"><td>Total anual</td><td>${fmt.format(Math.round(sumaMedias))}</td><td>${deT == null ? "—" : fmt.format(Math.round(deT))}</td>` +
      `<td>${tMin ? fmt.format(tMin.t) + " (" + tMin.yy + ")" : "—"}</td><td>${tMax ? fmt.format(tMax.t) + " (" + tMax.yy + ")" : "—"}</td>` +
      `<td><b>${fmt.format(totSel)}</b>${selCompleto ? "" : " *"}</td><td>${selCompleto && sumaMedias ? fmt1.format(totSel / sumaMedias) + "×" : "—"}</td>` +
      `<td>${selCompleto && deT ? (totSel > sumaMedias ? "+" : "") + fmt1.format((totSel - sumaMedias) / deT) : "—"}</td><td></td><td>100 %</td><td></td></tr>`;
    $("tabla-estadistica").innerHTML =
      `<thead><tr><th>Mes</th><th>Promedio</th><th>Desv. est.</th><th>Mínimo (año)</th><th>Máximo (año)</th><th>${y} <span class="era ${eraDe(y).toLowerCase()}">${eraDe(y)}</span></th><th>vs normal</th><th>z</th><th>Estado</th><th>% del año</th><th>Tendencia del mes</th></tr></thead><tbody>${filas}</tbody>` +
      (selCompleto ? "" : `<caption class="ayuda" style="caption-side:bottom;text-align:left">* mes o año en curso: valor parcial</caption>`);
  }

  function dibujarDiario() {
    const { inicio, diario } = estado.serie;
    const y = estado.anio;
    const i0 = Math.max(0, S.indiceDeFecha(inicio, `${y}-01-01`));
    const i1 = Math.min(diario.length - 1, S.indiceDeFecha(inicio, `${y}-12-31`));
    const datos = [];
    for (let i = i0; i <= i1; i++) datos.push([S.isoFecha(S.fechaDeIndice(inicio, i)), diario[i]]);
    const g = grafico("graf-diario");
    g.setOption({
      animation: false,
      tooltip: { ...tooltipBase, formatter: (p) => `<b>${p.value[0]}</b><br>${fmt.format(p.value[1])} días-celda con fuego<br><i>Clic: imagen satelital + focos de ese día</i>` },
      visualMap: {
        type: "continuous", min: 0, max: estado.calc.p99, show: false, inRange: { color: C.secuencial },
      },
      calendar: {
        range: String(y), orient: "vertical", left: 40, right: 12, top: 30, bottom: 6, cellSize: ["auto", "auto"],
        itemStyle: { color: "#151514", borderColor: C.superficie, borderWidth: 2 },
        splitLine: { lineStyle: { color: "#4a4a45", width: 1 } },
        dayLabel: { firstDay: 1, nameMap: EN ? ["S", "M", "T", "W", "T", "F", "S"] : ["D", "L", "M", "M", "J", "V", "S"], color: C.texto2, fontSize: 10 },
        monthLabel: { nameMap: MESES, color: C.texto2, fontSize: 11 },
        yearLabel: { show: false },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: datos }],
    }, true);
    // El calendario vertical es alto: ajustar altura
    $("graf-diario").style.height = "300px";
    g.resize();
    g.off("click");
    g.on("click", (p) => { const [y, m, d] = p.value[0].split("-").map(Number); verImagenDelDia(p.value[0]); elegirFecha(y, m, d); });
  }

  // Mapa de "dónde hubo fuego": cuadros de 0,2° (~22 km) con los días-celda con fuego del año elegido
  function dibujarDensidad() {
    capaDensidad.clearLayers();
    if (leyendaDensidad) { mapa.removeControl(leyendaDensidad); leyendaDensidad = null; }
    const dens = estado.serie && estado.serie.dens;
    const arr = dens && dens[String(estado.anio)];
    if (!arr || !arr.length) return;
    const R = 0.2, vals = [];
    for (let k = 2; k < arr.length; k += 3) vals.push(arr[k]);
    const tope = Math.max(1, S.percentil(vals, 0.97));
    const ramp = C.secuencial.slice(2);
    const render = RENDER_DENS;
    for (let k = 0; k < arr.length; k += 3) {
      const i = arr[k], j = arr[k + 1], n = arr[k + 2];
      const t = Math.min(1, Math.log1p(n) / Math.log1p(tope));
      const color = ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
      L.rectangle([[i * R, j * R], [(i + 1) * R, (j + 1) * R]], {
        renderer: render, stroke: false, fillColor: color, fillOpacity: 0.35 + 0.5 * t,
      }).bindTooltip(`<b>${estado.anio}</b>: ${fmt.format(n)} días-celda con fuego<br>en este cuadro de ~22 × 22 km<br>centro ${((i + 0.5) * R).toFixed(1)}, ${((j + 0.5) * R).toFixed(1)}`, { sticky: true, className: "etiqueta-pais" })
        .addTo(capaDensidad);
    }
    leyendaDensidad = L.control({ position: "bottomright" });
    leyendaDensidad.onAdd = () => {
      const d = L.DomUtil.create("div", "leyenda-vivo");
      d.innerHTML = `<b>Dónde hubo fuego en ${estado.anio}</b><br>` +
        `<span class="rampa">${ramp.map((c) => `<i style="background:${c};border-radius:2px"></i>`).join("")}</span><br>` +
        `poco → mucho (días-celda por cuadro de ~22 km)<br><span style="opacity:.8">Cambia el año en el panel 2</span>`;
      return d;
    };
    if (mapa.hasLayer(capaDensidad)) leyendaDensidad.addTo(mapa);
    if (!estado.vivo) $("mapa-titulo").textContent = `dónde hubo fuego en ${estado.anio} (NASA FIRMS)`;
  }

  function verImagenDelDia(iso) {
    // VIIRS S-NPP true color desde nov 2015; antes, MODIS Terra
    const capa = iso >= "2015-11-24" ? "VIIRS_SNPP_CorrectedReflectance_TrueColor" : "MODIS_Terra_CorrectedReflectance_TrueColor";
    capaDiaria.setUrl(`${GIBS}/${capa}/default/${iso}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`);
    mapa.eachLayer((l) => { if (l instanceof L.TileLayer && l !== capaDiaria) mapa.removeLayer(l); });
    capaDiaria.addTo(mapa);
    capaDiaria.bringToBack();
    $("mapa-titulo").textContent = `imagen satelital del ${iso}`;
    $("mapa-fecha").textContent = `${capa.startsWith("VIIRS") ? "VIIRS S-NPP" : "MODIS Terra"} color real · busca columnas de humo`;
    if (capaSeleccion) mapa.fitBounds(capaSeleccion.getBounds(), { padding: [20, 20], maxZoom: 6 });
    $("mapa").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function dibujarCiclo() {
    const { climD, temporada } = estado.calc;
    const { inicio, diario } = estado.serie;
    const y = estado.anio;
    const anioVals = new Array(365).fill(null);
    for (let i = Math.max(0, S.indiceDeFecha(inicio, `${y}-01-01`)); i < diario.length; i++) {
      const f = S.fechaDeIndice(inicio, i);
      if (f.getUTCFullYear() !== y) break;
      const d = S.diaDelAnio(f) - 1;
      anioVals[d] = (anioVals[d] || 0) + diario[i];
    }
    const sAnio = suavizar7(anioVals);
    const dias = Array.from({ length: 365 }, (_, i) => S.doyATexto(i + 1));
    const r = (x) => (x == null ? null : Math.round(x * 10) / 10);
    const g = grafico("graf-ciclo");
    const marca = temporada ? [[{ xAxis: temporada.inicioDoy - 1, name: "Temporada crítica" }, { xAxis: temporada.finDoy - 1 }]] : [];
    g.setOption({
      animation: false,
      grid: { left: 44, right: 14, top: 34, bottom: 28 },
      legend: { top: 0, textStyle: { color: C.texto2 }, data: [String(y), "Normal (media)", "Rango normal (p10–p90)"] },
      tooltip: {
        ...tooltipBase, trigger: "axis",
        formatter: (ps) => {
          const i = ps[0].dataIndex;
          return `<b>${dias[i]}</b><br>${y}: ${sAnio[i] == null ? "—" : fmt1.format(sAnio[i])}<br>Normal: ${fmt1.format(climD.media[i])}<br>Rango: ${fmt1.format(climD.p10[i])} – ${fmt1.format(climD.p90[i])}`;
        },
      },
      xAxis: { type: "category", data: dias, boundaryGap: false, ...ejeBase, splitLine: { show: false },
        axisLabel: { color: C.texto2, interval: (i) => [0, 59, 120, 181, 243, 304].includes(i), formatter: (v) => v.split(" ")[1] } },
      yAxis: { type: "value", name: "días-celda/día", nameTextStyle: { color: C.tenue, align: "left" }, ...ejeBase },
      series: [
        { name: "p10", type: "line", data: climD.p10.map(r), stack: "banda", symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false } },
        { name: "Rango normal (p10–p90)", type: "line", data: climD.p90.map((v, i) => r(v - climD.p10[i])), stack: "banda", symbol: "none",
          lineStyle: { opacity: 0 }, areaStyle: { color: C.banda }, itemStyle: { color: C.banda } },
        { name: "Normal (media)", type: "line", data: climD.media.map(r), symbol: "none", lineStyle: { color: C.serieNormal, width: 2, type: "dashed" }, itemStyle: { color: C.serieNormal },
          markArea: { silent: true, itemStyle: { color: "rgba(217,89,38,0.08)" }, label: { color: C.texto2, fontSize: 11 }, data: marca } },
        { name: String(y), type: "line", data: sAnio.map(r), symbol: "none", lineStyle: { color: C.serieAnio, width: 2 }, itemStyle: { color: C.serieAnio } },
      ],
    }, true);
  }

  function dibujarAnual() {
    const { totales, mk } = estado.calc;
    const completos = totales.filter((t) => t.completo);
    let linea = [];
    if (mk) {
      const xs = completos.map((_, i) => i);
      const inter = S.percentil(completos.map((t, i) => t.total - mk.pendiente * xs[i]), 0.5);
      linea = totales.map((t) => {
        const i = completos.findIndex((c) => c.anio === t.anio);
        return i >= 0 ? Math.round(inter + mk.pendiente * i) : null;
      });
    }
    const g = grafico("graf-anual");
    g.setOption({
      animation: false,
      grid: { left: 54, right: 14, top: 34, bottom: 28 },
      legend: { top: 0, textStyle: { color: C.texto2 }, data: ["Total anual", "Tendencia (Sen)"] },
      tooltip: { ...tooltipBase, trigger: "axis", valueFormatter: (v) => (v == null ? "—" : fmt.format(v)) },
      xAxis: { type: "category", data: totales.map((t) => t.anio), ...ejeBase, splitLine: { show: false } },
      yAxis: { type: "value", ...ejeBase },
      series: [
        {
          name: "Total anual", type: "bar", barMaxWidth: 18,
          data: totales.map((t) => ({
            value: t.total,
            itemStyle: {
              color: t.anio === estado.anio ? C.serieAnio : "#7a3414",
              opacity: t.completo ? 1 : 0.5, borderRadius: [4, 4, 0, 0],
              borderColor: eraDe(t.anio) === "MODIS" ? COLOR_MODIS : "transparent", borderWidth: eraDe(t.anio) === "MODIS" ? 1.5 : 0,
              decal: eraDe(t.anio) === "MODIS" ? { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: -Math.PI / 4, color: "rgba(57,135,229,0.45)" } : undefined,
            },
          })),
          itemStyle: { color: "#7a3414" },
        },
        { name: "Tendencia (Sen)", type: "line", data: linea, symbol: "none", lineStyle: { color: C.texto2, width: 2, type: "dashed" }, itemStyle: { color: C.texto2 },
          markArea: eraDe(totales[0].anio) === "MODIS" ? { silent: true, label: { color: C.texto2, fontSize: 11, position: "insideTop" }, data: [
            [{ xAxis: String(totales[0].anio), name: "antiguos · MODIS (ajustado)", itemStyle: { color: "rgba(57,135,229,0.10)" } }, { xAxis: "2011" }],
            [{ xAxis: "2012", name: "modernos · VIIRS", itemStyle: { color: "rgba(217,89,38,0.08)" } }, { xAxis: String(totales[totales.length - 1].anio) }],
          ] } : undefined },
      ],
    }, true);
    g.off("click");
    g.on("click", (p) => {
      const y = totales[p.dataIndex].anio;
      estado.anio = y; $("sel-anio").value = y; dibujarTodo(); cargarClima();
    });
  }

  function dibujarTabla() {
    const { mensual } = estado.calc;
    let html = "<table><thead><tr><th>Año</th>" + MESES.map((m) => `<th>${m}</th>`).join("") + "<th>Total</th></tr></thead><tbody>";
    mensual.anios.slice().reverse().forEach((y) => {
      const fila = mensual.valores[mensual.anios.indexOf(y)];
      html += `<tr><td>${y}</td>` + fila.map((v) => `<td>${v == null ? "" : fmt.format(v)}</td>`).join("") +
        `<td>${fmt.format(fila.reduce((s, v) => s + (v || 0), 0))}</td></tr>`;
    });
    $("tabla-mensual").innerHTML = html + "</tbody></table>";
  }

  function descargarCSV() {
    const { mensual } = estado.calc;
    let csv = "anio,mes,dias_celda_fuego,mes_completo,origen\n";
    mensual.anios.forEach((y, yi) => mensual.valores[yi].forEach((v, m) => {
      if (v != null) csv += `${y},${m + 1},${v},${mensual.completo[yi][m]},${estado.serie.origen}\n`;
    }));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `firecal_${estado.area.clave}_mensual.csv`;
    a.click();
  }

  // ---------- Clima: NASA POWER ----------
  const cacheClima = new Map();
  async function cargarClima() {
    const { lat, lon } = estado.area;
    const y = estado.anio;
    const limite = new Date(Date.now() - 10 * 86400000);
    const fin = new Date(Math.min(Date.UTC(y, 11, 31), limite.getTime()));
    const finTxt = S.isoFecha(fin).replace(/-/g, "");
    const clave = `${lat.toFixed(2)},${lon.toFixed(2)},${y}`;
    dibujarFuegoMes();
    $("clima-estado").textContent = `Cargando clima de ${y} en (${lat.toFixed(1)}°, ${lon.toFixed(1)}°)…`;
    try {
      let d = cacheClima.get(clave);
      if (!d) {
        const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,RH2M&community=AG` +
          `&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${y}0101&end=${finTxt}&format=JSON`;
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        d = (await r.json()).properties.parameter;
        cacheClima.set(clave, d);
      }
      if (estado.anio !== y) return; // el usuario cambió de año mientras cargaba
      const lluvia = new Array(12).fill(null), hum = new Array(12).fill(null), nh = new Array(12).fill(0);
      Object.entries(d.PRECTOTCORR || {}).forEach(([f, v]) => { if (v > -900) { const m = +f.slice(4, 6) - 1; lluvia[m] = (lluvia[m] || 0) + v; } });
      Object.entries(d.RH2M || {}).forEach(([f, v]) => { if (v > -900) { const m = +f.slice(4, 6) - 1; hum[m] = (hum[m] || 0) + v; nh[m]++; } });
      const humM = hum.map((v, m) => (nh[m] ? v / nh[m] : null));
      dibujarMini("graf-lluvia", "Lluvia (mm/mes)", lluvia.map((v) => (v == null ? null : Math.round(v))), "bar", C.lluvia);
      dibujarMini("graf-humedad", "Humedad relativa (%)", humM.map((v) => (v == null ? null : Math.round(v))), "line", C.humedad);
      $("clima-estado").textContent = `NASA POWER · punto (${lat.toFixed(1)}°, ${lon.toFixed(1)}°)`;
    } catch (e) {
      $("clima-estado").textContent = "No se pudo cargar NASA POWER (¿sin internet?).";
      dibujarMini("graf-lluvia", "Lluvia (mm/mes)", [], "bar", C.lluvia);
      dibujarMini("graf-humedad", "Humedad relativa (%)", [], "line", C.humedad);
    }
  }
  function dibujarFuegoMes() {
    const { mensual } = estado.calc;
    const fila = mensual.valores[mensual.anios.indexOf(estado.anio)];
    dibujarMini("graf-fuego-mes", `Fuego ${estado.anio} (días-celda)`, fila, "bar", C.serieAnio);
  }
  function dibujarMini(id, titulo, datos, tipo, color) {
    grafico(id).setOption({
      animation: false,
      title: { text: titulo, left: 0, top: 0, textStyle: { color: C.texto2, fontSize: 11, fontWeight: "normal" } },
      grid: { left: 44, right: 8, top: 22, bottom: 18 },
      tooltip: { ...tooltipBase, trigger: "axis", valueFormatter: (v) => (v == null ? "—" : fmt.format(v)) },
      xAxis: { type: "category", data: MESES, ...ejeBase, splitLine: { show: false }, axisLabel: { color: C.tenue, fontSize: 10 } },
      yAxis: { type: "value", ...ejeBase, splitNumber: 2, axisLabel: { color: C.tenue, fontSize: 10 } },
      series: [{
        type: tipo, data: datos, name: titulo, symbol: "circle", symbolSize: 6,
        itemStyle: { color, borderRadius: tipo === "bar" ? [4, 4, 0, 0] : 0 }, lineStyle: { color, width: 2 }, barMaxWidth: 14,
      }],
    }, true);
  }

  // ---------- En vivo: API NASA FIRMS ----------
  const API_FIRMS = "https://firms.modaps.eosdis.nasa.gov/api";
  function leerClave() {
    let k = "";
    try { k = localStorage.getItem("firecal_map_key") || ""; } catch (e) { /* sin almacenamiento */ }
    // js/config.js (solo en la computadora del equipo, no se sube a GitHub) puede traer la clave
    return k || (window.FIRECAL_CONFIG && window.FIRECAL_CONFIG.mapKey) || "";
  }
  function guardarClave(k) {
    try { k ? localStorage.setItem("firecal_map_key", k) : localStorage.removeItem("firecal_map_key"); } catch (e) { /* sin almacenamiento */ }
  }
  function enAnillo(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function filtroArea(area) {
    const [w, s, e, n] = area.bbox;
    if (!area.feature) return (lat, lon) => lon >= w && lon <= e && lat >= s && lat <= n;
    const g = area.feature.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return (lat, lon) => polys.some((p) => enAnillo(lon, lat, p[0]) && !p.slice(1).some((h) => enAnillo(lon, lat, h)));
  }
  function sumarDias(iso, k) {
    const d = S.parseFecha(iso); d.setUTCDate(d.getUTCDate() + k); return S.isoFecha(d);
  }

  let consultaId = 0, disponibilidad = null;
  async function leerDisponibilidad(clave) {
    if (disponibilidad && disponibilidad.clave === clave) return disponibilidad.d;
    const txt = await fetch(`${API_FIRMS}/data_availability/csv/${clave}/ALL`).then((r) => r.text());
    if (!txt.startsWith("data_id")) throw new Error(txt.slice(0, 120));
    const d = {};
    txt.trim().split("\n").slice(1).forEach((l) => { const [k, a, b] = l.split(","); d[k] = [a, b]; });
    disponibilidad = { clave, d };
    return d;
  }
  // Fuentes para un rango de fechas: VIIRS científico (SP) donde existe, luego NRT; antes de 2012, MODIS.
  function tramos(disp, desde, hasta) {
    const t = [];
    let d = desde;
    if (d < "2012-01-20") {
      const b = hasta < "2012-01-19" ? hasta : "2012-01-19";
      t.push(["MODIS_SP", d, b]);
      d = sumarDias(b, 1);
    }
    const sp = disp.VIIRS_SNPP_SP;
    if (d <= hasta && sp && d <= sp[1]) {
      const b = hasta < sp[1] ? hasta : sp[1];
      t.push(["VIIRS_SNPP_SP", d, b]);
      d = sumarDias(b, 1);
    }
    if (d <= hasta) {
      const nrt = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"].filter((k) => disp[k] && disp[k][0] <= d);
      const f = nrt.find((k) => disp[k][1] >= hasta) || nrt.sort((a, b) => disp[b][1].localeCompare(disp[a][1]))[0];
      if (f) t.push([f, d, hasta < disp[f][1] ? hasta : disp[f][1]]);
    }
    return t;
  }
  function claveActual() {
    const clave = ($("map-key").value || leerClave()).trim();
    return /^[0-9a-f]{32}$/i.test(clave) ? clave : null;
  }
  const nombreSat = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21", T: "Terra", A: "Aqua", Terra: "Terra", Aqua: "Aqua", "1": "NOAA-20" };

  // ----- Periodos de búsqueda -----
  let ultimoConocido = null;
  async function ultimoDiaDisponible(clave) {
    const disp = await leerDisponibilidad(clave);
    ultimoConocido = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"].filter((k) => disp[k]).map((k) => disp[k][1]).sort().pop();
    return ultimoConocido;
  }
  // ----- Fecha elegida: año / mes / día -----
  let modoUltimoMes = true; // al abrir: último mes
  function rangoElegido(ult) {
    ult = ult || ultimoConocido || AYER_ISO;
    if (modoUltimoMes) return { desde: sumarDias(ult, -29), hasta: ult, titulo: "último mes" };
    const y = +$("f-anio").value, m = +$("f-mes").value, d = +$("f-dia").value;
    const z = (n) => String(n).padStart(2, "0");
    let desde, hasta, titulo;
    if (m && d) { desde = hasta = `${y}-${z(m)}-${z(d)}`; titulo = fechaLarga(desde); }
    else if (m) { desde = `${y}-${z(m)}-01`; hasta = `${y}-${z(m)}-${z(S.diasEnMes(y, m - 1))}`; titulo = EN ? `${MESES_LARGOS[m - 1]} ${y}` : `${MESES_LARGOS[m - 1]} de ${y}`; }
    else { desde = `${y}-01-01`; hasta = `${y}-12-31`; titulo = `año ${y}`; }
    if (hasta > ult) hasta = ult;
    if (desde > ult) return null;
    return { desde, hasta, titulo };
  }
  async function rangoDePeriodo(clave) {
    const ult = await ultimoDiaDisponible(clave);
    const r = rangoElegido(ult);
    if (!r) throw new Error("Esa fecha todavía no tiene datos de la NASA: elige una fecha anterior (desde 2001).");
    return r;
  }
  function estimarConsultas(desde, hasta) {
    const dias = S.indiceDeFecha(desde, hasta) + 1;
    const n = Math.ceil(dias / 5) + (desde < "2012-01-20" && hasta >= "2012-01-20" ? 1 : 0);
    const seg = Math.round(n * 1.4) + 2;
    return { n, texto: seg < 60 ? `${seg} s` : `${Math.round(seg / 60)} min` };
  }
  function llenarDias() {
    const y = +$("f-anio").value, m = +$("f-mes").value;
    const sel = $("f-dia"), previo = sel.value;
    $("f-dia").disabled = !m;
    const n = m ? S.diasEnMes(y, m - 1) : 0;
    sel.innerHTML = '<option value="">Todo el mes</option>' + Array.from({ length: n }, (_, i) => `<option value="${i + 1}">Día ${i + 1}</option>`).join("");
    if (previo && +previo <= n) sel.value = previo;
  }
  // Devuelve true si la consulta es rápida (o está en caché) y se puede hacer sola
  function actualizarEstimacion() {
    const r = rangoElegido();
    if (!r) { $("estimacion").textContent = "Esa fecha todavía no tiene datos."; return false; }
    const e = estimarConsultas(r.desde, r.hasta);
    const enCache = leerCache(estado.area && estado.area.clave, r.desde, r.hasta);
    if (enCache) { $("estimacion").innerHTML = `⚡ <b>${r.titulo}</b>: ya está guardado, carga al instante.`; return true; }
    if (e.n <= 8) { $("estimacion").innerHTML = `<b>${r.titulo}</b> · tardará ~${e.texto}.`; return true; }
    $("estimacion").innerHTML = `⏳ <b>${r.titulo}</b>: son ${e.n} consultas a la NASA (5 días por consulta), tardará <b>~${e.texto}</b>. ` +
      `Pulsa <b>🔥 Ver incendios</b> para empezar; verás el avance. <span style="opacity:.8">Consejo: elige un mes para que sea instantáneo.</span>`;
    return false;
  }
  // Cambió la fecha: si es rápido, se carga solo; si no, se espera al botón
  function fechaCambiada(autoCargar = true) {
    modoUltimoMes = false;
    llenarDias();
    const rapido = actualizarEstimacion();
    if (autoCargar && rapido && claveActual()) buscarIncendios();
  }
  function elegirFecha(y, m, d) {
    if (![...$("f-anio").options].some((o) => +o.value === y)) return;
    $("f-anio").value = y; $("f-mes").value = m || "";
    llenarDias(); $("f-dia").value = d || "";
    fechaCambiada(true);
  }

  // ----- Caché local de consultas (los datos de la NASA no cambian; lo reciente se refresca) -----
  const CACHE_PREF = "firecal_cache_";
  function claveCache(area, desde, hasta) { return `${CACHE_PREF}${area}_${desde}_${hasta}`; }
  function leerCache(area, desde, hasta) {
    if (!area) return null;
    try {
      const t = localStorage.getItem(claveCache(area, desde, hasta));
      if (!t) return null;
      const c = JSON.parse(t);
      const reciente = S.indiceDeFecha(hasta, AYER_ISO) < 8;
      const vida = reciente ? 6 * 3600e3 : 30 * 86400e3; // 6 horas si incluye días recientes; 30 días si es histórico
      return Date.now() - c.t < vida ? c : null;
    } catch (e) { return null; }
  }
  function guardarCache(area, desde, hasta, puntos, usadas) {
    const comp = puntos.map((p) => [p.lat, p.lon, p.f, p.h, p.frp, p.scan, p.track, p.dn, p.conf, p.sat, p.modis ? 1 : 0, p.bt]);
    const valor = JSON.stringify({ t: Date.now(), usadas, p: comp });
    const intentar = () => { localStorage.setItem(claveCache(area, desde, hasta), valor); return true; };
    try { return intentar(); } catch (e) {
      // sin espacio: borrar las consultas guardadas más antiguas y reintentar
      try {
        const viejas = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREF))
          .map((k) => { try { return [k, JSON.parse(localStorage.getItem(k)).t]; } catch (x) { return [k, 0]; } })
          .sort((a, b) => a[1] - b[1]);
        for (const [k] of viejas) { localStorage.removeItem(k); try { return intentar(); } catch (x) { /* seguir */ } }
      } catch (x) { /* nada */ }
      return false;
    }
  }
  function descomprimir(c) {
    return c.p.map((a) => ({ lat: a[0], lon: a[1], f: a[2], h: a[3], frp: a[4], scan: a[5], track: a[6], dn: a[7], conf: a[8], sat: a[9], modis: !!a[10], bt: a[11] }));
  }

  // Algunos nombres llegan con la codificación rota ("MaraÃ±on" -> "Marañón")
  function arreglarTexto(t) {
    if (!/[ÃÂ]/.test(t || "")) return t;
    try { return decodeURIComponent(escape(t)); } catch (e) { return t; }
  }
  // ----- Lugares: provincias del Perú (geoBoundaries) para describir cada incendio -----
  let provincias = null, cargandoProv = null;
  function cargarProvincias() {
    if (provincias || cargandoProv) return cargandoProv;
    cargandoProv = (async () => {
      try {
        const info = await fetch("https://www.geoboundaries.org/api/current/gbOpen/PER/ADM2/").then((r) => r.json());
        const url = info.simplifiedGeometryGeoJSON.replace("https://github.com/wmgeolab/geoBoundaries/raw/", "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/");
        const g = await fetch(url).then((r) => r.json());
        provincias = g.features.map((f) => {
          const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
          let w = 999, s = 999, e = -999, n = -999;
          polys.forEach((p) => p[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
          return { nombre: arreglarTexto(f.properties.shapeName), polys, bb: [w, s, e, n] };
        });
      } catch (e) { provincias = []; }
      return provincias;
    })();
    return cargandoProv;
  }
  const regionDe = (lat, lon) => {
    const dep = regionesEnfoque.find((f) => !["AMZ"].includes(f.properties.clave) &&
      (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).some((p) => enAnillo(lon, lat, p[0])));
    return dep ? dep.properties.nombre.replace(" (Perú)", "") : null;
  };
  function lugarDe(lat, lon) {
    const prov = (provincias || []).find((p) => lon >= p.bb[0] && lon <= p.bb[2] && lat >= p.bb[1] && lat <= p.bb[3] &&
      p.polys.some((q) => enAnillo(lon, lat, q[0])));
    const dep = regionDe(lat, lon);
    if (prov && dep) return `provincia de ${prov.nombre} (${dep})`;
    if (prov) return `provincia de ${prov.nombre}`;
    if (dep) return dep;
    return estado.area ? estado.area.nombre : "";
  }

  // ----- Consultas -----
  async function consultarVivo() { // automática al elegir un área: la fecha elegida si es rápida
    if (!claveActual()) return;
    if (actualizarEstimacion()) await buscarIncendios();
  }
  async function buscarIncendios() {
    const clave = claveActual();
    if (!clave) { $("vivo-estado").innerHTML = '<span class="vivo-error">Primero pega tu MAP_KEY (arriba).</span>'; $("map-key").focus(); return; }
    guardarClave(clave);
    try {
      const r = await rangoDePeriodo(clave);
      await consultarFocos({ ...r, actualizarSerie: modoUltimoMes });
    } catch (e) { mostrarErrorVivo(e); }
  }
  async function consultarDia(iso) {
    if (!claveActual()) {
      $("vivo-estado").innerHTML = '<span class="vivo-error">Para ver los incendios de un día, pega tu MAP_KEY en el panel 3.</span>';
      return;
    }
    await consultarFocos({ desde: iso, hasta: iso, titulo: `día ${iso}`, actualizarSerie: false });
  }

  function mostrarErrorVivo(e) {
    const t = String((e && e.message) || e);
    $("vivo-estado").innerHTML = `<span class="vivo-error">${/MAP_KEY/i.test(t)
      ? "La API respondió «Invalid MAP_KEY»: revisa la clave o espera unos minutos si superaste el límite (5.000 transacciones / 10 min)."
      : /desde/.test(t) ? t : "No se pudo consultar FIRMS: " + t}</span>`;
  }

  function progreso(frac) {
    $("barra").hidden = frac == null;
    $("btn-cancelar").hidden = frac == null;
    $("btn-buscar").disabled = frac != null;
    if (frac != null) $("barra-relleno").style.width = Math.round(frac * 100) + "%";
  }

  async function consultarFocos({ desde, hasta, titulo, actualizarSerie }) {
    if (animacion) detenerAnimacion(false);
    const clave = claveActual();
    guardarClave(clave);
    const area = estado.area;
    const id = ++consultaId;
    const msg = (t, cls) => { if (id === consultaId) $("vivo-estado").innerHTML = cls ? `<span class="${cls}">${t}</span>` : t; };
    cargarProvincias();
    try {
      let puntos, usadas, consultas = 0, desdeCache = false;
      const c = leerCache(area.clave, desde, hasta);
      if (c) {
        puntos = descomprimir(c); usadas = c.usadas; desdeCache = true;
      } else {
        msg("Consultando disponibilidad de datos de la NASA…");
        const disp = await leerDisponibilidad(clave);
        const dentro = filtroArea(area);
        const bbox = area.bbox.join(",");
        const lista = tramos(disp, desde, hasta);
        const total = lista.reduce((n, [, a, b]) => n + Math.ceil((S.indiceDeFecha(a, b) + 1) / 5), 0);
        puntos = []; usadas = [];
        if (total > 2) progreso(0);
        for (const [fuente, a, b] of lista) {
          usadas.push(fuente);
          for (let d = a; d <= b; d = sumarDias(d, 5)) {
            if (id !== consultaId) { progreso(null); return; } // cancelado o cambió de área
            const dias = Math.min(5, S.indiceDeFecha(d, b) + 1);
            let txt = "";
            for (let intento = 0; intento < 8; intento++) {
              txt = await fetch(`${API_FIRMS}/area/csv/${clave}/${fuente}/${bbox}/${dias}/${d}`).then((r) => r.text()).catch(() => "");
              if (txt.startsWith("latitude")) break;
              if ((/MAP_KEY|exceed/i.test(txt) || !txt) && total > 2) {
                msg(`⏸️ La NASA limita las consultas por minuto: esperando 60 s y sigo solo… (${consultas}/${total})`);
                await new Promise((r) => setTimeout(r, 60000));
                if (id !== consultaId) { progreso(null); return; }
              } else break;
            }
            if (!txt.startsWith("latitude")) throw new Error(txt.slice(0, 120) || "sin respuesta");
            consultas++;
            if (total > 2) {
              progreso(consultas / total);
              msg(`⬇️ Extrayendo datos de la NASA: ${consultas}/${total} consultas · ${fechaLarga(d)}… (puede tardar un poco)`);
            } else msg(`Descargando focos de ${fechaLarga(d)}…`);
            const lin = txt.trim().split("\n");
            const cab = lin[0].split(","), ix = (k) => cab.indexOf(k);
            const I = { lat: ix("latitude"), lon: ix("longitude"), f: ix("acq_date"), h: ix("acq_time"), c: ix("confidence"), frp: ix("frp"),
              bt: ix("bright_ti4") >= 0 ? ix("bright_ti4") : ix("brightness"), scan: ix("scan"), track: ix("track"), sat: ix("satellite"), dn: ix("daynight"), tipo: ix("type") };
            const esModis = fuente.startsWith("MODIS");
            for (let i = 1; i < lin.length; i++) {
              const col = lin[i].split(",");
              const conf = (col[I.c] || "").toLowerCase();
              if (esModis ? parseFloat(conf) < 30 : conf[0] === "l") continue;
              if (I.tipo >= 0 && col[I.tipo] !== "0" && col[I.tipo] !== "") continue; // volcanes / industrias
              const lat = +col[I.lat], lon = +col[I.lon];
              if (!dentro(lat, lon)) continue;
              puntos.push({
                lat, lon, f: col[I.f], h: (col[I.h] || "").padStart(4, "0"), conf, frp: +col[I.frp] || 0, bt: +col[I.bt] || null,
                scan: +col[I.scan] || null, track: +col[I.track] || null, sat: col[I.sat], dn: col[I.dn], modis: esModis,
              });
            }
          }
        }
        progreso(null);
        guardarCache(area.clave, desde, hasta, puntos, usadas);
      }
      if (id !== consultaId) return;
      await cargarProvincias();
      const incendios = agruparIncendios(puntos);
      incendios.forEach((x) => (x.lugar = lugarDe(x.centro[0], x.centro[1])));
      dibujarFocos(puntos, incendios, hasta, titulo);
      mostrarIncendios(incendios, puntos.length, titulo, hasta);
      estado.vivo = { desde, hasta, focos: puntos.length };
      const serie = estado.serie;
      if (actualizarSerie && serie && desde >= serie.inicio) {
        const celdas = {};
        puntos.forEach((p) => (celdas[p.f] = celdas[p.f] || new Set()).add(Math.round(p.lat * 100) + "," + Math.round(p.lon * 100)));
        for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
          const i = S.indiceDeFecha(serie.inicio, d);
          while (serie.diario.length <= i) serie.diario.push(0);
          serie.diario[i] = celdas[d] ? celdas[d].size : 0;
        }
        if (serie.origen === "navegador") guardarHistLocal(estado.area.clave, serie);
        calcular(); llenarSelectores(); dibujarTodo();
      }
      estado.vivo = { desde, hasta, focos: puntos.length };
      actualizarEstimacion();
      msg(`✓ ${fmt.format(incendios.length)} incendios (${fmt.format(puntos.length)} focos) · ${titulo}: ${fechaLarga(desde)}${desde !== hasta ? " – " + fechaLarga(hasta) : ""}` +
        (desdeCache ? " · ⚡ desde la caché" : ` · ${consultas} consultas a la NASA`) + " · Haz clic en un punto del mapa para ver su historial.", "vivo-ok");
    } catch (e) {
      progreso(null);
      if (id === consultaId) mostrarErrorVivo(e);
    }
  }

  // ----- Historial guardado en el navegador -----
  function leerHistLocal(clave) {
    try { const t = localStorage.getItem("firecal_hist_" + clave); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function guardarHistLocal(clave, serie) {
    try {
      localStorage.setItem("firecal_hist_" + clave, JSON.stringify({ inicio: serie.inicio, diario: serie.diario, fuente: serie.detalle, actualizado: serie.actualizado, dens: serie.dens || null }));
      return true;
    } catch (e) { return false; }
  }

  // Opción C: descarga en vivo el historial VIIRS del área (días-celda por día) y lo guarda
  let descargandoHist = false;
  async function consultarHistorial() {
    const clave = claveActual();
    if (!clave) { $("vivo-estado").innerHTML = '<span class="vivo-error">Primero pega tu MAP_KEY.</span>'; return; }
    if (descargandoHist) return;
    guardarClave(clave);
    const area = estado.area;
    const id = ++consultaId;
    const msg = (t, cls) => { if (id === consultaId) $("vivo-estado").innerHTML = cls ? `<span class="${cls}">${t}</span>` : t; };
    const op = $("sel-hist").value;
    descargandoHist = true; $("btn-hist").disabled = true;
    try {
      const disp = await leerDisponibilidad(clave);
      const hasta = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"].filter((k) => disp[k]).map((k) => disp[k][1]).sort().pop();
      const anioFin = +hasta.slice(0, 4);
      const anioIni = op === "2012" ? 2012 : anioFin - (+op - 1);
      const inicio = `${anioIni}-01-01`;
      const desde = inicio < "2012-01-20" ? "2012-01-20" : inicio; // solo VIIRS: serie homogénea sin intercalibrar
      const lista = tramos(disp, desde, hasta);
      const total = lista.reduce((s, [, a, b]) => s + Math.ceil((S.indiceDeFecha(a, b) + 1) / 5), 0);
      const dentro = filtroArea(area), bbox = area.bbox.join(",");
      const celdas = {}, bins = {};
      let hechas = 0;
      for (const [fuente, a, b] of lista) {
        for (let d = a; d <= b; d = sumarDias(d, 5)) {
          if (id !== consultaId || estado.area !== area) { msg("Descarga del historial cancelada (cambiaste de área o de consulta)."); return; }
          const dias = Math.min(5, S.indiceDeFecha(d, b) + 1);
          let txt = "";
          for (let intento = 0; intento < 12; intento++) {
            txt = await fetch(`${API_FIRMS}/area/csv/${clave}/${fuente}/${bbox}/${dias}/${d}`).then((r) => r.text()).catch(() => "");
            if (txt.startsWith("latitude")) break;
            if (/MAP_KEY|exceed/i.test(txt) || !txt) {
              msg(`Límite de consultas de la NASA alcanzado: esperando 60 s y sigo… (${hechas}/${total})`);
              await new Promise((r) => setTimeout(r, 60000));
            } else throw new Error(txt.slice(0, 120));
          }
          if (!txt.startsWith("latitude")) throw new Error("La API no respondió después de varios intentos.");
          const lin = txt.trim().split("\n");
          const cab = lin[0].split(","), ix = (k) => cab.indexOf(k);
          const iLat = ix("latitude"), iLon = ix("longitude"), iF = ix("acq_date"), iC = ix("confidence"), iT = ix("type");
          for (let i = 1; i < lin.length; i++) {
            const c = lin[i].split(",");
            if ((c[iC] || "").toLowerCase()[0] === "l") continue;
            if (iT >= 0 && c[iT] !== "0" && c[iT] !== "") continue;
            const lat = +c[iLat], lon = +c[iLon];
            if (!dentro(lat, lon)) continue;
            const ck = Math.round(lat * 100) + "," + Math.round(lon * 100);
            const set = (celdas[c[iF]] = celdas[c[iF]] || new Set());
            if (!set.has(ck)) {
              set.add(ck);
              const y = c[iF].slice(0, 4), bk = Math.floor(lat / 0.2) + "," + Math.floor(lon / 0.2);
              const m = (bins[y] = bins[y] || new Map());
              m.set(bk, (m.get(bk) || 0) + 1);
            }
          }
          hechas++;
          msg(`⬇️ Descargando historial de ${area.nombre}: ${hechas}/${total} consultas (${Math.round((100 * hechas) / total)} %) · ${d}`);
        }
      }
      const diario = [];
      for (let d = inicio; d <= hasta; d = sumarDias(d, 1)) diario.push(d < desde ? null : (celdas[d] ? celdas[d].size : 0));
      const serie = { inicio, diario, origen: "navegador", detalle: `NASA FIRMS API · VIIRS 375 m (${[...new Set(lista.map((x) => x[0]))].join(" + ").replace(/_/g, " ")})`,
        actualizado: S.isoFecha(new Date()) };
      serie.dens = {};
      Object.entries(bins).forEach(([y, m]) => { const arr = []; m.forEach((n, k) => { const [i, j] = k.split(","); arr.push(+i, +j, n); }); serie.dens[y] = arr; });
      const ok = guardarHistLocal(area.clave, serie);
      estado.serie = serie; estado.base = null;
      $("aviso-ejemplo").hidden = true;
      aplicarSerie();
      msg(`✓ Historial de ${area.nombre} listo: ${inicio} a ${hasta} (${hechas} consultas)${ok ? " · guardado en este navegador" : " · no se pudo guardar (almacenamiento lleno)"}`, "vivo-ok");
    } catch (e) {
      if (id === consultaId) mostrarErrorVivo(e);
    } finally {
      descargandoHist = false; $("btn-hist").disabled = false;
    }
  }

  /**
   * Agrupa focos en "incendios": focos a menos de ~1 km (celdas vecinas de 0,01°)
   * y con hasta 1 día de diferencia pertenecen al mismo incendio.
   */
  function agruparIncendios(puntos) {
    const padre = puntos.map((_, i) => i);
    const raiz = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
    const unir = (a, b) => { a = raiz(a); b = raiz(b); if (a !== b) padre[b] = a; };
    const rep = new Map();
    const ref = puntos.length ? puntos[0].f : null;
    puntos.forEach((p, i) => {
      p.cx = Math.round(p.lon * 100); p.cy = Math.round(p.lat * 100); p.dia = S.indiceDeFecha(ref, p.f);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dd = -1; dd <= 1; dd++) {
        const r = rep.get(`${p.cx + dx},${p.cy + dy},${p.dia + dd}`);
        if (r !== undefined) unir(r, i);
      }
      const k = `${p.cx},${p.cy},${p.dia}`;
      if (!rep.has(k)) rep.set(k, i);
    });
    const grupos = new Map();
    puntos.forEach((p, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(p); });
    const lista = [...grupos.values()].map((ps) => {
      let inicio = ps[0].f, fin = ps[0].f, frpMax = 0, frpSum = 0, s = 90, n = -90, w = 180, e = -180, la = 0, lo = 0, noche = 0;
      const pix = new Map();
      ps.forEach((p) => {
        if (p.f < inicio) inicio = p.f; if (p.f > fin) fin = p.f;
        frpMax = Math.max(frpMax, p.frp); frpSum += p.frp;
        s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon);
        la += p.lat; lo += p.lon; if (p.dn === "N") noche++;
        // superficie: píxeles distintos (~375 m) × tamaño real del píxel (scan × track)
        const k = Math.round(p.lat / 0.0034) + "," + Math.round(p.lon / 0.0034);
        if (!pix.has(k)) pix.set(k, (p.scan && p.track ? p.scan * p.track : (p.modis ? 1 : 0.14)));
      });
      const superficie = [...pix.values()].reduce((a, b) => a + b, 0);
      // primera detección (fecha + hora) y contorno de la zona (envolvente de los píxeles)
      const primero = ps.reduce((a, p) => (p.f + p.h < a.f + a.h ? p : a), ps[0]);
      const esq = [];
      ps.forEach((p) => {
        const dx = ((p.scan || (p.modis ? 1 : 0.375)) / 2) / (111.32 * Math.cos((p.lat * Math.PI) / 180));
        const dy = ((p.track || (p.modis ? 1 : 0.375)) / 2) / 110.57;
        esq.push([p.lon - dx, p.lat - dy], [p.lon + dx, p.lat - dy], [p.lon - dx, p.lat + dy], [p.lon + dx, p.lat + dy]);
      });
      return { puntos: ps, inicio, fin, dias: S.indiceDeFecha(inicio, fin) + 1, detecciones: ps.length, frpMax, frpSum,
        superficie, bounds: [[s, w], [n, e]], centro: [la / ps.length, lo / ps.length], noche, primero,
        contorno: envolvente(esq).map(([x, y]) => [y, x]) };
    });
    lista.sort((a, b) => b.superficie - a.superficie);
    lista.forEach((x, i) => { x.num = i + 1; x.puntos.forEach((p) => (p.incendio = x.num)); });
    return lista;
  }

  function nivelFRP(frp) {
    if (frp < 10) return "baja";
    if (frp < 50) return "moderada";
    if (frp < 200) return "alta";
    return "muy alta";
  }
  function horaTexto(f, hhmm) {
    const d = new Date(`${f}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    const lima = d.toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" });
    return `${hhmm.slice(0, 2)}:${hhmm.slice(2)} UTC (${lima} hora de Perú)`;
  }
  function fechaLarga(iso) {
    const d = S.parseFecha(iso);
    return EN ? `${MESES_LARGOS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${d.getUTCDate()} de ${MESES_LARGOS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  }
  const fmt2 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

  function popupFoco(p) {
    const conf = p.modis ? `${p.conf} %` : ({ n: "nominal", h: "alta" }[p.conf[0]] || p.conf);
    const pix = p.scan && p.track ? `${fmt2.format(p.scan)} × ${fmt2.format(p.track)} km ≈ ${fmt2.format(p.scan * p.track)} km²` : "—";
    return `<b>🔥 Foco de calor · ${fechaLarga(p.f)}</b><br>` +
      `Hora de la pasada: ${horaTexto(p.f, p.h)}<br>` +
      `Satélite: ${p.modis ? "antiguo · MODIS" : "moderno · VIIRS"} ${nombreSat[p.sat] || p.sat || ""} · ${p.dn === "N" ? "de noche" : "de día"}<br>` +
      `Intensidad (FRP): <b>${fmt1.format(p.frp)} MW</b> → ${nivelFRP(p.frp)}<br>` +
      (p.bt ? `Temperatura de brillo: ${fmt1.format(p.bt)} K (${fmt1.format(p.bt - 273.15)} °C)<br>` : "") +
      `Tamaño del píxel: ${pix}<br>` +
      `Confianza: ${conf}<br>` +
      `Ubicación: ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}<br>` +
      `<i>Parte del incendio #${p.incendio} (ver la lista debajo del mapa)</i>`;
  }

  function envolvente(puntos) {
    const pts = puntos.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length <= 2) return pts;
    const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const inf = [], sup = [];
    for (const p of pts) { while (inf.length >= 2 && cruz(inf[inf.length - 2], inf[inf.length - 1], p) <= 0) inf.pop(); inf.push(p); }
    for (const p of pts.reverse()) { while (sup.length >= 2 && cruz(sup[sup.length - 2], sup[sup.length - 1], p) <= 0) sup.pop(); sup.push(p); }
    return inf.slice(0, -1).concat(sup.slice(0, -1));
  }
  function tamanoTexto(km2) {
    const ha = km2 * 100;
    const canchas = Math.round(ha / 0.714); // cancha de fútbol ≈ 0,714 ha
    if (km2 >= 1) return `≈ ${fmt1.format(km2)} km² (${fmt.format(Math.round(ha))} hectáreas, como ${fmt.format(canchas)} canchas de fútbol)`;
    return `≈ ${fmt.format(Math.round(ha))} hectáreas (como ${fmt.format(Math.max(1, canchas))} canchas de fútbol)`;
  }
  function popupIncendio(x, hasta) {
    const activo = S.indiceDeFecha(x.fin, hasta) <= 1;
    const p0 = x.primero;
    return `<div class="popup-incendio"><h3>🔥 Incendio en ${x.lugar || "la zona"}</h3>` +
      `<p>${activo ? "<b style=\"color:#ec835a\">● Sigue activo</b> · " : ""}` +
      `Registrado por primera vez el <b>${fechaLarga(x.inicio)}</b> a las ${horaTexto(p0.f, p0.h).split(" (")[1].replace(")", "")}` +
      `${x.dias > 1 ? ` y duró <b>${x.dias} días</b> (hasta el ${fechaLarga(x.fin)})` : " (un solo día)"}.</p>` +
      `<p>Zona afectada con calor detectado: <b>${tamanoTexto(x.superficie)}</b>.</p>` +
      `<p><span class="dato">🛰️ ${fmt.format(x.detecciones)} detecciones${x.noche ? ` (${fmt.format(x.noche)} de noche)` : ""}</span>` +
      `<span class="dato">🌡️ Intensidad máx.: ${fmt1.format(x.frpMax)} MW (${nivelFRP(x.frpMax)})</span></p>` +
      `<p style="opacity:.75">Satélite: ${p0.modis ? "MODIS" : "VIIRS " + (nombreSat[p0.sat] || "")} · centro ${x.centro[0].toFixed(3)}, ${x.centro[1].toFixed(3)}. ` +
      `La línea punteada muestra toda la zona que abarcó.</p></div>`;
  }

  let marcoIncendio = null, capaDetalle = null, marcadorActivo = null;

  // Historial día a día de un incendio: focos por día y área acumulada
  function historialIncendio(x) {
    const dias = {};
    const vistos = new Set();
    let acum = 0;
    x.puntos.slice().sort((a, b) => (a.f + a.h < b.f + b.h ? -1 : 1)).forEach((p) => {
      const d = (dias[p.f] = dias[p.f] || { f: p.f, focos: 0, frp: 0, nuevo: 0, primera: p.h });
      d.focos++; d.frp = Math.max(d.frp, p.frp);
      const k = Math.round(p.lat / 0.0034) + "," + Math.round(p.lon / 0.0034);
      if (!vistos.has(k)) { vistos.add(k); d.nuevo += p.scan && p.track ? p.scan * p.track : (p.modis ? 1 : 0.14); }
    });
    // incluir días sin detección dentro del periodo del incendio
    const lista = [];
    for (let f = x.inicio; f <= x.fin; f = sumarDias(f, 1)) {
      const d = dias[f] || { f, focos: 0, frp: 0, nuevo: 0 };
      acum += d.nuevo; d.acum = acum; lista.push(d);
    }
    return lista;
  }
  function graficoHistorial(h) {
    const W = 240, H = 64, n = h.length, maxF = Math.max(1, ...h.map((d) => d.focos)), maxA = Math.max(0.01, h[n - 1].acum);
    const bw = Math.max(3, Math.min(26, (W - 10) / n - 3));
    const x0 = (i) => 5 + i * ((W - 10) / n) + ((W - 10) / n - bw) / 2;
    const barras = h.map((d, i) => {
      const alto = Math.round((d.focos / maxF) * (H - 24));
      return `<rect x="${x0(i).toFixed(1)}" y="${H - 14 - alto}" width="${bw.toFixed(1)}" height="${alto}" rx="2" fill="#ec835a"><title>${fechaLarga(d.f)}: ${d.focos} focos</title></rect>`;
    }).join("");
    const linea = h.map((d, i) => `${(x0(i) + bw / 2).toFixed(1)},${(H - 14 - (d.acum / maxA) * (H - 24)).toFixed(1)}`).join(" ");
    const et = (i) => { const d = S.parseFecha(h[i].f); return EN ? `${MESES[d.getUTCMonth()]} ${d.getUTCDate()}` : `${d.getUTCDate()} ${MESES[d.getUTCMonth()].toLowerCase()}`; };
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Historial del incendio día a día">` + barras +
      `<polyline points="${linea}" fill="none" stroke="#7a3414" stroke-width="2"/>` +
      `<text x="5" y="${H - 2}" fill="#555" font-size="10">${et(0)}</text>` +
      (n > 1 ? `<text x="${W - 5}" y="${H - 2}" fill="#555" font-size="10" text-anchor="end">${et(n - 1)}</text>` : "") + `</svg>` +
      `<div class="leyenda-mini"><i style="background:#ec835a"></i>focos por día <i style="background:#7a3414;height:2px"></i>área acumulada</div>`;
  }
  function popupHistorial(x, hasta) {
    const h = historialIncendio(x);
    const activo = S.indiceDeFecha(x.fin, hasta) <= 1;
    const p0 = x.primero;
    const filas = h.filter((d) => d.focos).slice(0, 6).map((d) =>
      `<tr><td>${fechaLarga(d.f).replace(/(?: de|,) \d{4}$/, "")}</td><td>${d.focos}</td><td>+${fmt.format(Math.round(d.nuevo * 100))} ha</td><td>${fmt.format(Math.round(d.acum * 100))} ha</td></tr>`).join("");
    const mas = h.filter((d) => d.focos).length > 6 ? `<tr><td colspan="4" style="opacity:.7">… y ${h.filter((d) => d.focos).length - 6} días más</td></tr>` : "";
    return `<div class="popup-incendio"><h3>🔥 #${x.num} · ${x.lugar || ""}</h3>` +
      `<p>${activo ? "<b style=\"color:#d2381a\">● Activo</b> · " : ""}${fechaLarga(x.inicio)}, ${horaTexto(p0.f, p0.h).split(" (")[1].replace(" hora de Perú)", "")}` +
      `${x.dias > 1 ? ` · duró <b>${x.dias} días</b>` : " · 1 día"}</p>` +
      `<p>Área: <b>${fmt.format(Math.round(x.superficie * 100))} ha</b> (${fmt.format(Math.max(1, Math.round((x.superficie * 100) / 0.714)))} canchas de fútbol)</p>` +
      `<p class="sub">Historial del incendio</p>${h.length > 1 ? graficoHistorial(h) : ""}` +
      `<table class="tabla-hist"><thead><tr><th>Día</th><th>Focos</th><th>Área nueva</th><th>Total</th></tr></thead><tbody>${filas}${mas}</tbody></table>` +
      `<p style="opacity:.75">🛰️ ${fmt.format(x.detecciones)} detecciones · máx. ${fmt1.format(x.frpMax)} MW (${nivelFRP(x.frpMax)})<br>` +
      `<span class="era ${p0.modis ? "modis" : "viirs"}">${p0.modis ? "Satélite antiguo · MODIS " + (nombreSat[p0.sat] || "") + " (1 km)" : "Satélite moderno · VIIRS " + (nombreSat[p0.sat] || "") + " (375 m)"}</span></p></div>`;
  }
  function popupCorto(x, hasta) {
    const activo = S.indiceDeFecha(x.fin, hasta) <= 1;
    return `<div class="popup-incendio"><b>🔥 #${x.num} · ${x.lugar || ""}</b><br>` +
      `${activo ? '<b style="color:#d2381a">● Activo</b> · ' : ""}${fechaLarga(x.inicio)}${x.dias > 1 ? ` · ${x.dias} días` : ""}<br>` +
      `Área: <b>${fmt.format(Math.round(x.superficie * 100))} ha</b> · ${fmt.format(x.detecciones)} detecciones<br>` +
      `<span style="opacity:.75">⬇️ Historial completo debajo del mapa</span></div>`;
  }
  function enfocarIncendio(x, hasta) {
    try { enfocarIncendioSeguro(x, hasta); } catch (err) { mostrarError("al abrir el incendio: " + err.message); }
  }
  function enfocarIncendioSeguro(x, hasta) {
    limpiarResaltado();
    // 1) borde de toda la zona del incendio
    const borde = L.polygon(x.contorno.length >= 3 ? x.contorno : [x.bounds[0], [x.bounds[0][0], x.bounds[1][1]], x.bounds[1], [x.bounds[1][0], x.bounds[0][1]]],
      { color: "#ffd2c2", weight: 2.5, fillColor: "#ff5a36", fillOpacity: 0.18, interactive: false, className: "zona-incendio", pane: "incendios" });
    // 2) los píxeles donde el satélite vio fuego (tamaño real de cada píxel), pintados
    const render = RENDER;
    const vistos = new Set();
    const pixeles = [];
    x.puntos.forEach((p) => {
      const k = Math.round(p.lat / 0.0034) + "," + Math.round(p.lon / 0.0034);
      if (vistos.has(k)) return;
      vistos.add(k);
      const dx = ((p.scan || (p.modis ? 1 : 0.375)) / 2) / (111.32 * Math.cos((p.lat * Math.PI) / 180));
      const dy = ((p.track || (p.modis ? 1 : 0.375)) / 2) / 110.57;
      pixeles.push(L.rectangle([[p.lat - dy, p.lon - dx], [p.lat + dy, p.lon + dx]],
        { renderer: render, pane: "incendios", stroke: false, fillColor: "#ff5a36", fillOpacity: 0.75, interactive: false }));
    });
    marcoIncendio = L.layerGroup([borde, ...pixeles]).addTo(mapa);
    if (marcadorActivo) marcadorActivo.m.setStyle({ radius: marcadorActivo.r, weight: 1 });
    marcadorActivo = x.marcador ? { m: x.marcador, r: x.radio } : null;
    if (marcadorActivo) { marcadorActivo.m.setStyle({ radius: x.radio + 3, weight: 2 }); marcadorActivo.m.bringToFront(); }
    mapa.fitBounds(borde.getBounds().pad(2.5), { maxZoom: 11, paddingTopLeft: [20, 120] });
    L.popup({ maxWidth: 270, minWidth: 250, autoPanPadding: [30, 30], offset: [0, -8], className: "popup-compacto" })
      .setLatLng([x.bounds[1][0], x.centro[1]]).setContent(popupHistorial(x, hasta)).openOn(mapa);
    $("mapa-fecha").innerHTML = `🔶 Área resaltada: incendio #${x.num} · ${tamanoTexto(x.superficie).split(" (")[0]} · <a href="#" id="quitar-resaltado">quitar</a>`;
    const q = document.getElementById("quitar-resaltado");
    if (q) q.addEventListener("click", (ev) => { ev.preventDefault(); limpiarResaltado(); mapa.closePopup(); });
  }
  function limpiarResaltado() {
    if (marcoIncendio) { mapa.removeLayer(marcoIncendio); marcoIncendio = null; }
    if (capaDetalle) { mapa.removeLayer(capaDetalle); capaDetalle = null; }
    if (marcadorActivo) { marcadorActivo.m.setStyle({ radius: marcadorActivo.r, weight: 1 }); marcadorActivo = null; }
    if (estado.vivo) $("mapa-fecha").textContent = "👆 Haz clic en un punto para ver el historial de ese incendio";
  }

  // Descripción breve al pasar el mouse por el punto
  function descripcionBreve(x, activo) {
    const ha = Math.round(x.superficie * 100);
    const dur = x.dias > 1 ? `duró ${x.dias} días` : "duró 1 día";
    return `<b>🔥 Incendio en ${x.lugar || "la zona"}</b><br>` +
      `${activo ? "<b style=\"color:#ff7a5c\">Sigue activo</b> · empezó" : "Ocurrió"} el ${fechaLarga(x.inicio)} y ${activo ? "lleva" : dur.replace("duró", "duró")}${activo ? ` ${x.dias} día${x.dias > 1 ? "s" : ""}` : ""}.<br>` +
      `Área afectada: ${fmt.format(ha)} hectáreas · ${fmt.format(x.detecciones)} detecciones.<br>` +
      `<span style="opacity:.75">Clic para ver su historial día a día</span>`;
  }
  function dibujarFocos(puntos, incendios, hasta, titulo, diaLimite) {
    if (!diaLimite) ultimaConsulta = { puntos, incendios, hasta, titulo };
    capaVivo.clearLayers();
    if (marcoIncendio) { mapa.removeLayer(marcoIncendio); marcoIncendio = null; }
    if (capaDetalle) { mapa.removeLayer(capaDetalle); capaDetalle = null; }
    marcadorActivo = null;
    const render = RENDER;
    // un puntito por incendio
    const corte = diaLimite || hasta;
    incendios.slice(0, 1500).filter((x) => x.inicio <= corte).reverse().forEach((x) => {
      const activo = diaLimite ? x.fin >= diaLimite : S.indiceDeFecha(x.fin, hasta) <= 1;
      const r = activo ? 5.5 : 4.5; // tamaño fijo en pantalla (no crece al alejar)
      x.radio = r;
      x.marcador = L.circleMarker(x.centro, { renderer: render, pane: "incendios", radius: r, color: x.primero.modis ? COLOR_MODIS : "#fff", weight: x.primero.modis ? 2 : 1,
        fillColor: activo ? "#ff3b1f" : "#ec835a", fillOpacity: 0.95 })
        .bindTooltip(descripcionBreve(x, activo), { className: "etiqueta-pais tip-incendio", direction: "top", offset: [0, -6] })
        .on("click", (ev) => { L.DomEvent.stopPropagation(ev); enfocarIncendio(x, hasta); })
        .addTo(capaVivo);
    });
    if (!mapa.hasLayer(capaVivo)) capaVivo.addTo(mapa);
    puntosClic = { lista: incendios.slice(0, 1500).filter((x) => x.inicio <= corte), hasta };
    if (incendios.length && !diaLimite) mapa.fitBounds(L.latLngBounds(incendios.slice(0, 1500).map((x) => x.centro)).pad(0.15), { maxZoom: 10 });
    if (!mapa._leyendaVivo) {
      const ley = L.control({ position: "bottomleft" });
      ley.onAdd = () => {
        const d = L.DomUtil.create("div", "leyenda-vivo");
        d.innerHTML = '<b>● = un incendio</b> (NASA FIRMS)<br><i style="background:#ff3b1f"></i>sigue activo<br><i style="background:#ec835a"></i>ya terminó<br><i style="background:#ec835a;border:2px solid #3987e5;box-sizing:border-box"></i>borde azul: satélite antiguo (MODIS, antes de 2012)<br><span style="opacity:.8">👆 Clic en un punto: su historial</span>';
        return d;
      };
      ley.addTo(mapa); mapa._leyendaVivo = ley;
    }
    if (diaLimite) {
      const n = incendios.filter((x) => x.inicio <= diaLimite).length, act = incendios.filter((x) => x.inicio <= diaLimite && x.fin >= diaLimite).length;
      $("mapa-titulo").textContent = `▶ ${fechaLarga(diaLimite)} · ${fmt.format(n)} incendios hasta ese día · ${fmt.format(act)} activos`;
      return;
    }
    $("mapa-titulo").textContent = `${fmt.format(incendios.length)} incendios · ${titulo} (NASA FIRMS)`;
    $("mapa-fecha").textContent = "👆 Haz clic en un punto para ver el historial de ese incendio";
  }

  // ▶ Animación: cómo aparecieron los incendios día a día en el periodo consultado
  let ultimaConsulta = null, animacion = null, puntosClic = null;
  function detenerAnimacion(redibujar) {
    if (animacion) { clearInterval(animacion); animacion = null; }
    $("btn-animar").textContent = "▶ Ver cómo avanzaron día a día";
    if (redibujar && ultimaConsulta) { const u = ultimaConsulta; dibujarFocos(u.puntos, u.incendios, u.hasta, u.titulo); }
  }
  function animarIncendios() {
    if (animacion) { detenerAnimacion(true); return; }
    if (!ultimaConsulta || !ultimaConsulta.incendios.length) return;
    const u = ultimaConsulta;
    const inicio = u.incendios.reduce((a, x) => (x.inicio < a ? x.inicio : a), u.hasta);
    let d = inicio;
    limpiarResaltado(); mapa.closePopup();
    $("btn-animar").textContent = "⏸ Detener";
    const paso = Math.max(250, Math.min(900, 18000 / (S.indiceDeFecha(inicio, u.hasta) + 1)));
    const tick = () => {
      dibujarFocos(u.puntos, u.incendios, u.hasta, u.titulo, d);
      if (d >= u.hasta) { clearInterval(animacion); animacion = null; $("btn-animar").textContent = "↺ Repetir"; return; }
      d = sumarDias(d, 1);
    };
    tick();
    animacion = setInterval(tick, paso);
  }
  function descargarIncendiosCSV() {
    if (!ultimaConsulta) return;
    const q = (t) => `"${String(t).replace(/"/g, '""')}"`;
    let csv = "numero,lugar,inicio,fin,dias,area_ha,detecciones,frp_max_mw,lat,lon,satelite\n";
    ultimaConsulta.incendios.forEach((x) => {
      csv += [x.num, q(x.lugar || ""), x.inicio, x.fin, x.dias, Math.round(x.superficie * 100), x.detecciones, x.frpMax.toFixed(1),
        x.centro[0].toFixed(4), x.centro[1].toFixed(4), x.primero.modis ? "MODIS (antiguo)" : "VIIRS (moderno)"].join(",") + "\n";
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = `firecal_incendios_${estado.area.clave}_${ultimaConsulta.titulo.replace(/\s+/g, "_")}.csv`;
    a.click();
  }

  function mostrarIncendios(incendios, nFocos, titulo, hasta) {
    const t = $("tarjeta-incendios");
    t.hidden = false;
    $("sin-incendios").hidden = true;
    $("inc-titulo").textContent = `${estado.area.nombre} · ${titulo}`;
    const total = incendios.reduce((s, x) => s + x.superficie, 0);
    const activos = incendios.filter((x) => S.indiceDeFecha(x.fin, hasta) <= 1).length;
    $("inc-resumen").innerHTML = nFocos
      ? `<b>${fmt.format(incendios.length)}</b> incendios · <b>${fmt.format(nFocos)}</b> focos · zona con calor detectado ≈ <b>${fmt.format(Math.round(total))} km²</b>` +
        (activos ? ` · <b>${activos}</b> siguen activos` : "") + ". Cada punto del mapa es un incendio; abajo, los 25 más grandes (clic para ver su historial)."
      : "No se detectaron incendios en este periodo.";
    const filas = incendios.slice(0, 25).map((x) => {
      const activo = S.indiceDeFecha(x.fin, hasta) <= 1;
      return `<tr data-n="${x.num}" tabindex="0"><td>#${x.num}${activo ? " 🔴" : ""}</td><td>${x.lugar || "—"}</td><td>${fechaLarga(x.inicio)}</td><td>${x.dias}</td>` +
        `<td>${fmt1.format(x.superficie)}</td><td>${fmt.format(x.detecciones)}</td><td>${fmt1.format(x.frpMax)} (${nivelFRP(x.frpMax)})</td></tr>`;
    }).join("");
    $("tabla-incendios").innerHTML = nFocos
      ? "<thead><tr><th>Incendio</th><th>Lugar</th><th>Registrado</th><th>Días</th><th>Zona km²</th><th>Detecciones</th><th>Intensidad máx. (MW)</th></tr></thead><tbody>" + filas + "</tbody>"
      : "";
    $("tabla-incendios").querySelectorAll("tr[data-n]").forEach((tr) => {
      const ir = () => { enfocarIncendio(incendios[+tr.dataset.n - 1], hasta); $("mapa").scrollIntoView({ behavior: "smooth", block: "center" }); };
      tr.addEventListener("click", ir);
      tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ir(); });
    });
  }

  // ---------- Explicación interactiva: unión MODIS + VIIRS ----------
  const sensores = window.FIRECAL_SENSORES || {};
  let pasoExp = 0, temporizadorExp = null;
  function datosExplicacion() {
    const k = estado.area && sensores[estado.area.clave] ? estado.area.clave : "HCO";
    return { k, d: sensores[k], nombre: k === (estado.area && estado.area.clave) ? estado.area.nombre : "Huánuco" };
  }
  function dibujarExplicacion(paso) {
    pasoExp = paso;
    document.querySelectorAll(".pasos [data-paso]").forEach((b) => b.classList.toggle("activo", +b.dataset.paso === paso));
    const info = datosExplicacion();
    if (!info.d) return;
    const { d, nombre } = info;
    $("exp-area").textContent = nombre;
    const anios = d.anios.map(String);
    const AZUL = "#3987e5", NARANJA = "#d95926", VERDE = "#199e70", ROJO = "#e66767";
    // razón VIIRS/MODIS en los años completos que coinciden
    const sol = d.anios.map((y, i) => [y, d.modis[i], d.viirs[i]]).filter(([y, m, v]) => y >= 2013 && y <= 2025 && m > 0);
    const razon = sol.reduce((a, x) => a + x[2], 0) / Math.max(1, sol.reduce((a, x) => a + x[1], 0));
    const sinNull = (arr, desde) => arr.map((v, i) => (d.anios[i] < desde ? null : v));
    const base = {
      animationDuration: 900,
      grid: { left: 56, right: 16, top: 40, bottom: 30 },
      legend: { top: 0, textStyle: { color: C.texto2 } },
      tooltip: { ...tooltipBase, trigger: "axis", valueFormatter: (v) => (v == null ? "—" : fmt.format(Math.round(v))) },
      xAxis: { type: "category", data: anios, ...ejeBase, splitLine: { show: false } },
      yAxis: { type: "value", name: "días-celda con fuego por año", nameTextStyle: { color: C.tenue, align: "left" }, ...ejeBase },
    };
    const linea = (name, data, color, extra = {}) => ({ name, type: "line", data, symbol: "circle", symbolSize: 5, lineStyle: { color, width: 2.5 }, itemStyle: { color }, ...extra });
    let opt, html;
    if (paso === 0) {
      opt = { ...base, series: [linea("MODIS (1 km)", d.modis, AZUL), linea("VIIRS (375 m)", sinNull(d.viirs, 2012), NARANJA)] };
      html = `<h3>1 · Dos generaciones de satélites</h3>
        <p><b style="color:${AZUL}">MODIS</b> vigila incendios desde 2000 con píxeles de <b>1 km</b>.</p>
        <p><b style="color:${NARANJA}">VIIRS</b> llegó en 2012 con píxeles de <b>375 m</b>: cada píxel es <b>7 veces más pequeño</b>, así que ve incendios chicos que MODIS no alcanza a ver.</p>
        <p>Por eso la línea naranja va siempre más arriba, aunque miren el mismo fuego.</p>`;
    } else if (paso === 1) {
      const pegada = d.anios.map((y, i) => (y < 2012 ? d.modis[i] : d.viirs[i]));
      opt = { ...base, series: [
        linea("Serie pegada SIN corregir", pegada, ROJO, { lineStyle: { color: ROJO, width: 3, type: "dashed" },
          markArea: { itemStyle: { color: "rgba(230,103,103,0.10)" }, label: { color: C.texto2 }, data: [[{ xAxis: "2011", name: "¡salto falso!" }, { xAxis: "2013" }]] } }),
        linea("MODIS (1 km)", d.modis, AZUL, { lineStyle: { color: AZUL, width: 1.5, opacity: 0.5 }, itemStyle: { color: AZUL, opacity: 0.5 } }),
      ] };
      html = `<h3>2 · El problema</h3>
        <p>En los años en que funcionaron los dos, VIIRS contó en promedio</p>
        <span class="grande">${fmt1.format(razon)} veces más</span>
        <p>fuego que MODIS en ${nombre}. Si pegamos las dos series tal cual (línea roja), parece que en 2012 el fuego se disparó… <b>¡pero solo cambió el satélite!</b> Así no se pueden comparar los años.</p>`;
    } else if (paso === 2) {
      opt = { animationDuration: 900, grid: { left: 56, right: 16, top: 30, bottom: 30 },
        tooltip: { ...tooltipBase, trigger: "axis", valueFormatter: (v) => fmt1.format(v) + "×" },
        xAxis: { type: "category", data: MESES, ...ejeBase, splitLine: { show: false } },
        yAxis: { type: "value", name: "factor VIIRS ÷ MODIS", nameTextStyle: { color: C.tenue, align: "left" }, ...ejeBase },
        series: [{ type: "bar", data: d.factores, barMaxWidth: 26, itemStyle: { color: VERDE, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", color: C.texto2, formatter: (p) => fmt1.format(p.value) + "×" } }] };
      const sep = d.factores[8];
      html = `<h3>3 · La solución: un factor por mes</h3>
        <p>Comparamos los dos satélites <b>mes por mes</b> en los años que coinciden (2012 en adelante).</p>
        <p>Por ejemplo, en septiembre VIIRS ve <b>${fmt1.format(sep)} veces</b> lo que ve MODIS.</p>
        <p>Entonces, para los años antiguos (2001–2011) <b>multiplicamos lo que vio MODIS por el factor de cada mes</b>. Es como convertir monedas: pasamos todo a "equivalente VIIRS".</p>`;
    } else {
      opt = { ...base, series: [
        linea("Serie unida (equivalente VIIRS)", d.armonizado, VERDE, { lineStyle: { color: VERDE, width: 3 },
          markArea: { itemStyle: { color: "rgba(57,135,229,0.08)" }, label: { color: C.texto2, position: "insideTop" },
            data: [[{ xAxis: anios[0], name: "MODIS ajustado" }, { xAxis: "2011" }], [{ xAxis: "2012", name: "VIIRS", itemStyle: { color: "rgba(217,89,38,0.08)" } }, { xAxis: anios[anios.length - 1] }]] } }),
        linea("MODIS original", d.modis, AZUL, { lineStyle: { color: AZUL, width: 1.5, opacity: 0.45 }, itemStyle: { color: AZUL, opacity: 0.45 } }),
      ] };
      const comp = d.anios.map((y, i) => [y, d.armonizado[i]]).filter(([y]) => y <= 2025);
      const max = comp.reduce((a, x) => (x[1] > a[1] ? x : a), comp[0]);
      html = `<h3>4 · Resultado: 25 años comparables</h3>
        <p>La línea verde une los dos satélites <b>sin saltos falsos</b>. Ahora sí podemos comparar 2005 con 2024, ver qué meses son críticos y medir si el fuego aumenta o disminuye.</p>
        <p>En ${nombre}, el año con más fuego fue <b>${max[0]}</b>.</p>
        <p style="opacity:.8">Esta serie unida es la que usan el calendario, el cuadro mensual y la tendencia.</p>`;
    }
    grafico("graf-explica").setOption(opt, true);
    $("exp-texto").innerHTML = html;
    $("exp-texto").style.animation = "none"; void $("exp-texto").offsetWidth; $("exp-texto").style.animation = "";
  }
  function detenerExplicacion() {
    if (temporizadorExp) { clearInterval(temporizadorExp); temporizadorExp = null; }
    $("btn-reproducir").textContent = "▶ Ver explicación";
  }
  function reproducirExplicacion() {
    if (temporizadorExp) { detenerExplicacion(); return; }
    dibujarExplicacion(0);
    $("btn-reproducir").textContent = "⏸ Pausar";
    temporizadorExp = setInterval(() => {
      if (pasoExp >= 3) { detenerExplicacion(); return; }
      dibujarExplicacion(pasoExp + 1);
    }, 7000);
  }

  // ---------- ⚠️ Riesgo de incendio (Perú y Amazonía) ----------
  const RG = 0.1; // cuadros de 0,1° (~11 km)
  const NIVELES = [
    { minProb: 0.3, nombre: "Muy alto", color: "#8e1b14", consejo: "No hacer quemas. Vigilar a diario y avisar de inmediato si se ve humo." },
    { minProb: 0.15, nombre: "Alto", color: "#d0342c", consejo: "Evitar quemas agrícolas y fogatas. Tener agua y herramientas a mano." },
    { minProb: 0.05, nombre: "Medio", color: "#ef8a2f", consejo: "Quemas solo con permiso, de mañana y con cortafuegos." },
    { minProb: 0, nombre: "Bajo", color: "#f2c94c", consejo: "Riesgo bajo, pero no dejar fuegos sin vigilancia." },
  ];
  let capaRiesgo = null, calculandoRiesgo = false;

  // Descarga (con caché) los focos de un área entre dos fechas
  async function descargarPuntos(clave, area, desde, hasta, alAvanzar) {
    const c = leerCache(area.clave, desde, hasta);
    if (c) return descomprimir(c);
    const disp = await leerDisponibilidad(clave);
    const dentro = filtroArea(area), bbox = area.bbox.join(","), puntos = [], usadas = [];
    for (const [fuente, a, b] of tramos(disp, desde, hasta)) {
      usadas.push(fuente);
      for (let d = a; d <= b; d = sumarDias(d, 5)) {
        const dias = Math.min(5, S.indiceDeFecha(d, b) + 1);
        let txt = "";
        for (let k = 0; k < 8; k++) {
          txt = await fetch(`${API_FIRMS}/area/csv/${clave}/${fuente}/${bbox}/${dias}/${d}`).then((r) => r.text()).catch(() => "");
          if (txt.startsWith("latitude")) break;
          if (/MAP_KEY|exceed/i.test(txt) || !txt) { if (alAvanzar) alAvanzar(null, "⏸️ La NASA limita las consultas por minuto: espero 60 s y sigo…"); await new Promise((r) => setTimeout(r, 60000)); }
          else throw new Error(txt.slice(0, 120));
        }
        if (!txt.startsWith("latitude")) throw new Error("la API no respondió");
        const lin = txt.trim().split("\n"), cab = lin[0].split(","), ix = (k) => cab.indexOf(k);
        const I = { lat: ix("latitude"), lon: ix("longitude"), f: ix("acq_date"), h: ix("acq_time"), c: ix("confidence"), frp: ix("frp"), tipo: ix("type"), sat: ix("satellite"), dn: ix("daynight"), scan: ix("scan"), track: ix("track") };
        const esModis = fuente.startsWith("MODIS");
        for (let i = 1; i < lin.length; i++) {
          const col = lin[i].split(",");
          const conf = (col[I.c] || "").toLowerCase();
          if (esModis ? parseFloat(conf) < 30 : conf[0] === "l") continue;
          if (I.tipo >= 0 && col[I.tipo] !== "0" && col[I.tipo] !== "") continue;
          const lat = +col[I.lat], lon = +col[I.lon];
          if (!dentro(lat, lon)) continue;
          puntos.push({ lat, lon, f: col[I.f], h: (col[I.h] || "").padStart(4, "0"), conf, frp: +col[I.frp] || 0, sat: col[I.sat], dn: col[I.dn], scan: +col[I.scan] || null, track: +col[I.track] || null, modis: esModis });
        }
        if (alAvanzar) alAvanzar(1);
      }
    }
    guardarCache(area.clave, desde, hasta, puntos, usadas);
    return puntos;
  }

  // Lluvia del último mes vs. lo normal (NASA POWER). Se mide en varios puntos del área y se usa la mediana.
  // Los datos más recientes de POWER son provisionales (modelo GEOS-IT) y a veces salen fuera de rango:
  // si la lluvia es más de 3 veces o menos de 1/4 de lo normal, se marca como dudosa y NO se usa.
  async function sequedadPunto(lat, lon, fecha, aniosAntes) {
    try {
      const fin = sumarDias(fecha, -1), ini = `${aniosAntes[0]}-01-01`;
      const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${ini.replace(/-/g, "")}&end=${fin.replace(/-/g, "")}&format=JSON`;
      const d = (await fetch(url).then((r) => r.json())).properties.parameter.PRECTOTCORR;
      const suma = (a, b) => { let t = 0, n = 0, dias = 0; for (let f = a; f <= b; f = sumarDias(f, 1)) { dias++; const v = d[f.replace(/-/g, "")]; if (v != null && v > -900) { t += v; n++; } } return n >= dias * 0.8 ? (t * dias) / n : null; };
      const actual = suma(sumarDias(fecha, -30), fin);
      const normales = aniosAntes.map((y) => { const f = `${y}${fecha.slice(4)}`; return suma(sumarDias(f, -30), sumarDias(f, -1)); }).filter((v) => v != null).sort((x, y) => x - y);
      if (actual == null || normales.length < 3) return null;
      const normal = normales[Math.floor(normales.length / 2)]; // mediana: un año raro no la mueve
      return { actual, normal: Math.max(normal, 5) };
    } catch (e) { return null; }
  }
  async function sequedad(area, fecha, aniosAntes) {
    const dentro = filtroArea(area), [w, s, e, n] = area.bbox;
    const cand = [[area.lat, area.lon], [s + (n - s) * 0.25, w + (e - w) * 0.25], [s + (n - s) * 0.25, w + (e - w) * 0.75], [s + (n - s) * 0.75, w + (e - w) * 0.25], [s + (n - s) * 0.75, w + (e - w) * 0.75]];
    const puntos = cand.filter(([la, lo], k) => k === 0 || dentro(la, lo));
    const res = (await Promise.all(puntos.map(([la, lo]) => sequedadPunto(la, lo, fecha, aniosAntes)))).filter(Boolean);
    if (!res.length) return null;
    const razones = res.map((x) => x.actual / x.normal).sort((x, y) => x - y);
    const razon = razones[Math.floor(razones.length / 2)];
    const actual = S.media(res.map((x) => x.actual)), normal = S.media(res.map((x) => x.normal));
    return { actual, normal, razon, puntos: res.length, dudoso: razon > 3 || razon < 0.25 };
  }
  // Texto de lluvia sin porcentajes absurdos
  function textoLluvia(seca) {
    if (EN) {
      if (seca.dudoso) return `NASA POWER's most recent rain data are provisional and here they look unreasonable (${Math.round(seca.actual)} mm versus ${Math.round(seca.normal)} mm normal), so <b>they were not used</b> in the calculation`;
      const p = Math.round((seca.razon - 1) * 100);
      if (seca.razon >= 1.5) return `last month it rained about <b>${seca.razon.toFixed(1)} times</b> the normal amount (more moisture lowers the risk)`;
      return `last month it rained ${Math.abs(p)} % ${p < 0 ? "<b>less</b>" : "more"} than normal${p < -20 ? " (dry vegetation burns more easily)" : p > 20 ? " (more moisture lowers the risk)" : ""}`;
    }
    if (seca.dudoso) return `los datos de lluvia más recientes de NASA POWER son provisionales y aquí salen fuera de lo razonable (${Math.round(seca.actual)} mm frente a ${Math.round(seca.normal)} mm normales), así que <b>no se usaron</b> para el cálculo`;
    const pct = Math.round((seca.razon - 1) * 100);
    if (seca.razon >= 1.5) return `en el último mes llovió unas <b>${seca.razon.toFixed(1).replace(".", ",")} veces</b> lo normal (más humedad, baja el riesgo)`;
    return `en el último mes llovió ${Math.abs(pct)} % ${pct < 0 ? "<b>menos</b>" : "más"} de lo normal${pct < -20 ? " (vegetación seca, arde más fácil)" : pct > 20 ? " (más humedad, baja el riesgo)" : ""}`;
  }

  // Amazonía: Perú y sus regiones, países amazónicos con historial (Bolivia, Colombia, Ecuador)
  // y cualquier área dibujada dentro de la Amazonía (hasta ~12° x 12°, para no pedir demasiados datos)
  function esAreaPeru(area) {
    if (!area) return false;
    if (["PER", "HCO", "AMZ", "LOR", "UCA", "MDD", "SAM", "AMA", "BOL", "COL", "ECU"].includes(area.clave)) return true;
    const [w, s, e, n] = area.bbox;
    return area.clave.startsWith("AREA_") && w > -82 && e < -43 && s > -21 && n < 11 && e - w <= 12 && n - s <= 12;
  }

  async function calcularRiesgo() {
    const area = estado.area, clave = claveActual();
    const msg = (t, cls) => ($("rg-estado").innerHTML = cls ? `<span class="${cls}">${t}</span>` : t);
    if (!esAreaPeru(area)) {
      // llevar al usuario a la Amazonía peruana automáticamente
      const amz = regionesEnfoque.find((f) => f.properties.clave === "AMZ");
      if (amz) { seleccionarRegion(amz); mostrarPestana("riesgo"); msg("Cambié a la Amazonía peruana. Pulsa ⚠️ Calcular riesgo (o dibuja un área de la Amazonía de hasta ~1.300 km de lado)."); }
      return;
    }
    if (!clave) { msg("Primero pega tu MAP_KEY en el panel 3.", "vivo-error"); return; }
    if (calculandoRiesgo) return;
    calculandoRiesgo = true; $("btn-riesgo").disabled = true;
    try {
      const ult = await ultimoDiaDisponible(clave);
      let fecha = $("rg-fecha").value || ult;
      if (fecha > ult) fecha = ult;
      const finVentana = sumarDias(fecha, 13);
      const y0 = +fecha.slice(0, 4);
      const aniosHist = []; for (let y = 2012; y < y0; y++) aniosHist.push(y); // solo años ANTERIORES (sirve para comprobar)
      const comprobable = finVentana <= ult;
      const total = aniosHist.length * 3 + 2 + (comprobable ? 3 : 0);
      let hechas = 0;
      $("rg-barra").hidden = false; $("rg-relleno").style.width = "0%";
      const avanzar = (n, t) => { if (n) hechas += n; $("rg-relleno").style.width = Math.min(100, Math.round((100 * hechas) / total)) + "%"; msg(t || `⬇️ Extrayendo datos de la NASA: ${Math.min(hechas, total)}/${total} consultas (la primera vez tarda ~1 min; luego queda en caché)…`); };
      avanzar(0);
      // 1) historia: mismas 2 semanas en cada año anterior
      const celdas = new Map(); // "i,j" -> { anios:Set, focos, reciente, real }
      const celda = (lat, lon) => { const k = Math.floor(lat / RG) + "," + Math.floor(lon / RG); if (!celdas.has(k)) celdas.set(k, { anios: new Set(), focos: 0, reciente: 0, real: 0 }); return celdas.get(k); };
      for (const y of aniosHist) {
        const a = `${y}${fecha.slice(4)}`, b = sumarDias(a, 13);
        const pts = await descargarPuntos(clave, area, a, b, avanzar);
        pts.forEach((p) => { const c = celda(p.lat, p.lon); c.anios.add(y); c.focos++; });
      }
      // 2) incendios recientes (7 días antes)
      const recientes = await descargarPuntos(clave, area, sumarDias(fecha, -7), sumarDias(fecha, -1), avanzar);
      recientes.forEach((p) => { celda(p.lat, p.lon).reciente++; });
      // 3) sequedad
      msg("🌧️ Revisando la lluvia del último mes (NASA POWER)…");
      const seca = await sequedad(area, fecha, aniosHist.slice(-10));
      // 4) comprobación con lo que pasó de verdad
      let reales = null;
      if (comprobable) { reales = await descargarPuntos(clave, area, fecha, finVentana, avanzar); reales.forEach((p) => { celda(p.lat, p.lon).real++; }); }
      $("rg-barra").hidden = true;
      // 5) puntaje por cuadro: SOLO cuadros cuyo centro está dentro del área
      const N = Math.max(1, aniosHist.length);
      const ajusteSeca = !seca || seca.dudoso ? 0 : seca.razon < 0.6 ? 0.2 : seca.razon < 0.8 ? 0.1 : seca.razon > 1.4 ? -0.2 : seca.razon > 1.2 ? -0.1 : 0;
      const dentro = filtroArea(area);
      const [bw, bs, be, bn] = area.bbox;
      const lista = [];
      let territorio = 0;
      for (let i = Math.floor(bs / RG); i <= Math.floor(bn / RG); i++) for (let j = Math.floor(bw / RG); j <= Math.floor(be / RG); j++) {
        const lat = (i + 0.5) * RG, lon = (j + 0.5) * RG;
        if (!dentro(lat, lon)) continue;
        territorio++;
        const c = celdas.get(i + "," + j) || { anios: new Set(), focos: 0, reciente: 0, real: 0 };
        let cerca = 0; // focos recientes en el cuadro y alrededor (~15 km)
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const v = celdas.get(`${i + di},${j + dj}`); if (v) cerca += v.reciente; }
        const frec = c.anios.size / N;
        // puntaje para ordenar (probado con datos reales 2024-2025)
        const puntaje = frec + 0.15 * Math.log1p(c.focos / N) + (cerca >= 5 ? 0.25 : cerca >= 1 ? 0.15 : 0);
        if (puntaje <= 0) continue;
        // probabilidad aproximada de fuego en las 2 semanas (frecuencia histórica ajustada)
        let r = frec * (1 + (cerca >= 5 ? 0.4 : cerca >= 1 ? 0.25 : 0) + ajusteSeca);
        if (cerca >= 1) r = Math.max(r, 0.15);
        r = Math.max(0.01, Math.min(0.95, r));
        lista.push({ i, j, lat, lon, r, puntaje, frec, anios: c.anios.size, focos: c.focos, cerca, real: c.real });
      }
      // Niveles RELATIVOS: muy alto = 5 % del territorio con más puntaje, alto = siguiente 10 %, medio = siguiente 15 %
      // (con mínimos absolutos para no marcar "muy alto" en épocas casi sin fuego)
      lista.sort((a, b) => b.puntaje - a.puntaje);
      lista.forEach((x, n) => {
        const q = n / territorio;
        let k = q < 0.05 ? 0 : q < 0.15 ? 1 : q < 0.30 ? 2 : 3;
        while (k < 3 && x.r < NIVELES[k].minProb) k++;
        x.nivel = NIVELES[k];
      });
      await cargarProvincias();
      lista.slice(0, 400).forEach((x) => (x.lugar = lugarDe(x.lat, x.lon)));
      const ctx = { fecha, finVentana, N, aniosHist, seca, comprobable, territorio };
      dibujarRiesgo(lista, ctx);
      resumenRiesgo(lista, ctx, reales, area);
      msg(`✓ Riesgo calculado para ${area.nombre}: del ${fechaLarga(fecha)} al ${fechaLarga(finVentana)}. Haz clic en un cuadro para ver por qué.`, "vivo-ok");
    } catch (e) {
      $("rg-barra").hidden = true;
      msg("No se pudo calcular el riesgo: " + (e.message || e), "vivo-error");
    } finally { calculandoRiesgo = false; $("btn-riesgo").disabled = false; }
  }

  const rangoTxt = (a, b) => { const A = S.parseFecha(a), B = S.parseFecha(b); return EN ? `${MESES_LARGOS[A.getUTCMonth()]} ${A.getUTCDate()} and ${MESES_LARGOS[B.getUTCMonth()]} ${B.getUTCDate()}` : `${A.getUTCDate()} de ${MESES_LARGOS[A.getUTCMonth()]} y el ${B.getUTCDate()} de ${MESES_LARGOS[B.getUTCMonth()]}`; };
  function porQue(x, ctx) {
    const motivos = [];
    if (x.anios) motivos.push(`🔥 <b>Historia:</b> hubo incendios aquí en <b>${x.anios} de ${ctx.N} años</b> (${ctx.aniosHist[0]}–${ctx.aniosHist[ctx.aniosHist.length - 1]}) entre el ${rangoTxt(ctx.fecha, ctx.finVentana)}.`);
    else motivos.push("🔥 <b>Historia:</b> en esta época casi no hubo incendios aquí en años anteriores.");
    if (x.cerca) motivos.push(`📍 <b>Ahora:</b> ${x.cerca} foco${x.cerca > 1 ? "s" : ""} de fuego activo${x.cerca > 1 ? "s" : ""} en los últimos 7 días a menos de ~15 km.`);
    if (ctx.seca) {
      motivos.push(`🌧️ <b>Lluvia:</b> ${textoLluvia(ctx.seca)}.`);
    }
    return motivos;
  }
  function popupRiesgo(x, ctx) {
    return `<div class="popup-incendio popup-riesgo"><h3>⚠️ Riesgo <span class="rg-nivel" style="background:${x.nivel.color}">${x.nivel.nombre.toUpperCase()}</span></h3>` +
      `<p><b>Probabilidad aproximada de fuego en esas 2 semanas: ${Math.round(x.r * 100)} %</b></p>` +
      `<p>${x.lugar || ""}</p><p class="sub">¿Por qué?</p><ul>${porQue(x, ctx).map((m) => `<li>${m}</li>`).join("")}</ul>` +
      `<p><b>Qué hacer:</b> ${x.nivel.consejo}</p>` +
      (ctx.comprobable ? `<p style="opacity:.8">Comprobación: en esas 2 semanas ${x.real ? `<b>sí hubo ${x.real} foco${x.real > 1 ? "s" : ""}</b> aquí` : "no hubo focos aquí"}.</p>` : "") + `</div>`;
  }
  function dibujarRiesgo(lista, ctx) {
    if (!capaRiesgo) { capaRiesgo = L.layerGroup(); controlCapas.addOverlay(capaRiesgo, "⚠️ Riesgo de incendio"); }
    capaRiesgo.clearLayers();
    lista.forEach((x) => {
      L.rectangle([[x.i * RG, x.j * RG], [(x.i + 1) * RG, (x.j + 1) * RG]], {
        renderer: RENDER, pane: "incendios", stroke: true, color: "#00000055", weight: 0.5, fillColor: x.nivel.color, fillOpacity: 0.35 + 0.45 * Math.min(1, x.r),
      }).bindTooltip(`<b>Riesgo ${x.nivel.nombre} · ${Math.round(x.r * 100)} %</b><br>${x.lugar || ""}<br>${x.anios} de ${ctx.N} años con fuego en estas fechas${x.cerca ? ` · ${x.cerca} focos recientes cerca` : ""}<br><i>Clic: por qué y qué hacer</i>`, { className: "etiqueta-pais tip-incendio", sticky: true })
        .on("click", (ev) => { L.DomEvent.stopPropagation(ev); L.popup({ maxWidth: 300, className: "popup-compacto" }).setLatLng([x.lat, x.lon]).setContent(popupRiesgo(x, ctx)).openOn(mapa); })
        .addTo(capaRiesgo);
    });
    if (pestanaActual === "riesgo") { if (!mapa.hasLayer(capaRiesgo)) capaRiesgo.addTo(mapa); if (mapa.hasLayer(capaVivo)) mapa.removeLayer(capaVivo); }
    if (leyendaRiesgo) mapa.removeControl(leyendaRiesgo);
    leyendaRiesgo = L.control({ position: "bottomright" });
    leyendaRiesgo.onAdd = () => {
      const d = L.DomUtil.create("div", "leyenda-vivo");
      d.innerHTML = `<b>⚠️ Riesgo de incendio</b><br>${fechaLarga(ctx.fecha).replace(/(?: de|,) \d{4}$/, "")} – ${fechaLarga(ctx.finVentana)}<br>` +
        NIVELES.map((n) => `<i style="background:${n.color};border-radius:2px"></i>${n.nombre}`).join("<br>") + '<br><span style="opacity:.8">Clic en un cuadro: por qué</span>';
      return d;
    };
    leyendaRiesgo.addTo(mapa);
    if (lista.length) mapa.fitBounds(capaSeleccion ? capaSeleccion.getBounds() : L.latLngBounds(lista.map((x) => [x.lat, x.lon])), { padding: [20, 20] });
    $("mapa-titulo").textContent = `riesgo de incendio · ${estado.area.nombre} · ${fechaLarga(ctx.fecha)} a ${fechaLarga(ctx.finVentana)}`;
  }
  let leyendaRiesgo = null;
  function resumenRiesgo(lista, ctx, reales, area) {
    $("rg-area").textContent = area.nombre;
    const cuenta = NIVELES.map((n) => lista.filter((x) => x.nivel === n).length);
    const altos = lista.filter((x) => x.nivel === NIVELES[0] || x.nivel === NIVELES[1]);
    const pctTerr = (n) => Math.max(1, Math.round((100 * n) / Math.max(1, ctx.territorio)));
    let cajas = `<div class="rg-caja"><b class="grande">${fmt.format(cuenta[0] + cuenta[1])}</b>zonas de riesgo <b>alto o muy alto</b> (cuadros de ~11 km) · solo el ${pctTerr(cuenta[0] + cuenta[1])} % del territorio</div>`;
    const top = altos.slice(0, 3).map((x) => (x.lugar || "").replace("provincia de ", "")).filter(Boolean);
    if (top.length) cajas += `<div class="rg-caja"><b class="grande" style="font-size:16px">${[...new Set(top)].join(" · ")}</b>donde más hay que vigilar</div>`;
    if (ctx.seca) {
      const pct = Math.round((ctx.seca.razon - 1) * 100);
      const cifra = ctx.seca.dudoso ? "⚠️ dudoso" : ctx.seca.razon >= 1.5 ? `${ctx.seca.razon.toFixed(1).replace(".", ",")}×` : `${pct > 0 ? "+" : ""}${pct} %`;
      cajas += `<div class="rg-caja"><b class="grande">${cifra}</b>🌧️ Lluvia: ${textoLluvia(ctx.seca)}.</div>`;
    }
    if (ctx.comprobable && reales) {
      // ¿cayeron los incendios reales en zonas de riesgo alto?
      const celdasReales = new Map();
      reales.forEach((p) => { const k = Math.floor(p.lat / RG) + "," + Math.floor(p.lon / RG); celdasReales.set(k, (celdasReales.get(k) || 0) + 1); });
      const altosSet = new Set(altos.map((x) => `${x.i},${x.j}`)), predSet = new Set(lista.filter((x) => x.nivel !== NIVELES[3]).map((x) => `${x.i},${x.j}`));
      let enAlto = 0, enMedio = 0, tot = 0;
      celdasReales.forEach((n, k) => { tot += n; if (altosSet.has(k)) enAlto += n; else if (predSet.has(k)) enMedio += n; });
      const pctAlto = tot ? Math.round((100 * enAlto) / tot) : 0, pctMedio = tot ? Math.round((100 * (enAlto + enMedio)) / tot) : 0;
      cajas += `<div class="rg-caja" style="border-color:#7ee07e"><b class="grande">${pctAlto} %</b>✅ <b>Comprobación:</b> de los ${fmt.format(tot)} focos que ocurrieron de verdad, <b>${pctAlto} %</b> cayeron en zonas de riesgo alto/muy alto, que son solo el <b>${pctTerr(cuenta[0] + cuenta[1])} %</b> del territorio (al azar se esperaría ese mismo ${pctTerr(cuenta[0] + cuenta[1])} %). ${pctMedio} % cayeron en zonas de riesgo medio o más (${pctTerr(cuenta[0] + cuenta[1] + cuenta[2])} % del territorio).${pctAlto >= 2 * pctTerr(cuenta[0] + cuenta[1]) ? ` El mapa acierta <b>${(pctAlto / pctTerr(cuenta[0] + cuenta[1])).toFixed(1)} veces</b> más que el azar.` : ""}</div>`;
    } else {
      cajas += `<div class="rg-caja">🔮 Predicción para fechas que aún no pasan: no se puede comprobar todavía. Prueba una fecha del año pasado para ver si acierta.</div>`;
    }
    $("rg-resumen").innerHTML = cajas;
    $("rg-tabla").innerHTML = lista.length
      ? "<thead><tr><th>Riesgo</th><th>Lugar</th><th>Años con fuego en estas fechas</th><th>Focos recientes cerca</th>" + (ctx.comprobable ? "<th>¿Hubo fuego después?</th>" : "") + "</tr></thead><tbody>" +
        lista.slice(0, 20).map((x, n) => `<tr data-n="${n}" tabindex="0"><td><span class="rg-nivel" style="background:${x.nivel.color}">${x.nivel.nombre}</span> ${Math.round(x.r * 100)} %</td><td>${x.lugar || "—"}</td><td>${x.anios} de ${ctx.N}</td><td>${x.cerca || "—"}</td>` +
          (ctx.comprobable ? `<td>${x.real ? "✅ sí (" + x.real + ")" : "—"}</td>` : "") + "</tr>").join("") + "</tbody>"
      : "";
    $("rg-tabla").querySelectorAll("tr[data-n]").forEach((tr) => tr.addEventListener("click", () => {
      const x = lista[+tr.dataset.n];
      mapa.setView([x.lat, x.lon], Math.max(mapa.getZoom(), 9));
      L.popup({ maxWidth: 300, className: "popup-compacto" }).setLatLng([x.lat, x.lon]).setContent(popupRiesgo(x, ctx)).openOn(mapa);
      $("mapa").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }

  // ---------- Pestañas y panel plegable ----------
  let pestanaActual = "incendios";
  function mostrarPestana(nombre) {
    pestanaActual = nombre;
    document.querySelectorAll("[data-pestana]").forEach((el) => {
      el.classList.toggle("oculta-pestana", !el.dataset.pestana.split(" ").includes(nombre));
    });
    document.querySelectorAll(".pestanas [data-ir]").forEach((b) => {
      const on = b.dataset.ir === nombre;
      b.classList.toggle("activo", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    setTimeout(() => Object.values(graficos).forEach((g) => g.resize()), 30);
    if (nombre === "metodo") dibujarExplicacion(pasoExp);
    // En la pestaña Riesgo se ven los cuadros de riesgo; en las demás, los puntos de incendios
    if (mapa && capaVivo) {
      if (nombre === "riesgo") {
        if (mapa.hasLayer(capaVivo)) mapa.removeLayer(capaVivo);
        if (capaRiesgo && !mapa.hasLayer(capaRiesgo)) capaRiesgo.addTo(mapa);
        if (leyendaRiesgo && !leyendaRiesgo._map) leyendaRiesgo.addTo(mapa);
        if (mapa._leyendaVivo && mapa._leyendaVivo._map) mapa.removeControl(mapa._leyendaVivo);
        $("rg-area").textContent = estado.area ? estado.area.nombre : "";
      } else {
        if (capaRiesgo && mapa.hasLayer(capaRiesgo)) mapa.removeLayer(capaRiesgo);
        if (leyendaRiesgo && leyendaRiesgo._map) mapa.removeControl(leyendaRiesgo);
        if (!mapa.hasLayer(capaVivo)) capaVivo.addTo(mapa);
        if (mapa._leyendaVivo && !mapa._leyendaVivo._map) mapa._leyendaVivo.addTo(mapa);
      }
    }
  }
  function alternarPanel(forzar) {
    const main = document.getElementById("explorar");
    const oculto = forzar !== undefined ? forzar : !main.classList.contains("panel-oculto");
    main.classList.toggle("panel-oculto", oculto);
    $("btn-panel").setAttribute("aria-expanded", oculto ? "false" : "true");
    try { localStorage.setItem("firecal_panel_oculto", oculto ? "1" : ""); } catch (e) { /* nada */ }
    setTimeout(() => { mapa.invalidateSize(); Object.values(graficos).forEach((g) => g.resize()); }, 60);
  }

  // ---------- Eventos de controles ----------
  function conectarControles() {
    $("sel-anio").addEventListener("change", (e) => {
      const y = +e.target.value;
      if (estado.serie) { estado.anio = y; dibujarTodo(); cargarClima(); }
      $("f-anio").value = y; fechaCambiada(true);
    });
    $("sel-base").addEventListener("change", (e) => {
      estado.base = e.target.value.split("-").map(Number);
      calcular(); dibujarTodo();
    });
    $("sel-metrica").value = estado.metrica || "actividad";
    $("sel-metrica").addEventListener("change", (e) => { estado.metrica = e.target.value; dibujarCalendario(); });
    $("btn-csv").addEventListener("click", descargarCSV);
    $("map-key").value = leerClave();
    $("btn-buscar").addEventListener("click", () => { mostrarPestana("incendios"); buscarIncendios(); });
    document.querySelectorAll("[data-ir]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.preventDefault();
      mostrarPestana(el.dataset.ir);
      document.querySelector(".pestanas").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    // Cada sección del panel se puede encoger/expandir haciendo clic en su título (se recuerda en este navegador)
    let encogidas = {};
    try { encogidas = JSON.parse(localStorage.getItem("firecal_encogidas2") || "{}"); } catch (e) { /* nada */ }
    document.querySelectorAll("#panel > .tarjeta").forEach((t, n) => {
      const h = t.querySelector(":scope > h2");
      if (!h) return;
      h.classList.add("plegable"); h.tabIndex = 0; h.setAttribute("role", "button");
      const poner = (on) => { t.classList.toggle("encogida", on); h.setAttribute("aria-expanded", on ? "false" : "true"); h.title = on ? "Clic para mostrar" : "Clic para encoger"; };
      poner(n in encogidas ? !!encogidas[n] : n > 0); // por defecto: solo la primera sección abierta
      const alternar = () => {
        poner(!t.classList.contains("encogida"));
        encogidas[n] = t.classList.contains("encogida");
        try { localStorage.setItem("firecal_encogidas2", JSON.stringify(encogidas)); } catch (e) { /* nada */ }
        setTimeout(() => mapa.invalidateSize(), 60);
      };
      h.addEventListener("click", alternar);
      h.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(); } });
    });
    $("btn-panel").addEventListener("click", () => alternarPanel(true));
    $("btn-mostrar-panel").addEventListener("click", () => alternarPanel(false));
    let panelOculto = false;
    try { panelOculto = localStorage.getItem("firecal_panel_oculto") === "1"; } catch (e) { /* nada */ }
    if (window.innerWidth < 1000 && panelOculto === false) panelOculto = false;
    alternarPanel(panelOculto);
    mostrarPestana("incendios");
    $("btn-animar").addEventListener("click", animarIncendios);
    $("btn-riesgo").addEventListener("click", calcularRiesgo);
    $("rg-fecha").value = AYER_ISO; $("rg-fecha").max = AYER_ISO;
    $("btn-rg-hoy").addEventListener("click", () => { $("rg-fecha").value = ultimoConocido || AYER_ISO; calcularRiesgo(); });
    $("btn-csv-incendios").addEventListener("click", descargarIncendiosCSV);
    document.querySelectorAll(".pasos [data-paso]").forEach((b) => b.addEventListener("click", () => { detenerExplicacion(); dibujarExplicacion(+b.dataset.paso); }));
    $("btn-reproducir").addEventListener("click", reproducirExplicacion);
    try { if (localStorage.getItem("firecal_guia_oculta")) $("guia").hidden = true; } catch (e) { /* nada */ }
    $("btn-cerrar-guia").addEventListener("click", () => { $("guia").hidden = true; try { localStorage.setItem("firecal_guia_oculta", "1"); } catch (e) { /* nada */ } });
    $("btn-cancelar").addEventListener("click", () => { consultaId++; progreso(null); $("vivo-estado").textContent = "Consulta cancelada."; });
    $("btn-hist").addEventListener("click", consultarHistorial);
    const yAct = +AYER_ISO.slice(0, 4);
    $("f-anio").innerHTML = Array.from({ length: yAct - 2000 }, (_, i) => yAct - i)
      .map((y) => `<option value="${y}">${y}${y === 2024 ? " ★" : ""}</option>`).join("");
    $("f-anio").value = yAct; $("f-mes").value = String(+AYER_ISO.slice(5, 7)); llenarDias();
    $("f-anio").addEventListener("change", () => {
      const y = +$("f-anio").value;
      if (estado.serie && [...$("sel-anio").options].some((o) => +o.value === y)) { estado.anio = y; $("sel-anio").value = y; dibujarTodo(); cargarClima(); }
      fechaCambiada(true);
    });
    $("f-mes").addEventListener("change", () => { $("f-dia").value = ""; fechaCambiada(true); });
    $("f-dia").addEventListener("change", () => fechaCambiada(true));
    $("btn-ultimo-mes").addEventListener("click", () => { modoUltimoMes = true; actualizarEstimacion(); buscarIncendios(); });
    $("map-key").addEventListener("change", () => { if (claveActual()) { guardarClave(claveActual()); consultarVivo(); } });
    $("btn-copiar").addEventListener("click", () => {
      navigator.clipboard && navigator.clipboard.writeText($("aviso-comando").textContent);
      $("btn-copiar").textContent = "¡Copiado!";
      setTimeout(() => ($("btn-copiar").textContent = "Copiar"), 1500);
    });
  }

  // ---------- Inicio ----------
  async function iniciar() {
    iniciarMapa();
    conectarControles();
    prepararRegiones();
    const geo = await cargarPaises();
    if (geo) prepararPaises(geo);
    const huanuco = regionesEnfoque.find((f) => f.properties.clave === "HCO");
    if (huanuco) { seleccionarRegion(huanuco); return; }
    if (geo) {
      const peru = paisesPorNombre.get("per");
      if (peru) { seleccionarPais(peru.f, peru.capa); return; }
    }
    // Sin internet para los países: usar un rectángulo del Perú
    const b = L.latLngBounds([-18.4, -81.4], [-0.03, -68.6]);
    seleccionarArea({
      clave: "PER", nombre: "Perú", bbox: [-81.4, -18.4, -68.6, -0.03], lat: -9.2, lon: -74.4,
      comando: "python scripts/descargar_datos.py --pais PER", geo: L.rectangle(b),
    });
  }
  iniciar();
})();
