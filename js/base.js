/* AGROPERIT Parcelário – página da base de dados */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = (n, d) => n == null || isNaN(n) ? '' : Number(n).toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d });

  /* ---------- tema ---------- */
  const root = document.documentElement;
  function setTheme(t) { root.setAttribute('data-theme', t); try { localStorage.setItem('agroperit-tema', t); } catch (e) {} }
  let saved = null; try { saved = localStorage.getItem('agroperit-tema'); } catch (e) {}
  setTheme(saved || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('theme').onclick = () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  /* ---------- mapa (sempre a norte; só se move quando o utilizador pede) ---------- */
  const map = L.map('map').setView([39.6, -8], 7);
  const google = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: 'Imagem © Google' }).addTo(map);
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagem © Esri' });
  L.control.layers({ 'Google Satélite': google, 'Esri Satélite': esri }).addTo(map);
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($('map'));
  setTimeout(() => map.invalidateSize(), 400);
  const group = L.featureGroup().addTo(map), ptGroup = L.featureGroup().addTo(map);
  $('showPts').onchange = e => { e.target.checked ? map.addLayer(ptGroup) : map.removeLayer(ptGroup); };

  let ALL = [], FIL = [], tab = 'sub', sortKey = 'tomador', sortDir = 1;
  const drawn = new Map();            // subparcela_id -> {layer, marker}
  const conn = () => Store.conn;

  /* ---------- colunas da tabela de subparcelas ---------- */
  const COLS = [
    { k: 'tomador', t: 'Tomador' }, { k: 'apolice', t: 'Apólice', f: r => r.apolice + ' / ' + r.adesao_n },
    { k: 'parcela', t: 'Parcela / Sub.', f: r => r.parcela + ' / ' + (r.sub_ref || r.nosa) }, { k: 'concelho', t: 'Concelho' }, { k: 'cultura', t: 'Cultura' },
    { k: 'ha', t: 'Ha', n: 1, f: r => nf(r.ha, 4) }, { k: 'prod_kg_ha', t: 'Prod. (kg/ha)', n: 1, f: r => nf(r.prod_kg_ha, 2) },
    { k: 'preco_eur_kg', t: 'Preço (€/kg)', n: 1, f: r => nf(r.preco_eur_kg, 3) }, { k: 'producao_kg', t: 'Produção (kg)', n: 1, f: r => nf(r.producao_kg, 0) },
    { k: 'capital_eur', t: 'Capital (€)', n: 1, f: r => nf(r.capital_eur, 2) }, { k: 'ifap_estado', t: 'Polígono', f: r => r.ifap_estado === 'subparcela' ? '✓' : r.ifap_estado === 'parcela_inteira' ? 'parcela' : r.ifap_estado ? '✗' : '' }
  ];

  /* ---------- carregar e filtrar ---------- */
  function fillSelect(id, values, label) {
    const el = $(id), cur = el.value;
    el.innerHTML = '<option value="">' + label + '</option>' + values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    if (values.includes(cur)) el.value = cur;
  }
  function reload() {
    ALL = DB.items(conn());
    const uniq = k => [...new Set(ALL.map(r => r[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt'));
    fillSelect('fCult', uniq('cultura'), '(todas as culturas)'); fillSelect('fConc', uniq('concelho'), '(todos os concelhos)'); fillSelect('fApol', uniq('apolice'), '(todas as apólices)');
    const c = DB.counts(conn()), i = Store.info;
    $('dbinfo').textContent = c.itens ? c.tomadores + ' tomador(es) · ' + c.adesoes + ' adesão(ões) · ' + c.subparcelas + ' subparcela(s) · ' + c.com_poligono + ' com polígono'
      + (i.raw ? ' · base: ' + nf(i.raw / 1024, 1) + ' KB (compactada: ' + nf(i.gz / 1024, 1) + ' KB)' : '') : 'A base está vazia. Comece por importar um Excel.';
    applyFilters(); renderArquivo();
  }
  function applyFilters() {
    const q = DB.norm($('fTom').value), c = $('fCult').value, co = $('fConc').value, ap = $('fApol').value;
    FIL = ALL.filter(r => (!q || DB.norm(r.tomador).includes(q) || String(r.nif).includes(q)) && (!c || r.cultura === c) && (!co || r.concelho === co) && (!ap || r.apolice === ap));
    const tot = DB.totals(FIL);
    $('tot').innerHTML = FIL.length + ' de ' + ALL.length + ' subparcelas · ' + nf(tot.ha, 4) + ' ha · capital ' + nf(tot.capital, 2) + ' €';
    const subs = new Set(FIL.map(r => r.subparcela_id)), sem = new Set(FIL.filter(r => !r.ifap_estado).map(r => r.subparcela_id)), com = new Set(FIL.filter(r => r.ifap_estado === 'subparcela' || r.ifap_estado === 'parcela_inteira').map(r => r.subparcela_id));
    $('ifapInfo').textContent = FIL.length ? com.size + ' de ' + subs.size + ' subparcelas filtradas já têm polígono · ' + sem.size + ' por obter.' : '';
    render();
  }
  ['fCult', 'fConc', 'fApol'].forEach(id => { $(id).onchange = applyFilters; });
  $('fTom').oninput = applyFilters;
  $('fClear').onclick = () => { $('fTom').value = ''; ['fCult', 'fConc', 'fApol'].forEach(id => { $(id).value = ''; }); applyFilters(); };

  /* ---------- tabelas ---------- */
  function setTab(t) { tab = t; $('tabSub').className = t === 'sub' ? 'on' : ''; $('tabCult').className = t === 'cult' ? 'on' : ''; $('tabTom').className = t === 'tom' ? 'on' : ''; render(); }
  $('tabSub').onclick = () => setTab('sub'); $('tabCult').onclick = () => setTab('cult'); $('tabTom').onclick = () => setTab('tom');
  function render() {
    if (!FIL.length) { $('tbl').innerHTML = '<div class="note">' + (ALL.length ? 'Nenhuma subparcela com estes filtros.' : 'Sem dados. Importe um Excel para começar.') + '</div>'; return; }
    if (tab === 'cult') {
      const ag = DB.aggregate(FIL, r => r.cultura || '(sem cultura)').sort((a, b) => b.capital - a.capital);
      $('tbl').innerHTML = '<table class="t"><tr><th>Cultura</th><th class="n">Subparcelas</th><th class="n">Ha</th><th class="n">Produtividade média (kg/ha)</th><th class="n">Preço médio (€/kg)</th><th class="n">Produção (kg)</th><th class="n">Capital (€)</th></tr>' +
        ag.map(a => '<tr data-k="' + esc(a.key) + '"><td>' + esc(a.label) + '</td><td class="n">' + a.n + '</td><td class="n">' + nf(a.ha, 4) + '</td><td class="n">' + nf(a.prod_kg_ha, 2) + '</td><td class="n">' + nf(a.preco_medio, 3) + '</td><td class="n">' + nf(a.prod_kg, 0) + '</td><td class="n">' + nf(a.capital, 2) + '</td></tr>').join('') +
        '</table><div class="note">Clique numa cultura para ver as respetivas subparcelas.</div>';
    } else if (tab === 'tom') {
      const ag = DB.aggregate(FIL, r => r.nif, r => r.tomador).sort((a, b) => a.label.localeCompare(b.label, 'pt'));
      $('tbl').innerHTML = '<table class="t"><tr><th>Tomador</th><th>NIF</th><th class="n">Subparcelas</th><th class="n">Ha</th><th class="n">Produção (kg)</th><th class="n">Capital (€)</th></tr>' +
        ag.map(a => '<tr data-k="' + esc(a.key) + '"><td>' + esc(a.label) + '</td><td>' + esc(a.key) + '</td><td class="n">' + a.n + '</td><td class="n">' + nf(a.ha, 4) + '</td><td class="n">' + nf(a.prod_kg, 0) + '</td><td class="n">' + nf(a.capital, 2) + '</td></tr>').join('') +
        '</table><div class="note">Clique num tomador para ver as respetivas subparcelas.</div>';
    } else {
      const rows = FIL.slice().sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'pt')) * sortDir; });
      const MAX = 500;
      $('tbl').innerHTML = '<table class="t"><tr>' + COLS.map(c => '<th data-sort="' + c.k + '" class="' + (c.n ? 'n' : '') + '">' + c.t + (sortKey === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + (canWrite() ? '<th></th>' : '') + '</tr>' +
        rows.slice(0, MAX).map(r => '<tr data-id="' + r.id + '">' + COLS.map(c => '<td class="' + (c.n ? 'n' : '') + '">' + esc(c.f ? c.f(r) : r[c.k]) + '</td>').join('') + (canWrite() ? '<td class="act"><button class="mini" type="button" data-act="arq" data-id="' + r.id + '">ocultar</button><button class="mini danger" type="button" data-act="del" data-id="' + r.id + '">apagar</button></td>' : '') + '</tr>').join('') +
        '</table>' + (rows.length > MAX ? '<div class="note">A mostrar ' + MAX + ' de ' + rows.length + ' linhas. Use os filtros para ver as restantes (o CSV leva todas).</div>' : '');
    }
  }
  $('tbl').onclick = e => {
    const t = e.target, ab = t.closest && t.closest('button[data-act]');
    if (ab) { const id = Number(ab.getAttribute('data-id')); if (ab.getAttribute('data-act') === 'arq') doArchive([id]); else doDelete([id]); return; }
    const th = t.closest && t.closest('th[data-sort]');
    if (th) { const k = th.getAttribute('data-sort'); if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } render(); return; }
    const tr = t.closest && t.closest('tr[data-k],tr[data-id]'); if (!tr) return;
    if (tr.getAttribute('data-k') != null) {
      const k = tr.getAttribute('data-k');
      if (tab === 'cult') $('fCult').value = k; else $('fTom').value = k;
      applyFilters(); setTab('sub'); return;
    }
    const r = ALL.find(x => String(x.id) === tr.getAttribute('data-id')); if (r) focusOnMap(r);
  };

  /* ---------- importar Excel ---------- */
  const IGN = [];
  $('imp').onclick = e => {
    const bt = e.target.closest && e.target.closest('button[data-ign]'); if (!bt) return;
    const g = IGN[Number(bt.getAttribute('data-ign'))]; if (!g) return;
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"', cols = ['Tomador', 'NIF', 'Apólice', 'Adesão', 'Parcela', 'Subparcela', 'Cultura', 'Ha', 'Capital (objeto)'];
    const linhas = [['Linha', 'Falta'].concat(cols).map(q).join(';')].concat(g.lista.map(x => [x.linha, x.falta].concat(cols.map(c => x.valores[c])).map(q).join(';')));
    download('linhas-ignoradas.csv', '\ufeff' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
  };
  function pickSheet(wb) {
    for (const n of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true, range: 0 }); if (rows.length && Object.keys(rows[0]).some(h => DB.norm(h) === 'APOLICE')) return rows; }
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
  }
  $('fileXls').addEventListener('change', async e => {
    const files = [...e.target.files]; if (!files.length || !canWrite()) return;
    $('imp').innerHTML = '';
    for (const f of files) {
      let html;
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        const rep = DB.importRows(conn(), pickSheet(wb), f.name, { preencherAcima: $('chkFill').checked });
        const ign = rep.linhasIgnoradas.length ? IGN.push({ nome: f.name, lista: rep.linhasIgnoradas }) - 1 : -1;
        html = '<div class="rep"><b>' + esc(f.name) + '</b>' + rep.linhas + ' linhas lidas: <b style="display:inline">' + rep.novos + ' novas</b>, ' + rep.atualizados + ' atualizadas, ' + rep.iguais + ' já existiam' + (rep.ignoradas ? ', <b style="display:inline;color:var(--err)">' + rep.ignoradas + ' ignoradas</b>' : '') + (rep.vazias ? ', ' + rep.vazias + ' linhas vazias saltadas' : '') + '.' +
          (rep.grupos.length ? '<div>' + esc(rep.grupos.join(' ')) + '</div>' : '') +
          (rep.semAdesao ? '<div>' + rep.semAdesao + ' linhas importadas sem nº de adesão (apólices individuais): ficam como “sem nº” + NIF.</div>' : '') +
          (rep.incompletas.length ? '<details><summary>' + rep.incompletas.length + ' linhas importadas com campos em falta</summary>' + rep.incompletas.slice(0, 30).map(m => '<div>' + esc(m) + '</div>').join('') + '</details>' : '') +
          (rep.arquivadas ? '<div>' + rep.arquivadas + ' linhas já estavam no arquivo-morto e ficaram como estão.</div>' : '') +
          (rep.completadas.length ? '<details><summary>' + rep.completadas.length + ' linhas completadas com a linha de cima</summary>' + rep.completadas.slice(0, 30).map(m => '<div>' + esc(m) + '</div>').join('') + '</details>' : '') +
          (ign >= 0 ? '<details open><summary>Ver as ' + rep.linhasIgnoradas.length + ' linhas ignoradas</summary><table class="at"><tr><td>Linha</td><td>Falta</td><td>Conteúdo da linha</td></tr>' + rep.linhasIgnoradas.slice(0, 40).map(x => '<tr><td>' + x.linha + '</td><td>' + esc(x.falta) + '</td><td>' + esc(Object.entries(x.valores).filter(([k, v]) => v !== '').map(([k, v]) => k + ': ' + v).join(' · ') || '(linha sem dados)') + '</td></tr>').join('') + '</table>' + (rep.linhasIgnoradas.length > 40 ? '<div>… e mais ' + (rep.linhasIgnoradas.length - 40) + ' (estão no CSV).</div>' : '') + '<button class="btn ghost" type="button" data-ign="' + ign + '">Descarregar linhas ignoradas (CSV)</button></details>' : '') +
          (rep.avisos.length ? '<ul>' + rep.avisos.slice(0, 8).map(a => '<li>' + esc(a) + '</li>').join('') + (rep.avisos.length > 8 ? '<li>… e mais ' + (rep.avisos.length - 8) + ' avisos.</li>' : '') + '</ul>' : '') +
          (rep.mudancas.length ? '<details><summary>Ver o que foi atualizado (' + rep.mudancas.length + ')</summary>' + rep.mudancas.slice(0, 40).map(m => '<div>' + esc(m) + '</div>').join('') + '</details>' : '') + '</div>';
      } catch (err) { html = '<div class="rep"><b>' + esc(f.name) + '</b><span style="color:var(--err)">Não foi possível importar: ' + esc(err.message) + '</span></div>'; }
      $('imp').insertAdjacentHTML('beforeend', html);
    }
    e.target.value = '';
    try { await Store.save(); } catch (err) { $('imp').insertAdjacentHTML('beforeend', '<div class="rep"><span style="color:var(--err)">' + esc(err.message) + '</span></div>'); }
    reload();
    await publish();
  });

  /* ---------- polígonos do IFAP (guardados uma vez na base) ---------- */
  $('btnIfap').onclick = async () => {
    if (!canWrite()) return;
    const retry = $('chkRetry').checked, seen = new Set(), todo = [];
    FIL.forEach(r => { if (seen.has(r.subparcela_id)) return; seen.add(r.subparcela_id); if (!r.ifap_estado || (retry && r.ifap_estado === 'nao_encontrada')) todo.push(r); });
    if (!todo.length) { $('ifapProg').textContent = 'Todas as subparcelas filtradas já foram consultadas no IFAP.'; return; }
    $('btnIfap').disabled = true; let feitas = 0, erros = 0; const queue = todo.slice();
    const upd = () => { $('ifapProg').textContent = 'IFAP: ' + feitas + ' de ' + todo.length + ' consultadas' + (erros ? ' · ' + erros + ' com falha (repita mais tarde)' : '') + '…'; };
    upd();
    const worker = async () => {
      while (queue.length) {
        const r = queue.shift(); let res;
        try { res = await IFAP.lookup(r.parcela, r.nosa); } catch (e) { res = { err: e.message }; }
        if (res.err) erros++; else DB.saveIfap(conn(), r.subparcela_id, DB.fromLookup(res));
        feitas++; upd();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    try { await Store.save(); } catch (e) {}
    $('btnIfap').disabled = false; $('ifapProg').textContent = 'Concluído: ' + (feitas - erros) + ' guardadas' + (erros ? ', ' + erros + ' com falha (clique outra vez para repetir)' : '') + '.';
    reload();
    await publish();
  };

  /* ---------- mapa ---------- */
  const colorOf = r => { const keys = [...new Set(ALL.map(x => x.cultura || ''))].sort(); return GEO.colorFor(Math.max(0, keys.indexOf(r.cultura || ''))); };
  function popupHtml(r, g) {
    const rows = [['Tomador', r.tomador], ['NIF', r.nif], ['Apólice / adesão', r.apolice + ' / ' + r.adesao_n], ['Parcela / sub.', r.parcela + ' / ' + (r.sub_ref || r.nosa)], ['Concelho', r.concelho], ['Cultura', r.cultura],
      ['Ha (seguro)', nf(r.ha, 4)], ['Produtividade (kg/ha)', nf(r.prod_kg_ha, 2)], ['Preço (€/kg)', nf(r.preco_eur_kg, 3)], ['Produção (kg)', nf(r.producao_kg, 0)], ['Capital (€)', nf(r.capital_eur, 2)],
      ['IFAP: classe', g.ifap_classe], ['IFAP: grau de cobertura', g.ifap_grau_cob], ['IFAP: abandono', g.ifap_abandono], ['IFAP: área (ha)', g.ifap_area_m2 ? nf(g.ifap_area_m2 / 10000, 4) : ''],
      ['IFAP: polígono', g.ifap_estado === 'parcela_inteira' ? 'parcela inteira (subparcela não encontrada)' : '']];
    return '<div class="pop"><b>' + esc(r.parcela + ' / ' + (r.sub_ref || r.nosa)) + '</b><table class="at">' + rows.filter(x => x[1] !== '' && x[1] != null).map(x => '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>').join('') + '</table></div>';
  }
  function drawItem(r) {
    if (drawn.has(r.subparcela_id)) return drawn.get(r.subparcela_id);
    const g = DB.geomOf(conn(), r.subparcela_id); if (!g) return null;
    const color = colorOf(r), feat = { type: 'Feature', properties: {}, geometry: g.geometry };
    const layer = L.geoJSON(feat, { style: { color, weight: 3, fillOpacity: .15 } }).bindPopup(popupHtml(r, g)); group.addLayer(layer);
    const pt = GEO.labelPoint([feat]); let marker = null;
    if (pt) { marker = L.circleMarker([pt[1], pt[0]], { radius: 6, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(r.parcela + ' / ' + (r.sub_ref || r.nosa)); marker.on('click', () => layer.openPopup(marker.getLatLng())); ptGroup.addLayer(marker); }
    const o = { layer, marker, feat, pt, color }; drawn.set(r.subparcela_id, o); return o;
  }
  function clearMap() { group.clearLayers(); ptGroup.clearLayers(); drawn.clear(); }
  $('btnMap').onclick = () => {
    clearMap(); const seen = new Set(); let n = 0;
    FIL.forEach(r => { if (seen.has(r.subparcela_id) || !r.ifap_estado || r.ifap_estado === 'nao_encontrada') return; seen.add(r.subparcela_id); if (drawItem(r)) n++; });
    $('ifapProg').textContent = n ? n + ' polígonos no mapa. Clique em “Centrar nos polígonos” para os ver.' : 'Ainda não há polígonos para mostrar: clique em “Obter polígonos do IFAP”.';
  };
  $('btnFit').onclick = () => { if (group.getLayers().length) map.fitBounds(group.getBounds().pad(.2)); };
  function focusOnMap(r) {
    const o = drawItem(r); if (!o) { $('ifapProg').textContent = 'Esta subparcela ainda não tem polígono: use “Obter polígonos do IFAP”.'; return; }
    map.fitBounds(o.layer.getBounds().pad(.5)); o.layer.openPopup();
  }

  /* ---------- exportar ---------- */
  function download(name, data, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  const hoje = () => new Date().toISOString().slice(0, 10);
  $('btnKml').onclick = () => {
    const seen = new Set(), list = [];
    FIL.forEach(r => {
      if (seen.has(r.id) || r.ifap_estado === 'nao_encontrada' || !r.ifap_estado) return; seen.add(r.id);
      const g = DB.geomOf(conn(), r.subparcela_id); if (!g) return; const feat = { type: 'Feature', properties: {}, geometry: g.geometry };
      list.push({ name: r.parcela + '/' + (r.sub_ref || r.nosa), features: [feat], pt: GEO.labelPoint([feat]), color: colorOf(r), attrs: {
        Tomador: r.tomador, NIF: r.nif, Apolice: r.apolice, Adesao: r.adesao_n, Inicio: r.inicio, Parcela: r.parcela, Subparcela: r.nosa, Concelho: r.concelho, Cultura: r.cultura,
        Ha: r.ha, 'Produtividade_kg_ha': r.prod_kg_ha, 'Preco_eur_kg': r.preco_eur_kg, 'Producao_kg': r.producao_kg == null ? '' : r.producao_kg.toFixed(0), 'Capital_eur': r.capital_eur == null ? '' : r.capital_eur.toFixed(2),
        IFAP_classe: g.ifap_classe, IFAP_grau_cob: g.ifap_grau_cob, IFAP_abandono: g.ifap_abandono, IFAP_area_ha: g.ifap_area_m2 ? (g.ifap_area_m2 / 10000).toFixed(4) : '',
        Poligono: g.ifap_estado === 'parcela_inteira' ? 'Parcela inteira (subparcela não encontrada)' : 'Subparcela' } });
    });
    if (!list.length) { $('ifapProg').textContent = 'Não há polígonos para exportar: use primeiro “Obter polígonos do IFAP”.'; return; }
    download('agroperit-parcelario.kml', GEO.buildKML(list, { points: $('optPts').checked, title: 'AGROPERIT Parcelário' }), 'application/vnd.google-earth.kml+xml');
  };
  $('btnCsv').onclick = () => {
    const cols = COLS.filter(c => c.k !== 'ifap_estado'), head = ['Tomador', 'NIF', 'Apólice', 'Adesão', 'Início', 'Parcela', 'Subparcela', 'Concelho', 'Cultura', 'Ha', 'Produtividade (kg/ha)', 'Preço (€/kg)', 'Produção (kg)', 'Capital (€)', 'Polígono IFAP'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"', n = (v, d) => v == null ? '' : Number(v).toFixed(d).replace('.', ',');
    const lines = [head.map(q).join(';')].concat(FIL.map(r => [q(r.tomador), q(r.nif), q(r.apolice), q(r.adesao_n), q(r.inicio), q(r.parcela), q(r.sub_ref || r.nosa), q(r.concelho), q(r.cultura), n(r.ha, 4), n(r.prod_kg_ha, 2), n(r.preco_eur_kg, 3), n(r.producao_kg, 0), n(r.capital_eur, 2), q(r.ifap_estado || '')].join(';')));
    void cols; download('agroperit-subparcelas.csv', '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  };

  /* ---------- cópia de segurança ---------- */
  $('btnSave').onclick = async () => download('agroperit-base-' + hoje() + '.sqlite.gz', await Store.fileBytes(true), 'application/gzip');
  $('btnSaveRaw').onclick = async () => download('agroperit-base-' + hoje() + '.sqlite', await Store.fileBytes(false), 'application/x-sqlite3');
  $('fileDb').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('Abrir esta cópia substitui a base que está agora neste navegador. Continuar?')) { e.target.value = ''; return; }
    try { await Store.openFile(f); clearMap(); reload(); $('imp').innerHTML = '<div class="rep"><b>' + esc(f.name) + '</b>Cópia aberta.</div>'; }
    catch (err) { $('imp').innerHTML = '<div class="rep"><span style="color:var(--err)">' + esc(err.message) + '</span></div>'; }
    e.target.value = '';
  });
  /* ---------- gerir dados: arquivar (ocultar), apagar de vez e apagar tudo (só administrador) ---------- */
  function resumoIds(ids) {
    const s = new Set(ids), l = ALL.filter(r => s.has(r.id)), t = DB.totals(l);
    return l.length + ' subparcela(s) de ' + new Set(l.map(r => r.nif)).size + ' tomador(es), ' + nf(t.ha, 2) + ' ha, capital ' + nf(t.capital, 2) + ' €';
  }
  async function depoisDeAlterar(msg) {
    clearMap(); try { await Store.save(); } catch (e) {}
    reload(); $('gerirMsg').textContent = msg; await publish();
  }
  async function doArchive(ids) {
    if (!canWrite()) return; if (!ids.length) { $('gerirMsg').textContent = 'Não há subparcelas mostradas para arquivar.'; return; }
    if (!confirm('Arquivar (ocultar) ' + resumoIds(ids) + '?\n\nDeixam de aparecer em tudo (tabelas, mapa, totais e exportações)' + (CLOUD ? ', para todos os utilizadores' : '') + '. Ficam guardadas no arquivo-morto e podem ser restauradas.')) return;
    const n = DB.archive(conn(), ids); await depoisDeAlterar(n + ' subparcela(s) arquivada(s). Já não aparecem.');
  }
  async function doDelete(ids) {
    if (!canWrite()) return; if (!ids.length) { $('gerirMsg').textContent = 'Não há subparcelas mostradas para apagar.'; return; }
    const r = prompt('Vai APAGAR DE VEZ ' + resumoIds(ids) + (CLOUD ? ', também na nuvem' : '') + '. Não dá para desfazer.\n\nPara confirmar escreva APAGAR:');
    if ((r || '').trim().toUpperCase() !== 'APAGAR') { $('gerirMsg').textContent = 'Cancelado: nada foi apagado.'; return; }
    const n = DB.deleteItems(conn(), ids); await depoisDeAlterar(n + ' subparcela(s) apagada(s) de vez.');
  }
  $('btnArq').onclick = () => doArchive(FIL.map(r => r.id));
  $('btnDel').onclick = () => doDelete(FIL.map(r => r.id));
  function renderArquivo() {
    if (!canWrite()) return;
    const arq = DB.archivedItems(conn()), ag = DB.aggregate(arq, r => r.nif, r => r.tomador).sort((a, b) => a.label.localeCompare(b.label, 'pt'));
    $('arqInfo').textContent = arq.length ? arq.length + ' subparcela(s) arquivada(s), de ' + ag.length + ' tomador(es). Não aparecem em mais nenhum sítio.' : 'O arquivo-morto está vazio.';
    $('arqList').innerHTML = ag.map(a => '<div class="item"><span><b>' + esc(a.label) + '</b>' + a.n + ' subparcela(s) · ' + nf(a.ha, 2) + ' ha</span><button class="mini" type="button" data-rest="' + esc(a.key) + '">Restaurar</button></div>').join('');
    $('btnRestAll').hidden = !arq.length; $('btnPurge').hidden = !arq.length;
  }
  $('arqList').onclick = async e => {
    const bt = e.target.closest && e.target.closest('button[data-rest]'); if (!bt || !canWrite()) return;
    const k = bt.getAttribute('data-rest'), ids = DB.archivedItems(conn()).filter(r => r.nif === k).map(r => r.id);
    DB.restore(conn(), ids); await depoisDeAlterar(ids.length + ' subparcela(s) restaurada(s).');
  };
  $('btnRestAll').onclick = async () => {
    if (!canWrite()) return; const ids = DB.archivedItems(conn()).map(r => r.id); if (!ids.length) return;
    if (!confirm('Restaurar as ' + ids.length + ' subparcelas do arquivo-morto? Voltam a aparecer' + (CLOUD ? ' para todos' : '') + '.')) return;
    DB.restore(conn(), ids); await depoisDeAlterar(ids.length + ' subparcela(s) restaurada(s).');
  };
  $('btnPurge').onclick = async () => {
    if (!canWrite()) return; const ids = DB.archivedItems(conn()).map(r => r.id); if (!ids.length) return;
    const r = prompt('Vai APAGAR DE VEZ as ' + ids.length + ' subparcelas do arquivo-morto' + (CLOUD ? ', também na nuvem' : '') + '. Não dá para desfazer.\n\nPara confirmar escreva APAGAR:');
    if ((r || '').trim().toUpperCase() !== 'APAGAR') return;
    DB.deleteItems(conn(), ids); await depoisDeAlterar('Arquivo apagado de vez.');
  };
  $('btnWipe').onclick = async () => {
    if (!canWrite()) return;
    const n = DB.counts(conn()).itens + DB.archivedItems(conn()).length;
    const r = prompt('Vai apagar TODOS os dados (' + n + ' subparcelas, incluindo o arquivo-morto e os polígonos)' + (CLOUD ? ', também na nuvem e para todos' : ' deste navegador') + '. Não dá para desfazer. Se precisar, guarde antes uma cópia.\n\nPara confirmar escreva APAGAR TUDO:');
    if ((r || '').trim().toUpperCase() !== 'APAGAR TUDO') { $('gerirMsg').textContent = 'Cancelado: nada foi apagado.'; return; }
    try { if (CLOUD) await Cloud.wipe(conn()); }
    catch (e) { $('gerirMsg').textContent = 'Não foi possível apagar na nuvem: ' + e.message + ' (nada foi apagado).'; return; }
    DB.clearAll(conn()); DB.clearTouched(conn()); clearMap(); $('imp').innerHTML = ''; try { await Store.save(); } catch (e) {}
    reload(); $('gerirMsg').textContent = 'Tudo apagado' + (CLOUD ? ' (também na nuvem)' : '') + '. Pode começar com uma base limpa.';
  };

  /* ---------- modo nuvem: login por convite, perfis e publicação ---------- */
  const CLOUD_LINK = /type=(invite|recovery)/.test(location.hash || '');
  let CLOUD = false, ROLE = 'admin', PUBLISHING = false;
  function canWrite() { return !CLOUD || ROLE === 'admin'; }
  function showMsg(t) { const m = $('lgMsg'); m.hidden = !t; m.textContent = t || ''; }
  function showLogin(mode) { $('login').hidden = false; $('loginForm').hidden = mode === 'pw'; $('pwForm').hidden = mode !== 'pw'; }
  function applyRole() {
    const adm = canWrite();
    $('secImport').hidden = !adm; $('btnIfap').hidden = !adm; $('lblRetry').hidden = !adm; $('secGerir').hidden = !adm;
    if (CLOUD) {
      $('secBackup').hidden = !adm; $('lblOpen').hidden = true; $('nuvem').hidden = false;
      $('txtBackup').textContent = 'A base está na nuvem (Supabase). Guarde cópias de vez em quando e não as coloque no GitHub: têm dados pessoais.';
    } else { $('secBackup').hidden = false; $('nuvem').hidden = true; }
  }
  async function loadFromCloud() {
    if (DB.pendingCount(conn()) && !confirm('Há alterações ainda não publicadas que se vão perder. Continuar?')) return;
    clearMap(); Store.reset(); $('nuvemMsg').textContent = '';
    try {
      await Cloud.pull(conn(), (t, n) => { $('dbinfo').textContent = 'A descarregar dados da nuvem… ' + t + ' (' + n + ')'; });
      $('nuvemMsg').textContent = 'Dados da nuvem carregados às ' + new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) + '.';
    } catch (e) { $('nuvemMsg').textContent = 'Não foi possível descarregar: ' + e.message; }
    reload();
  }
  async function enterApp() {
    try {
      ROLE = await Cloud.role();
      if (!ROLE) { await Cloud.signOut(); showLogin('login'); showMsg('Esta conta não tem acesso. Peça um convite ao administrador.'); return; }
      $('login').hidden = true; showMsg(''); applyRole();
      const s = await Cloud.session();
      $('nuvemTxt').textContent = ((s && s.user && s.user.email) || '') + ' · ' + (ROLE === 'admin' ? 'administrador (pode carregar dados)' : 'consulta');
      await loadFromCloud();
    } catch (e) { showLogin('login'); showMsg('Não foi possível entrar: ' + e.message); }
  }
  async function publish() {
    if (!CLOUD || ROLE !== 'admin' || PUBLISHING) return;
    const n = DB.pendingCount(conn()); if (!n) return;
    PUBLISHING = true; $('btnRetryPub').hidden = true; $('nuvemMsg').textContent = 'A publicar ' + n + ' alterações na nuvem…';
    try { await Cloud.push(conn(), (t, e) => { $('nuvemMsg').textContent = 'A publicar… ' + e + ' de ' + n; }); $('nuvemMsg').textContent = 'Publicado na nuvem. Os outros veem os dados novos quando entrarem ou clicarem em “Atualizar da nuvem”.'; }
    catch (e) { $('nuvemMsg').textContent = 'Não foi possível publicar: ' + e.message; $('btnRetryPub').hidden = false; }
    PUBLISHING = false;
  }
  $('btnRetryPub').onclick = publish;
  $('btnSync').onclick = loadFromCloud;
  $('btnOut').onclick = async () => { await Cloud.signOut(); location.reload(); };
  function motivoLogin(e) {
    const m = String((e && e.message) || '').toLowerCase();
    if (m.includes('invalid login credentials')) return 'Email ou palavra-passe incorretos. Confirme que não há espaços e que a conta foi criada no Supabase com “Create new user” e “Auto Confirm User” marcado (contas só “convidadas” não têm palavra-passe).';
    if (m.includes('email not confirmed')) return 'A conta ainda não está confirmada. No Supabase, em Authentication → Users, apague este utilizador e crie-o de novo com “Auto Confirm User” marcado.';
    if (m.includes('invalid api key') || m.includes('apikey')) return 'A chave do Supabase no ficheiro js/config.js não está correta (use a chave “anon / public” do mesmo projeto).';
    if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) return 'Não consegui ligar ao Supabase. Verifique a internet e o endereço (URL) em js/config.js. O projeto também pode estar em pausa.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Demasiadas tentativas seguidas. Espere alguns minutos e tente de novo.';
    return 'Não foi possível entrar: ' + ((e && e.message) || 'erro desconhecido');
  }
  function motivoReset(e) {
    const m = String((e && e.message) || '').toLowerCase();
    if (m.includes('not authorized') || m.includes('not_authorized')) return 'O serviço de email gratuito do Supabase só envia para membros da organização. Peça ao administrador para repor a sua palavra-passe.';
    if (m.includes('rate limit') || m.includes('too many') || m.includes('seconds')) return 'Foi atingido o limite de emails do Supabase. Tente daqui a uma hora ou peça ao administrador para repor a sua palavra-passe.';
    return 'Não foi possível enviar o email: ' + ((e && e.message) || 'erro desconhecido') + '. Peça ao administrador para repor a sua palavra-passe.';
  }
  $('lgGo').onclick = async () => {
    const email = $('lgEmail').value.trim(), pass = $('lgPass').value; if (!email || !pass) { showMsg('Escreva o email e a palavra-passe.'); return; }
    showMsg('A entrar…');
    try { await Cloud.signIn(email, pass); } catch (e) { showMsg(motivoLogin(e)); return; }
    $('lgPass').value = ''; await enterApp();
  };
  $('lgPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('lgGo').onclick(); });
  $('lgForgot').onclick = async e => {
    if (e && e.preventDefault) e.preventDefault();
    const email = $('lgEmail').value.trim(); if (!email) { showMsg('Escreva primeiro o seu email e clique outra vez.'); return; }
    showMsg('A enviar o pedido…');
    try { await Cloud.resetPassword(email); }
    catch (err) { showMsg(motivoReset(err)); return; }
    showMsg('Pedido enviado. Se este email fizer parte da equipa, deve receber uma mensagem em poucos minutos (veja também o spam). Se não chegar, peça ao administrador para repor a palavra-passe.');
  };
  $('pwGo').onclick = async () => {
    const p = $('pwNew').value; if (p.length < 8) { showMsg('A palavra-passe tem de ter pelo menos 8 caracteres.'); return; }
    if (p !== $('pwNew2').value) { showMsg('As duas palavras-passe não são iguais.'); return; }
    try { await Cloud.setPassword(p); history.replaceState(null, '', location.pathname); await enterApp(); } catch (e) { showMsg('Não foi possível guardar: ' + e.message); }
  };

  /* ---------- arranque ---------- */
  (async () => {
    try {
      const cfg = window.AGROPERIT_CONFIG || {};
      if (cfg.supabaseUrl && cfg.supabaseKey) {
        if (!Cloud.init(cfg)) throw new Error('Não consegui carregar o serviço de login (precisa de internet).');
        CLOUD = true; ROLE = null; await Store.initMemory(); applyRole();
        const s = await Cloud.session();
        if (s && CLOUD_LINK) { showLogin('pw'); showMsg('Bem-vindo! Defina a sua palavra-passe para continuar.'); }
        else if (s) await enterApp(); else showLogin('login');
      } else { await Store.init(); applyRole(); reload(); }
    } catch (e) { $('fatal').hidden = false; $('fatal').textContent = e.message; }
  })();
})();
