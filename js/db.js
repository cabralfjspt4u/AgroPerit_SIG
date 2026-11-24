/* AGROPERIT Parcelário – organização dos dados (SQLite), importação sem duplicados e consultas.
   Funciona com qualquer "ligação" que tenha: exec(sql), run(sql,params), all(sql,params), lastId(). */
(function (root) {
  'use strict';

  /* =================== ESTRUTURA DA BASE DE DADOS ===================
     Cada informação fica guardada UMA só vez:
       tomador      quem é (NIF, nome, NIFAP)
       adesao       contrato: apólice + nº de adesão (início, referências)
       parcela      nº da parcela IFAP e concelho
       subparcela   cada subparcela + o que vem do iSIP/IFAP (polígono, classe, área…)
       cultura      descrições de cultura (guardadas uma vez)
       item         o que está seguro: adesão + subparcela → cultura, ha, produtividade, preço
       risco/perfil/perfil_risco   franquias, PMI e agravamentos (conjuntos iguais guardados uma vez)
     NÃO se guarda o que se calcula: produção = ha × produtividade; capital = produção × preço
     (as consultas calculam isso na hora). */
  const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(chave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS tomador(nif TEXT PRIMARY KEY, nome TEXT NOT NULL, nifap TEXT);
CREATE TABLE IF NOT EXISTS adesao(
  id INTEGER PRIMARY KEY, apolice TEXT NOT NULL, adesao_n TEXT NOT NULL,
  tomador_nif TEXT NOT NULL REFERENCES tomador(nif),
  inicio TEXT, nif_tomador_apolice TEXT, ref_produtividade TEXT, ref_preco TEXT,
  UNIQUE(apolice, adesao_n));
CREATE TABLE IF NOT EXISTS parcela(parcela TEXT PRIMARY KEY, concelho_cod TEXT, concelho TEXT);
CREATE TABLE IF NOT EXISTS subparcela(
  id INTEGER PRIMARY KEY, parcela TEXT NOT NULL REFERENCES parcela(parcela), nosa INTEGER NOT NULL,
  ifap_estado TEXT, ifap_em TEXT, ifap_classe TEXT, ifap_grau_cob TEXT, ifap_abandono TEXT,
  ifap_data_revisao TEXT, ifap_area_m2 REAL, geom TEXT,
  UNIQUE(parcela, nosa));
CREATE TABLE IF NOT EXISTS cultura(id INTEGER PRIMARY KEY, descricao TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS risco(id INTEGER PRIMARY KEY, chave TEXT NOT NULL UNIQUE, nome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS perfil(id INTEGER PRIMARY KEY, chave TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS perfil_risco(
  perfil_id INTEGER NOT NULL REFERENCES perfil(id), risco_id INTEGER NOT NULL REFERENCES risco(id),
  agr, franquia TEXT, pmi REAL, PRIMARY KEY(perfil_id, risco_id));
CREATE TABLE IF NOT EXISTS item(
  id INTEGER PRIMARY KEY, adesao_id INTEGER NOT NULL REFERENCES adesao(id),
  subparcela_id INTEGER NOT NULL REFERENCES subparcela(id), cultura_id INTEGER REFERENCES cultura(id),
  ha REAL, prod_kg_ha REAL, preco_eur_kg REAL, idade_anos REAL, perfil_id INTEGER REFERENCES perfil(id),
  UNIQUE(adesao_id, subparcela_id));
CREATE TABLE IF NOT EXISTS importacao(
  id INTEGER PRIMARY KEY, ficheiro TEXT, em TEXT, linhas INTEGER, novos INTEGER, atualizados INTEGER, iguais INTEGER, avisos INTEGER);
CREATE VIEW IF NOT EXISTS v_item AS
SELECT i.id AS id, t.nif AS nif, t.nome AS tomador, a.apolice AS apolice, a.adesao_n AS adesao_n, a.inicio AS inicio,
       p.parcela AS parcela, s.nosa AS nosa, p.concelho_cod AS concelho_cod, p.concelho AS concelho,
       c.descricao AS cultura, i.ha AS ha, i.prod_kg_ha AS prod_kg_ha, i.preco_eur_kg AS preco_eur_kg, i.idade_anos AS idade_anos,
       i.ha * i.prod_kg_ha AS producao_kg, i.ha * i.prod_kg_ha * i.preco_eur_kg AS capital_eur,
       s.id AS subparcela_id, s.ifap_estado AS ifap_estado, s.ifap_area_m2 / 10000.0 AS ifap_ha, i.perfil_id AS perfil_id
FROM item i JOIN adesao a ON a.id = i.adesao_id JOIN tomador t ON t.nif = a.tomador_nif
JOIN subparcela s ON s.id = i.subparcela_id JOIN parcela p ON p.parcela = s.parcela
LEFT JOIN cultura c ON c.id = i.cultura_id;`;

  function ensureSchema(conn) { conn.exec(SCHEMA); conn.run("INSERT OR IGNORE INTO meta(chave,valor) VALUES('versao','1')", []); }
  function clearAll(conn) {
    conn.exec('DELETE FROM perfil_risco; DELETE FROM item; DELETE FROM perfil; DELETE FROM risco; DELETE FROM cultura; DELETE FROM subparcela; DELETE FROM parcela; DELETE FROM adesao; DELETE FROM tomador; DELETE FROM importacao;');
  }

  /* =================== LIMPEZA DOS VALORES DO EXCEL =================== */
  const norm = s => String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/[\s\u00a0€%]/g, ''); if (!s) return null;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s); return isFinite(n) ? n : null;
  }
  const txt = v => v == null ? null : (String(v).trim() || null);
  function idStr(v) { if (v == null || v === '') return null; if (typeof v === 'number') return String(Math.round(v)); return String(v).trim().replace(/\.0+$/, '') || null; }
  const p2 = n => String(n).padStart(2, '0');
  function isoDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) { if (isNaN(v)) return null; const d = new Date(v.getTime() + 12 * 3600 * 1000); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3] + '-' + p2(m[2]) + '-' + p2(m[1]);
    return s || null;
  }

  /* riscos: nomes diferentes (AGR / FRANQUIA / PMI) ficam juntos num só risco */
  const RISKS = [['Incêndio e Raio', ['INCENDIOCLIMATICORAIO']], ['Tornado'], ['Tromba de água'], ['Geada'], ['Queda de neve'], ['Granizo'], ['Chuva persistente'],
    ['Vingamento'], ['Javali', ['JAVALIECEREAIS']], ['Escaldão'], ['Escaldão pomóidas'], ['Raio'], ['Desavinho'], ['Incêndio'], ['Precipitação forte'], ['Ventos fortes'],
    ['Aluimento de terras'], ['Flamingo', ['FLAMINGOARROZ']], ['Extensão de prazo'], ['Incêndio não meteorológico', ['INCNAOMETEOROLOGICO']], ['Fendilhamento do fruto'],
    ['Geada no Algarve'], ['Geada na floração', ['GEADANAFLORAC']], ['Replante poda'], ['Seca (paramétrico)'], ['Desavinho paramétrico']];
  const RISK_ALIAS = new Map();
  RISKS.forEach(([nome, al]) => { const k = norm(nome); RISK_ALIAS.set(k, { chave: k, nome }); (al || []).forEach(a => RISK_ALIAS.set(a, { chave: k, nome })); });
  function canonRisk(raw) {
    const k = norm(raw); if (RISK_ALIAS.has(k)) return RISK_ALIAS.get(k);
    const nome = String(raw).trim().toLowerCase().replace(/^./, c => c.toUpperCase()); return { chave: k, nome };
  }

  /* =================== IMPORTAÇÃO (junta sem duplicar) =================== */
  const same = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-9 : a === b;
  function capitalCompativel(bruto, calc) {          // o Excel por vezes perde a vírgula (4549,0884 → 45490884)
    if (bruto == null || calc == null) return true;
    if (Math.abs(bruto - calc) < 0.02) return true;
    for (let k = 1; k <= 8; k++) if (Math.abs(bruto / Math.pow(10, k) - calc) < 0.02) return true;
    return false;
  }

  function importRows(conn, rows, fileName) {
    const rep = { ficheiro: fileName || '', linhas: 0, novos: 0, atualizados: 0, iguais: 0, ignoradas: 0, avisos: [], mudancas: [] };
    if (!rows || !rows.length) { rep.avisos.push('O ficheiro não tem linhas de dados.'); return rep; }
    const heads = Object.keys(rows[0]), H = {};
    heads.forEach(h => { const k = norm(h); if (!(k in H)) H[k] = h; });
    const col = (...keys) => { for (const k of keys) if (H[k]) return H[k]; return null; };
    const C = {
      apolice: col('APOLICE'), adesao: null,
      capital: col('CAPITAL'), inicio: col('INICIO'), tomador: col('TOMADOR'), nif: col('NIF'), parcela: col('PARCELA'), subparcela: col('SUBPARCELA'),
      comb: col('PARCELASUBPARCELA'), cultura: col('CULTURAOBJECTO'), ha: col('HAOBJECTO'), prod: col('PRODKGHAOBJECTO'), preco: col('PRECOOBJECTO'),
      capObj: col('CAPITALOBJECTO'), idade: col('IDADEANOS'), concelho: col('CODIGODOCONCELHO'), nifTomador: col('NIFTOMADOR'), nifap: col('NIFAP'),
      refProd: col('REFPRODUTIVIDADE'), refPreco: col('REFPRECO')
    };
    { const k = Object.keys(H).find(x => /^ADESAO/.test(x)); if (k) C.adesao = H[k]; }
    const falta = ['apolice', 'adesao', 'nif', 'tomador'].filter(k => !C[k]);
    if (!C.parcela && !C.comb) falta.push('parcela');
    if (falta.length) { rep.avisos.push('Faltam colunas obrigatórias no Excel: ' + falta.join(', ') + '.'); return rep; }
    const riskCols = [];
    heads.forEach(h => { let m;
      if ((m = h.match(/^\s*AGR\s*[-–]\s*(.+)$/i))) riskCols.push({ h, tipo: 'agr', r: canonRisk(m[1]) });
      else if ((m = h.match(/^\s*FRANQUIA\s*:\s*(.+)$/i))) riskCols.push({ h, tipo: 'franquia', r: canonRisk(m[1]) });
      else if ((m = h.match(/^\s*PMI\s*:\s*(.+)$/i))) riskCols.push({ h, tipo: 'pmi', r: canonRisk(m[1]) }); });

    const one = (sql, p) => conn.all(sql, p || [])[0] || null;
    const cache = { risco: new Map(), perfil: new Map(), cultura: new Map() };
    const mudanca = (txtMud) => { if (rep.mudancas.length < 300) rep.mudancas.push(txtMud); };
    const sumAdesao = new Map();   // soma calculada vs capital declarado

    function updateIfChanged(table, where, whereVals, old, neu, label) {
      const sets = [], vals = [], ch = [];
      for (const f of Object.keys(neu)) {
        const n = neu[f]; if (n == null || n === '') continue;
        if (!same(old[f], n)) { sets.push(f + '=?'); vals.push(n); ch.push(f + ': ' + (old[f] == null ? '(vazio)' : old[f]) + ' → ' + n); }
      }
      if (!sets.length) return false;
      conn.run('UPDATE ' + table + ' SET ' + sets.join(',') + ' WHERE ' + where, vals.concat(whereVals));
      mudanca(label + ' · ' + ch.join(' · ')); return true;
    }
    function getRisco(r) {
      if (cache.risco.has(r.chave)) return cache.risco.get(r.chave);
      let row = one('SELECT id FROM risco WHERE chave=?', [r.chave]);
      if (!row) { conn.run('INSERT INTO risco(chave,nome) VALUES(?,?)', [r.chave, r.nome]); row = { id: conn.lastId() }; }
      cache.risco.set(r.chave, row.id); return row.id;
    }
    function getPerfil(row) {
      const per = new Map();
      for (const rc of riskCols) {
        const v = row[rc.h]; if (v == null || String(v).trim() === '') continue;
        const e = per.get(rc.r.chave) || { r: rc.r, agr: null, franquia: null, pmi: null };
        if (rc.tipo === 'agr') { const n = parseNum(v); e.agr = n != null ? n : txt(v); }
        else if (rc.tipo === 'franquia') e.franquia = txt(v); else e.pmi = parseNum(v);
        per.set(rc.r.chave, e);
      }
      if (!per.size) return null;
      const ents = [...per.values()].sort((a, b) => a.r.chave < b.r.chave ? -1 : 1);
      const chave = ents.map(e => e.r.chave + ':' + (e.agr ?? '') + '|' + (e.franquia ?? '') + '|' + (e.pmi ?? '')).join(';');
      if (cache.perfil.has(chave)) return cache.perfil.get(chave);
      let pf = one('SELECT id FROM perfil WHERE chave=?', [chave]);
      if (!pf) {
        conn.run('INSERT INTO perfil(chave) VALUES(?)', [chave]); pf = { id: conn.lastId() };
        ents.forEach(e => conn.run('INSERT INTO perfil_risco(perfil_id,risco_id,agr,franquia,pmi) VALUES(?,?,?,?,?)', [pf.id, getRisco(e.r), e.agr, e.franquia, e.pmi]));
      }
      cache.perfil.set(chave, pf.id); return pf.id;
    }

    conn.exec('BEGIN');
    try {
      rows.forEach((row, idx) => {
        const linha = idx + 2;
        let P = idStr(C.parcela ? row[C.parcela] : null), S = idStr(C.subparcela ? row[C.subparcela] : null);
        if ((!P || !S) && C.comb) { const t = String(row[C.comb] || '').split('/'); P = P || (t[0] || '').trim(); S = S || (t[1] || '').trim(); }
        const apolice = txt(row[C.apolice]), adesaoN = idStr(row[C.adesao]), nif = idStr(row[C.nif]), nome = txt(row[C.tomador]);
        const falta1 = [];
        if (!/^\d+$/.test(P || '')) falta1.push('parcela' + (P ? ' ("' + P + '")' : ''));
        if (!/^\d+$/.test(S || '')) falta1.push('subparcela' + (S ? ' ("' + S + '")' : ''));
        if (!apolice) falta1.push('apólice'); if (!adesaoN) falta1.push('adesão'); if (!nif) falta1.push('NIF'); if (!nome) falta1.push('nome do tomador');
        if (falta1.length) { rep.ignoradas++; if (rep.avisos.length < 30) rep.avisos.push('Linha ' + linha + ' ignorada: falta ' + falta1.join(', ') + '.'); return; }
        rep.linhas++;
        let alterado = false;

        // tomador
        const tNeu = { nome, nifap: idStr(C.nifap ? row[C.nifap] : null) };
        let t = one('SELECT * FROM tomador WHERE nif=?', [nif]);
        if (!t) conn.run('INSERT INTO tomador(nif,nome,nifap) VALUES(?,?,?)', [nif, nome, tNeu.nifap]);
        else if (updateIfChanged('tomador', 'nif=?', [nif], t, tNeu, 'Tomador ' + nif)) alterado = true;

        // adesão
        const aNeu = { tomador_nif: nif, inicio: isoDate(C.inicio ? row[C.inicio] : null), nif_tomador_apolice: idStr(C.nifTomador ? row[C.nifTomador] : null),
          ref_produtividade: txt(C.refProd ? row[C.refProd] : null), ref_preco: txt(C.refPreco ? row[C.refPreco] : null) };
        let a = one('SELECT * FROM adesao WHERE apolice=? AND adesao_n=?', [apolice, adesaoN]), adesaoId;
        if (!a) { conn.run('INSERT INTO adesao(apolice,adesao_n,tomador_nif,inicio,nif_tomador_apolice,ref_produtividade,ref_preco) VALUES(?,?,?,?,?,?,?)',
          [apolice, adesaoN, nif, aNeu.inicio, aNeu.nif_tomador_apolice, aNeu.ref_produtividade, aNeu.ref_preco]); adesaoId = conn.lastId(); }
        else { adesaoId = a.id; if (updateIfChanged('adesao', 'id=?', [a.id], a, aNeu, 'Adesão ' + apolice + '/' + adesaoN)) alterado = true; }

        // parcela
        let cod = null, nomeConc = null;
        if (C.concelho && row[C.concelho] != null && row[C.concelho] !== '') { const t2 = String(row[C.concelho]).split('|'); cod = txt(t2[0]); nomeConc = txt(t2[1]); if (t2.length === 1) { nomeConc = cod; cod = null; } }
        const pNeu = { concelho_cod: cod, concelho: nomeConc };
        let p = one('SELECT * FROM parcela WHERE parcela=?', [P]);
        if (!p) conn.run('INSERT INTO parcela(parcela,concelho_cod,concelho) VALUES(?,?,?)', [P, cod, nomeConc]);
        else if (updateIfChanged('parcela', 'parcela=?', [P], p, pNeu, 'Parcela ' + P)) alterado = true;

        // subparcela
        let s = one('SELECT id FROM subparcela WHERE parcela=? AND nosa=?', [P, Number(S)]);
        if (!s) { conn.run('INSERT INTO subparcela(parcela,nosa) VALUES(?,?)', [P, Number(S)]); s = { id: conn.lastId() }; }

        // cultura
        let culturaId = null; const cd = txt(C.cultura ? row[C.cultura] : null);
        if (cd) { culturaId = cache.cultura.get(cd); if (!culturaId) { let c = one('SELECT id FROM cultura WHERE descricao=?', [cd]);
          if (!c) { conn.run('INSERT INTO cultura(descricao) VALUES(?)', [cd]); c = { id: conn.lastId() }; } culturaId = c.id; cache.cultura.set(cd, culturaId); } }

        // item
        const ha = parseNum(C.ha ? row[C.ha] : null), prod = parseNum(C.prod ? row[C.prod] : null), preco = parseNum(C.preco ? row[C.preco] : null);
        const iNeu = { cultura_id: culturaId, ha, prod_kg_ha: prod, preco_eur_kg: preco, idade_anos: parseNum(C.idade ? row[C.idade] : null), perfil_id: getPerfil(row) };
        const calc = (ha != null && prod != null && preco != null) ? ha * prod * preco : null;
        if (C.capObj && !capitalCompativel(parseNum(row[C.capObj]), calc)) { if (rep.avisos.length < 30) rep.avisos.push('Linha ' + linha + ' (' + P + '/' + S + '): o capital do Excel difere de ha × produtividade × preço.'); }
        const key = apolice + '/' + adesaoN; const sa = sumAdesao.get(key) || { calc: 0, decl: null, n: 0 };
        sa.calc += calc || 0; sa.n++; if (C.capital) { const d = parseNum(row[C.capital]); if (d != null) sa.decl = d; } sumAdesao.set(key, sa);
        let it = one('SELECT * FROM item WHERE adesao_id=? AND subparcela_id=?', [adesaoId, s.id]);
        if (!it) { conn.run('INSERT INTO item(adesao_id,subparcela_id,cultura_id,ha,prod_kg_ha,preco_eur_kg,idade_anos,perfil_id) VALUES(?,?,?,?,?,?,?,?)',
          [adesaoId, s.id, iNeu.cultura_id, ha, prod, preco, iNeu.idade_anos, iNeu.perfil_id]); rep.novos++; }
        else { const ch = updateIfChanged('item', 'id=?', [it.id], it, iNeu, 'Subparcela ' + P + '/' + S + ' (adesão ' + apolice + '/' + adesaoN + ')');
          if (ch || alterado) rep.atualizados++; else rep.iguais++; }
      });
      sumAdesao.forEach((v, k) => { if (v.decl != null && Math.abs(v.decl - v.calc) > 0.05)
        rep.avisos.push('Adesão ' + k + ': o capital do Excel (' + v.decl.toFixed(2) + ' €) difere da soma das subparcelas (' + v.calc.toFixed(2) + ' €).'); });
      conn.run('INSERT INTO importacao(ficheiro,em,linhas,novos,atualizados,iguais,avisos) VALUES(?,?,?,?,?,?,?)',
        [rep.ficheiro, new Date().toISOString().slice(0, 19).replace('T', ' '), rep.linhas, rep.novos, rep.atualizados, rep.iguais, rep.avisos.length]);
      conn.exec('COMMIT');
    } catch (e) { try { conn.exec('ROLLBACK'); } catch (e2) {} throw e; }
    return rep;
  }

  /* =================== CONSULTAS =================== */
  const items = conn => conn.all('SELECT * FROM v_item ORDER BY tomador, parcela, nosa');
  function counts(conn) {
    return conn.all(`SELECT (SELECT COUNT(*) FROM tomador) AS tomadores, (SELECT COUNT(*) FROM adesao) AS adesoes, (SELECT COUNT(*) FROM parcela) AS parcelas,
      (SELECT COUNT(*) FROM subparcela) AS subparcelas, (SELECT COUNT(*) FROM item) AS itens, (SELECT COUNT(*) FROM subparcela WHERE geom IS NOT NULL) AS com_poligono`)[0];
  }
  function aggregate(list, keyFn, labelFn) {
    const m = new Map();
    list.forEach(r => { const k = keyFn(r); const a = m.get(k) || { key: k, label: labelFn ? labelFn(r) : k, n: 0, ha: 0, prod_kg: 0, capital: 0 };
      a.n++; a.ha += r.ha || 0; a.prod_kg += r.producao_kg || 0; a.capital += r.capital_eur || 0; m.set(k, a); });
    return [...m.values()].map(a => Object.assign(a, { prod_kg_ha: a.ha ? a.prod_kg / a.ha : null, preco_medio: a.prod_kg ? a.capital / a.prod_kg : null }));
  }
  const totals = list => aggregate(list, () => 'total')[0] || { n: 0, ha: 0, prod_kg: 0, capital: 0, prod_kg_ha: null, preco_medio: null };

  /* =================== DADOS DO iSIP/IFAP (guardados uma vez por subparcela) =================== */
  function roundCoords(c, d) { d = d == null ? 6 : d; return typeof c[0] === 'number' ? c.map(x => +x.toFixed(d)) : c.map(x => roundCoords(x, d)); }
  function fromLookup(r) {
    const gj = r.ok || r.parcela; if (!gj || !gj.features || !gj.features.length) return { estado: 'nao_encontrada' };
    const polys = [];
    gj.features.forEach(f => { const g = f.geometry; if (!g) return; if (g.type === 'Polygon') polys.push(g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach(x => polys.push(x)); });
    const geom = polys.length === 1 ? { type: 'Polygon', coordinates: roundCoords(polys[0]) } : { type: 'MultiPolygon', coordinates: roundCoords(polys) };
    const pr = gj.features[0].properties || {}; const area = gj.features.reduce((s, f) => s + (Number(f.properties && f.properties.AREA) || 0), 0);
    return { estado: r.ok ? 'subparcela' : 'parcela_inteira', classe: txt(pr.CLASSE), grau_cob: txt(pr.GRAU_COB), abandono: txt(pr.ABANDONO),
      data_revisao: txt(pr.DATA_REVISAO), area_m2: area || null, geom: JSON.stringify(geom) };
  }
  function saveIfap(conn, subparcelaId, rec) {
    conn.run('UPDATE subparcela SET ifap_estado=?, ifap_em=?, ifap_classe=?, ifap_grau_cob=?, ifap_abandono=?, ifap_data_revisao=?, ifap_area_m2=?, geom=? WHERE id=?',
      [rec.estado, new Date().toISOString().slice(0, 10), rec.classe ?? null, rec.grau_cob ?? null, rec.abandono ?? null, rec.data_revisao ?? null, rec.area_m2 ?? null, rec.geom ?? null, subparcelaId]);
  }
  const geomOf = (conn, subId) => { const r = conn.all('SELECT geom, ifap_classe, ifap_grau_cob, ifap_abandono, ifap_data_revisao, ifap_area_m2, ifap_estado FROM subparcela WHERE id=?', [subId])[0]; return r && r.geom ? Object.assign({}, r, { geometry: JSON.parse(r.geom) }) : null; };


  /* =================== REGISTO DAS ALTERAÇÕES (para publicar na nuvem só o que mudou) =================== */
  const TRACK = [
    { t: 'tomador', k: 'nif', n: 'NEW.nif' }, { t: 'parcela', k: 'parcela', n: 'NEW.parcela' }, { t: 'cultura', k: 'id', n: 'NEW.id' },
    { t: 'risco', k: 'id', n: 'NEW.id' }, { t: 'perfil', k: 'id', n: 'NEW.id' },
    { t: 'perfil_risco', k: "perfil_id || '|' || risco_id", n: "NEW.perfil_id || '|' || NEW.risco_id" },
    { t: 'adesao', k: 'id', n: 'NEW.id' }, { t: 'subparcela', k: 'id', n: 'NEW.id' }, { t: 'item', k: 'id', n: 'NEW.id' }, { t: 'importacao', k: 'id', n: 'NEW.id' }];
  function enableTracking(conn) {
    conn.exec('CREATE TABLE IF NOT EXISTS _alt(t TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY(t, k))');
    TRACK.forEach(x => ['INSERT', 'UPDATE'].forEach(ev => conn.exec(
      'CREATE TRIGGER IF NOT EXISTS _alt_' + ev.charAt(0).toLowerCase() + '_' + x.t + ' AFTER ' + ev + ' ON ' + x.t +
      " BEGIN INSERT OR IGNORE INTO _alt(t, k) VALUES('" + x.t + "', CAST(" + x.n + ' AS TEXT)); END;')));
  }
  function pendingCount(conn) {
    try { return conn.all('SELECT COUNT(*) AS n FROM _alt')[0].n; } catch (e) { return 0; }
  }
  function clearTouched(conn) { try { conn.exec('DELETE FROM _alt'); } catch (e) {} }

  const API = { TRACK, enableTracking, pendingCount, clearTouched, SCHEMA, ensureSchema, clearAll, importRows, items, counts, aggregate, totals, fromLookup, saveIfap, geomOf, parseNum, isoDate, norm, canonRisk };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.DB = API;
})(typeof window !== 'undefined' ? window : globalThis);
