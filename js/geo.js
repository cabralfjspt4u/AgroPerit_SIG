/* AGROPERIT Parcelário – funções geométricas e exportação KML (sem dependências) */
(function (root) {
  'use strict';

  /* ---------- ponto dentro do polígono (pólo de inacessibilidade) ----------
     Devolve o ponto interior mais afastado dos limites do polígono (buracos incluídos).
     Ao contrário do centroide, fica sempre dentro da parcela, mesmo em forma de U. */
  function ringArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }

  function segDistSq(px, py, a, b) {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) {
      const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = px - x; dy = py - y; return dx * dx + dy * dy;
  }

  function signedDist(x, y, rings) {
    let inside = false, min = Infinity;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        const d = segDistSq(x, y, a, b); if (d < min) min = d;
      }
    }
    return (inside ? 1 : -1) * Math.sqrt(min);
  }

  function makeCell(x, y, h, rings) { const d = signedDist(x, y, rings); return { x, y, h, d, max: d + h * Math.SQRT2 }; }

  function heapPush(a, c) { a.push(c); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].max >= a[i].max) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  function heapPop(a) {
    const top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l].max > a[m].max) m = l; if (r < a.length && a[r].max > a[m].max) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }

  function pole(rings, precision) {
    const outer = rings[0]; let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const w = maxX - minX, h = maxY - minY, size = Math.min(w, h);
    if (size === 0) return [minX, minY];
    // centroide só como ponto de partida da pesquisa
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) { const p = outer[i], q = outer[j], f = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; a += f * 3; }
    let best = a === 0 ? makeCell(outer[0][0], outer[0][1], 0, rings) : makeCell(cx / a, cy / a, 0, rings);
    const bb = makeCell(minX + w / 2, minY + h / 2, 0, rings); if (bb.d > best.d) best = bb;
    const heap = []; let hh = size / 2;
    for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) heapPush(heap, makeCell(x + hh, y + hh, hh, rings));
    while (heap.length) {
      const c = heapPop(heap);
      if (c.d > best.d) best = c;
      if (c.max - best.d <= precision) continue;
      hh = c.h / 2;
      heapPush(heap, makeCell(c.x - hh, c.y - hh, hh, rings)); heapPush(heap, makeCell(c.x + hh, c.y - hh, hh, rings));
      heapPush(heap, makeCell(c.x - hh, c.y + hh, hh, rings)); heapPush(heap, makeCell(c.x + hh, c.y + hh, hh, rings));
    }
    return [best.x, best.y];
  }

  /* polígonos (lista de anéis lon/lat) a partir de GeoJSON */
  function polygonsOf(features) {
    const out = [];
    for (const f of features || []) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'Polygon') out.push(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => out.push(p));
    }
    return out;
  }

  /* ponto [lon,lat] garantidamente dentro da (maior) parte da geometria */
  function labelPoint(features) {
    const polys = polygonsOf(features); if (!polys.length) return null;
    let best = null, bestArea = -1;
    const lat0 = polys[0][0].reduce((s, p) => s + p[1], 0) / polys[0][0].length, k = Math.cos(lat0 * Math.PI / 180);
    const scaled = polys.map(rings => rings.map(r => r.map(p => [p[0] * k, p[1]])));
    scaled.forEach(rings => {
      let area = Math.abs(ringArea(rings[0])); for (let i = 1; i < rings.length; i++) area -= Math.abs(ringArea(rings[i]));
      if (area > bestArea) { bestArea = area; best = rings; }
    });
    const xs = best[0].map(p => p[0]), ys = best[0].map(p => p[1]);
    const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const p = pole(best, Math.max(ext / 1000, 1e-9));
    return [p[0] / k, p[1]];
  }

  /* ---------- cores ---------- */
  function hslToHex(h, s, l) {
    s /= 100; l /= 100; const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); return Math.round(255 * c).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  }
  function colorFor(i) { return hslToHex((i * 137) % 360, 95, 55); }

  /* ---------- KML ---------- */
  function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
  function kmlColor(hex, alpha) { const h = hex.replace('#', ''); return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); }  // aabbggrr
  function coords(ring) { return ring.map(p => p[0].toFixed(8) + ',' + p[1].toFixed(8) + ',0').join(' '); }
  function polyKml(rings) {
    let s = '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + coords(rings[0]) + '</coordinates></LinearRing></outerBoundaryIs>';
    for (let i = 1; i < rings.length; i++) s += '<innerBoundaryIs><LinearRing><coordinates>' + coords(rings[i]) + '</coordinates></LinearRing></innerBoundaryIs>';
    return s + '</Polygon>';
  }
  function extData(attrs) {
    const rows = Object.entries(attrs).filter(([k, v]) => v !== '' && v != null).map(([k, v]) => '<Data name="' + esc(k) + '"><value>' + esc(v) + '</value></Data>').join('');
    return '<ExtendedData>' + rows + '</ExtendedData>';
  }

  /* items: [{name, features, attrs, pt, color}]  opts: {points:boolean, title:string} */
  function buildKML(items, opts) {
    opts = opts || {};
    const withPts = opts.points !== false;
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n<name>' + esc(opts.title || 'AGROPERIT Parcelário') + '</name>\n';
    items.forEach((it, i) => {
      s += '<Style id="p' + i + '"><LineStyle><color>' + kmlColor(it.color, 'ff') + '</color><width>3</width></LineStyle><PolyStyle><color>' + kmlColor(it.color, '55') + '</color></PolyStyle></Style>\n';
      if (withPts) s += '<Style id="pt' + i + '"><IconStyle><color>' + kmlColor(it.color, 'ff') + '</color><scale>1</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>\n';
    });
    s += '<Folder><name>Polígonos</name>\n';
    items.forEach((it, i) => {
      const polys = polygonsOf(it.features); if (!polys.length) return;
      const geom = polys.length === 1 ? polyKml(polys[0]) : '<MultiGeometry>' + polys.map(polyKml).join('') + '</MultiGeometry>';
      s += '<Placemark><name>' + esc(it.name) + '</name><styleUrl>#p' + i + '</styleUrl>' + extData(it.attrs) + geom + '</Placemark>\n';
    });
    s += '</Folder>\n';
    if (withPts) {
      s += '<Folder><name>Pontos</name>\n';
      items.forEach((it, i) => {
        if (!it.pt) return;
        s += '<Placemark><name>' + esc(it.name) + '</name><styleUrl>#pt' + i + '</styleUrl>' + extData(it.attrs) +
          '<Point><coordinates>' + it.pt[0].toFixed(8) + ',' + it.pt[1].toFixed(8) + ',0</coordinates></Point></Placemark>\n';
      });
      s += '</Folder>\n';
    }
    return s + '</Document></kml>\n';
  }

  const API = { labelPoint, buildKML, colorFor, polygonsOf, signedDist };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.GEO = API;
})(typeof window !== 'undefined' ? window : globalThis);
