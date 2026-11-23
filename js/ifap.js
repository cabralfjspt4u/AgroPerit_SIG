/* AGROPERIT Parcelário – pesquisa no serviço público do IFAP (partilhada pelas duas páginas) */
(function (root) {
  'use strict';
  const WFS = 'https://www.ifap.pt/isip/ows/isip.data/ows';
  const LAYER = 'isip.data:ocupacoes.solo.atual', PARC_LAYER = 'isip.data:parcelas.atual';
  const url = (filter, layer) => WFS + '?service=WFS&version=2.0.0&request=GetFeature&typeNames=' + encodeURIComponent(layer || LAYER) +
    '&outputFormat=application%2Fjson&srsName=EPSG:4326&CQL_FILTER=' + encodeURIComponent(filter);
  async function getJSON(u) {
    const c = new AbortController(), t0 = setTimeout(() => c.abort(), 90000);
    try {
      const r = await fetch(u, { signal: c.signal }), t = await r.text();
      try { return { gj: JSON.parse(t) }; } catch (e) { return { err: t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160) }; }
    } catch (e) { return { err: e.name === 'AbortError' ? 'o serviço demorou demasiado' : 'falha de ligação', retry: true }; }
    finally { clearTimeout(t0); }
  }
  async function get(u) { let r; for (let i = 0; i < 3; i++) { r = await getJSON(u); if (!r.retry) return r; await new Promise(z => setTimeout(z, 2000)); } return r; }
  /* devolve {ok: geojson} | {parcela: geojson} | {nao:true} | {err} */
  async function lookup(P, S) {
    let err = '';
    for (const f of ['NPARCELA=' + P + ' AND NOSA=' + S, 'NPARCELA=' + P + " AND NOSA='" + S + "'"]) {
      const r = await get(url(f)); if (r.err) { err = r.err; if (r.retry) break; continue; }
      if (r.gj.features && r.gj.features.length) return { ok: r.gj };
    }
    if (err) return { err };
    const r = await get(url('NPARCELA=' + P, PARC_LAYER));
    if (r.gj && r.gj.features && r.gj.features.length) return { parcela: r.gj };
    return r.err ? { err: r.err } : { nao: true };
  }
  const API = { lookup, url, get };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.IFAP = API;
})(typeof window !== 'undefined' ? window : globalThis);
