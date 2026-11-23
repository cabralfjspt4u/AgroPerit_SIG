/* AGROPERIT Parcelário – lógica da página */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* ---------- tema claro / escuro (logótipo muda com o fundo) ---------- */
  const root = document.documentElement;
  function setTheme(t) { root.setAttribute('data-theme', t); try { localStorage.setItem('agroperit-tema', t); } catch (e) {} }
  let saved = null; try { saved = localStorage.getItem('agroperit-tema'); } catch (e) {}
  setTheme(saved || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('theme').onclick = () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  /* ---------- mapa (sempre orientado a norte, sem movimentos automáticos) ---------- */
  const map = L.map('map').setView([39.6, -8], 7);
  const google = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: 'Imagem © Google' }).addTo(map);
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagem © Esri' });
  L.control.layers({ 'Google Satélite': google, 'Esri Satélite': esri }).addTo(map);
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  setTimeout(() => map.invalidateSize(), 400);
  const group = L.featureGroup().addTo(map);
  const ptGroup = L.featureGroup().addTo(map);
  $('showPts').onchange = e => { e.target.checked ? map.addLayer(ptGroup) : map.removeLayer(ptGroup); };

  let wb = null, ITEMS = [], running = false;

  /* ---------- ler o Excel ---------- */
  $('file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('fname').textContent = f.name;
    try { wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true }); }
    catch (err) { $('fname').textContent = 'Não consegui abrir este ficheiro.'; return; }
    $('sheet').innerHTML = wb.SheetNames.map((n, i) => '<option value="' + i + '">' + esc(n) + '</option>').join('');
    $('cols').hidden = false; fillCols();
  });
  $('sheet').addEventListener('change', fillCols);
  const sheetRows = () => XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[$('sheet').value]], { defval: '', raw: true });
  function fillCols() {
    const rows = sheetRows(), heads = rows.length ? Object.keys(rows[0]) : [];
    const opt = heads.map(h => '<option value="' + esc(h) + '">' + esc(h) + '</option>').join('');
    $('cPar').innerHTML = opt;
    $('cSub').innerHTML = '<option value="">(não há: parcela e subparcela juntas, ex. 123/11)</option>' + opt;
    const find = k => heads.find(h => norm(h) === k);
    const comb = find('PARCELASUBPARCELA') || heads.find(h => /PARCELA/.test(norm(h)) && /SUB/.test(norm(h)));
    const par = find('PARCELA'), sub = find('SUBPARCELA');
    if (par && sub) { $('cPar').value = par; $('cSub').value = sub; }
    else if (comb) { $('cPar').value = comb; $('cSub').value = ''; }
    else if (par) { $('cPar').value = par; }
  }
  const cell = v => v instanceof Date ? v.toLocaleDateString('pt-PT') : v;
  const numStr = v => typeof v === 'number' ? String(Math.round(v)) : String(v).trim();

  $('go').onclick = () => {
    const rows = sheetRows(), cp = $('cPar').value, cs = $('cSub').value;
    ITEMS = []; group.clearLayers(); ptGroup.clearLayers(); $('list').innerHTML = ''; const seen = {};
    rows.forEach(r => {
      let p, s;
      if (cs) { p = numStr(r[cp]); s = numStr(r[cs]); }
      else { const t = String(r[cp]).split('/'); p = t[0].trim(); s = (t[1] || '').trim(); }
      if (!/^\d+$/.test(p) || !/^\d+$/.test(s)) return;
      const k = p + '/' + s; if (seen[k]) { seen[k].rows.push(r); return; }
      const it = { P: p, S: s, rows: [r], state: 'wait', idx: ITEMS.length }; seen[k] = it; ITEMS.push(it);
    });
    if (!ITEMS.length) { $('list').innerHTML = '<p style="color:var(--err)">Não encontrei números de parcela e subparcela válidos nessas colunas.</p>'; return; }
    ITEMS.forEach(mkEl); $('prog').hidden = false; summary(); run(ITEMS);
  };

  /* ---------- apresentação ---------- */
  const table = o => '<table class="at">' + Object.entries(o).filter(([k, v]) => v !== '' && v != null).map(([k, v]) => '<tr><td>' + esc(k) + '</td><td>' + esc(cell(v)) + '</td></tr>').join('') + '</table>';
  function mkEl(it) {
    const el = document.createElement('div'); el.className = 'item'; it.el = el;
    el.innerHTML = '<b>' + it.P + ' / ' + it.S + '</b><span class="st">Em fila…</span>'; $('list').appendChild(el);
    el.onclick = () => {
      if (it.layer) { map.fitBounds(it.layer.getBounds().pad(.5)); it.layer.openPopup(); }
      else if (it.state === 'err' || it.state === 'no') run([it]);
    };
  }
  function draw(it, gj, full) {
    const props = gj.features[0].properties || {}, color = GEO.colorFor(it.idx);
    const l = L.geoJSON(gj, { style: { color, weight: 3, fillOpacity: .15 } });
    l.bindPopup('<div class="pop"><b>Parcela ' + it.P + ' / Subparcela ' + it.S + '</b>' + (full ? '<br><small>(parcela inteira: a subparcela não foi encontrada)</small>' : '') +
      '<p style="margin:6px 0 2px"><small>IFAP (iSIP)</small></p>' + table(props) +
      '<p style="margin:6px 0 2px"><small>Tabela Excel' + (it.rows.length > 1 ? ' (1.ª de ' + it.rows.length + ' linhas)' : '') + '</small></p>' + table(it.rows[0]) + '</div>');
    group.addLayer(l); it.layer = l; it.gj = gj; it.full = !!full; it.color = color;
    // ponto interior (nunca o centroide): garantidamente dentro do polígono
    it.pt = GEO.labelPoint(gj.features);
    if (it.pt) {
      it.marker = L.circleMarker([it.pt[1], it.pt[0]], { radius: 6, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(it.P + ' / ' + it.S); it.marker.on('click', () => l.openPopup(it.marker.getLatLng()));
      ptGroup.addLayer(it.marker);
    }
  }
  function clearItem(it) {
    if (it.layer) { group.removeLayer(it.layer); it.layer = null; }
    if (it.marker) { ptGroup.removeLayer(it.marker); it.marker = null; }
    it.gj = null; it.pt = null;
  }
  async function one(it) {
    it.el.className = 'item run'; const t0 = Date.now();
    const id = setInterval(() => { it.el.querySelector('.st').textContent = 'A procurar… ' + Math.round((Date.now() - t0) / 1000) + ' s'; }, 500);
    clearItem(it);
    let r; try { r = await IFAP.lookup(it.P, it.S); } catch (e) { r = { err: e.message }; }
    clearInterval(id); const st = it.el.querySelector('.st');
    if (r.ok) { draw(it, r.ok, false); it.state = 'ok'; it.el.className = 'item ok'; st.textContent = 'Subparcela encontrada'; }
    else if (r.parcela) { draw(it, r.parcela, true); it.state = 'no'; it.el.className = 'item err'; st.textContent = 'A subparcela não existe na camada atual (mostra a parcela inteira)'; }
    else if (r.nao) { it.state = 'no'; it.el.className = 'item err'; st.textContent = 'Parcela não encontrada'; }
    else { it.state = 'err'; it.el.className = 'item err'; st.textContent = 'Falhou: ' + r.err + ' (clique para repetir)'; }
    summary();
  }
  async function run(list) {
    const queue = list.slice(); running = true; $('retry').hidden = true;
    const worker = async () => { while (queue.length) await one(queue.shift()); };
    await Promise.all([worker(), worker(), worker()]); running = false; summary();
  }
  function summary() {
    const n = ITEMS.length, c = s => ITEMS.filter(i => i.state === s).length;
    const ok = c('ok'), no = c('no'), er = c('err'), done = ok + no + er;
    $('bar').firstElementChild.style.width = (100 * done / n) + '%';
    $('sum').textContent = done + ' de ' + n + ' concluídas · ' + ok + ' encontradas' + (no ? ' · ' + no + ' sem subparcela' : '') + (er ? ' · ' + er + ' com erro' : '');
    const any = ITEMS.some(i => i.gj);
    $('retry').hidden = !(er && !running);
    $('fit').hidden = !any; $('kml').disabled = !any; $('dl').disabled = !any;
  }
  $('fit').onclick = () => { if (group.getLayers().length) map.fitBounds(group.getBounds().pad(.2)); };
  $('retry').onclick = () => run(ITEMS.filter(i => i.state === 'err'));

  /* ---------- exportar ---------- */
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function attrsOf(it) {
    const a = {};
    Object.entries(it.rows[0]).forEach(([k, v]) => { if (v !== '') a[k] = cell(v); });
    Object.entries(it.gj.features[0].properties || {}).forEach(([k, v]) => { a['IFAP_' + k] = v; });
    a.ESTADO = it.full ? 'Parcela inteira (subparcela não encontrada)' : 'Subparcela';
    return a;
  }
  $('kml').onclick = () => {
    const items = ITEMS.filter(i => i.gj).map(i => ({ name: i.P + '/' + i.S, features: i.gj.features, attrs: attrsOf(i), pt: i.pt, color: i.color }));
    download('agroperit-parcelario.kml', GEO.buildKML(items, { points: $('optPts').checked, title: 'AGROPERIT Parcelário' }), 'application/vnd.google-earth.kml+xml');
  };
  $('dl').onclick = () => {
    const feats = []; ITEMS.forEach(it => { if (!it.gj) return; const a = attrsOf(it);
      it.gj.features.forEach(f => feats.push({ type: 'Feature', geometry: f.geometry, properties: a })); });
    download('agroperit-parcelario.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }), 'application/json');
  };
})();
