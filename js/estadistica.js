/*
 * FireCal — funciones estadísticas (sin dependencias).
 * Funciona en el navegador (window.FCStats) y en Node (module.exports) para pruebas.
 */
(function (global) {
  "use strict";

  const DIA_MS = 86400000;

  function parseFecha(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function isoFecha(date) {
    return date.toISOString().slice(0, 10);
  }
  function fechaDeIndice(inicioISO, i) {
    return new Date(parseFecha(inicioISO).getTime() + i * DIA_MS);
  }
  function indiceDeFecha(inicioISO, iso) {
    return Math.round((parseFecha(iso) - parseFecha(inicioISO)) / DIA_MS);
  }
  function diasEnMes(y, m) {
    return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  }
  // Día del año 1..365 (el 29 de febrero se junta con el 28)
  function diaDelAnio(date) {
    const y = date.getUTCFullYear();
    const inicio = Date.UTC(y, 0, 1);
    let doy = Math.floor((date.getTime() - inicio) / DIA_MS) + 1;
    const bisiesto = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (bisiesto && doy >= 60) doy -= 1;
    return doy;
  }

  function media(a) {
    const v = a.filter((x) => x != null && !Number.isNaN(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }
  function desviacion(a) {
    const v = a.filter((x) => x != null && !Number.isNaN(x));
    if (v.length < 2) return null;
    const m = media(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  }
  function percentil(a, p) {
    const v = a.filter((x) => x != null).slice().sort((x, y) => x - y);
    if (!v.length) return null;
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
  }

  /**
   * Suma diaria -> matriz mensual.
   * Devuelve { anios:[...], valores:[anio][mes], completo:[anio][mes] }
   * valores = null si el mes no tiene datos; completo=false si el mes está a medias.
   */
  function agregarMensual(diario, inicioISO) {
    const ini = parseFecha(inicioISO);
    const fin = fechaDeIndice(inicioISO, diario.length - 1);
    const y0 = ini.getUTCFullYear(), y1 = fin.getUTCFullYear();
    const anios = [], valores = [], completo = [];
    for (let y = y0; y <= y1; y++) {
      anios.push(y);
      valores.push(new Array(12).fill(null));
      completo.push(new Array(12).fill(false));
    }
    const cuenta = anios.map(() => new Array(12).fill(0));
    for (let i = 0; i < diario.length; i++) {
      const v = diario[i];
      if (v == null) continue;
      const d = fechaDeIndice(inicioISO, i);
      const yi = d.getUTCFullYear() - y0, m = d.getUTCMonth();
      valores[yi][m] = (valores[yi][m] || 0) + v;
      cuenta[yi][m]++;
    }
    for (let yi = 0; yi < anios.length; yi++)
      for (let m = 0; m < 12; m++)
        completo[yi][m] = cuenta[yi][m] === diasEnMes(anios[yi], m);
    return { anios, valores, completo };
  }

  /** Media y desviación por mes usando solo meses completos dentro de [anioIni, anioFin]. */
  function climatologiaMensual(mensual, anioIni, anioFin) {
    const medias = [], desv = [];
    for (let m = 0; m < 12; m++) {
      const vals = [];
      mensual.anios.forEach((y, yi) => {
        if (y >= anioIni && y <= anioFin && mensual.completo[yi][m]) vals.push(mensual.valores[yi][m]);
      });
      medias.push(media(vals));
      desv.push(desviacion(vals));
    }
    return { medias, desv };
  }

  /** Matriz de z-scores (null si no hay datos o la desviación es 0). */
  function anomaliasMensuales(mensual, clim) {
    return mensual.valores.map((fila) =>
      fila.map((v, m) => {
        if (v == null || clim.medias[m] == null || !clim.desv[m]) return null;
        return (v - clim.medias[m]) / clim.desv[m];
      })
    );
  }

  /** Media móvil circular (para un ciclo anual de 365 valores). */
  function suavizarCircular(a, ventana) {
    const n = a.length, h = Math.floor(ventana / 2), out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -h; k <= h; k++) s += a[(i + k + n) % n];
      out[i] = s / (2 * h + 1);
    }
    return out;
  }

  /**
   * Climatología diaria (365 días) sobre años completos en [anioIni, anioFin].
   * Devuelve { media, p10, p90 } suavizados con ventana de 15 días.
   */
  function climatologiaDiaria(diario, inicioISO, anioIni, anioFin) {
    const porAnio = {}; // anio -> array(365)
    for (let i = 0; i < diario.length; i++) {
      const d = fechaDeIndice(inicioISO, i);
      const y = d.getUTCFullYear();
      if (y < anioIni || y > anioFin) continue;
      if (!porAnio[y]) porAnio[y] = new Array(365).fill(null);
      const doy = diaDelAnio(d) - 1;
      porAnio[y][doy] = (porAnio[y][doy] || 0) + (diario[i] || 0);
    }
    const anios = Object.keys(porAnio).filter((y) => porAnio[y].every((v) => v != null));
    const suav = anios.map((y) => suavizarCircular(porAnio[y], 15));
    const med = [], p10 = [], p90 = [];
    for (let d = 0; d < 365; d++) {
      const col = suav.map((s) => s[d]);
      med.push(media(col));
      p10.push(percentil(col, 0.1));
      p90.push(percentil(col, 0.9));
    }
    return { media: med, p10, p90, aniosUsados: anios.length };
  }

  /**
   * Temporada crítica: ventana que concentra del 10 % al 90 % de la actividad
   * anual promedio, empezando a contar desde el día más tranquilo del año.
   */
  function temporadaCritica(climMedia) {
    const n = climMedia.length;
    const total = climMedia.reduce((s, x) => s + x, 0);
    if (!total) return null;
    let minIdx = 0, picoIdx = 0;
    for (let i = 0; i < n; i++) {
      if (climMedia[i] < climMedia[minIdx]) minIdx = i;
      if (climMedia[i] > climMedia[picoIdx]) picoIdx = i;
    }
    let acum = 0, ini = null, fin = null;
    for (let k = 0; k < n; k++) {
      const i = (minIdx + k) % n;
      acum += climMedia[i];
      if (ini === null && acum >= 0.1 * total) ini = i;
      if (fin === null && acum >= 0.9 * total) { fin = i; break; }
    }
    return { inicioDoy: ini + 1, finDoy: fin + 1, picoDoy: picoIdx + 1 };
  }

  function doyATexto(doy) {
    const en = window.FC_LANG === "en";
    const meses = en ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] : ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const d = new Date(Date.UTC(2001, 0, doy)); // 2001 no es bisiesto
    return en ? meses[d.getUTCMonth()] + " " + d.getUTCDate() : d.getUTCDate() + " " + meses[d.getUTCMonth()];
  }

  // Función de error (Abramowitz-Stegun 7.1.26)
  function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  /**
   * Prueba de Mann-Kendall + pendiente de Sen.
   * Devuelve { z, p, pendiente, pendientePct, n } (p de dos colas).
   */
  function mannKendall(serie) {
    const v = serie.filter((x) => x != null);
    const n = v.length;
    if (n < 4) return null;
    let S = 0;
    const pendientes = [];
    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        S += Math.sign(v[j] - v[i]);
        pendientes.push((v[j] - v[i]) / (j - i));
      }
    // corrección por empates
    const cuentas = {};
    v.forEach((x) => (cuentas[x] = (cuentas[x] || 0) + 1));
    let emp = 0;
    Object.values(cuentas).forEach((t) => { if (t > 1) emp += t * (t - 1) * (2 * t + 5); });
    const varS = (n * (n - 1) * (2 * n + 5) - emp) / 18;
    const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
    const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
    pendientes.sort((a, b) => a - b);
    const pendiente = percentil(pendientes, 0.5);
    const m = media(v);
    return { z, p, pendiente, pendientePct: m ? (100 * pendiente) / m : null, n };
  }

  /**
   * Estado de los últimos N días comparado con los mismos días en años anteriores.
   */
  function estadoReciente(diario, inicioISO, nDias) {
    const fin = diario.length - 1;
    const fFin = fechaDeIndice(inicioISO, fin);
    const yFin = fFin.getUTCFullYear();
    const suma = (desde, hasta) => {
      let s = 0;
      for (let i = Math.max(0, desde); i <= hasta; i++) s += diario[i] || 0;
      return s;
    };
    const actual = suma(fin - nDias + 1, fin);
    const previos = [];
    for (let y = yFin - 1; ; y--) {
      const f = new Date(Date.UTC(y, fFin.getUTCMonth(), Math.min(fFin.getUTCDate(), diasEnMes(y, fFin.getUTCMonth()))));
      const idx = Math.round((f - parseFecha(inicioISO)) / DIA_MS);
      if (idx - nDias + 1 < 0) break;
      previos.push(suma(idx - nDias + 1, idx));
    }
    const m = media(previos);
    const mayores = previos.filter((x) => x < actual).length;
    return {
      actual,
      promedio: m,
      razon: m ? actual / m : null,
      percentil: previos.length ? (100 * mayores) / previos.length : null,
      fechaFin: isoFecha(fFin),
      aniosComparados: previos.length,
    };
  }

  const api = {
    parseFecha, isoFecha, fechaDeIndice, indiceDeFecha, diaDelAnio, diasEnMes,
    media, desviacion, percentil, agregarMensual, climatologiaMensual,
    anomaliasMensuales, suavizarCircular, climatologiaDiaria, temporadaCritica,
    doyATexto, mannKendall, estadoReciente,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.FCStats = api;
})(typeof window !== "undefined" ? window : this);
