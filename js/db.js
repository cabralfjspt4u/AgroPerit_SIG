/* AGROPERIT Parcelário – organização dos dados (SQLite), importação sem duplicados, arquivo-morto e consultas.
   Funciona com qualquer "ligação" que tenha: exec(sql), run(sql,params), all(sql,params), lastId(). */
(function (root) {
  'use strict';

  /* =================== ESTRUTURA DA BASE DE DADOS ===================
     Cada informação fica guardada UMA só vez:
       tomador      quem é (NIF, nome, NIFAP)
       adesao       contrato: apólice + nº de adesão (ou "sem nº" + NIF nas apólices individuais)
       parcela      nº da parcela IFAP e concelho
       subparcela   cada subparcela + o que vem do iSIP/IFAP (polígono, classe, área…)
       cultura      descrições de cultura (guardadas uma vez)
       item         o que está seguro: adesão + subparcela (+ sub_ref, ex. "38.1") → cultura, ha, produtividade, preço
       risco/perfil/perfil_risco   franquias, PMI e agravamentos (conjuntos iguais guardados uma vez)
     NÃO se guarda o que se calcula: produção = ha × produtividade; capital = produção × preço.
     ARQUIVO-MORTO: item.oculto_em preenchido = o item (e o seu polígono) deixa de aparecer em tudo. */
  const ITEM_DDL = `CREATE TABLE IF NOT EXISTS item(
  id INTEGER PRIMARY KEY, adesao_id INTEGER NOT NULL REFERENCES adesao(id),
  subparcela_id INTEGER NOT NULL REFERENCES subparcela(id), cultura_id INTEGER REFERENCES cultura(id),
  sub_ref TEXT NOT NULL DEFAULT '', ha REAL, prod_kg_ha REAL, preco_eur_kg REAL, idade TEXT, oculto_em TEXT,
  perfil_id INTEGER REFERENCES perfil(id),
  UNIQUE(adesao_id, subparcela_id, sub_ref));`;
  const VIEW_SELECT = `SELECT i.id AS id, t.nif AS nif, t.nome AS tomador, a.apolice AS apolice, a.adesao_n AS adesao_n, a.inicio AS inicio,
       p.parcela AS parcela, s.nosa AS nosa, i.sub_ref AS sub_ref, p.concelho_cod AS concelho_cod, p.concelho AS concelho,
       c.descricao AS cultura, i.ha AS ha, i.prod_kg_ha AS prod_kg_ha, i.preco_eur_kg AS preco_eur_kg, i.idade AS idade,
       i.ha * i.prod_kg_ha AS producao_kg, i.ha * i.prod_kg_ha * i.preco_eur_kg AS capital_eur,
       s.id AS subparcela_id, s.ifap_estado AS ifap_estado, s.ifap_area_m2 / 10000.0 AS ifap_ha, i.perfil_id AS perfil_id, i.oculto_em AS oculto_em
FROM item i JOIN adesao a ON a.id = i.adesao_id JOIN tomador t ON t.nif = a.tomador_nif
JOIN subparcela s ON s.id = i.subparcela_id JOIN parcela p ON p.parcela = s.parcela
LEFT JOIN cultura c ON c.id = i.cultura_id`;
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
${ITEM_DDL}
CREATE TABLE IF NOT EXISTS importacao(
  id INTEGER PRIMARY KEY, ficheiro TEXT, em TEXT, linhas INTEGER, novos INTEGER, atualizados INTEGER, iguais INTEGER, avisos INTEGER);
CREATE VIEW IF NOT EXISTS v_item AS ${VIEW_SELECT}
WHERE i.oculto_em IS NULL;
CREATE VIEW IF NOT EXISTS v_item_arq AS ${VIEW_SELECT}
WHERE i.oculto_em IS NOT NULL;`;

  /* bases criadas por versões anteriores: acrescenta sub_ref, idade (texto) e oculto_em à tabela item */
  function migrate(conn) {
    let cols; try { cols = conn.all('PRAGMA table_info(item)').map(r => r.name); } catch (e) { return; }
    if (!cols.length || (cols.includes('sub_ref') && cols.includes('idade') && cols.includes('oculto_em'))) return;
    conn.exec('DROP VIEW IF EXISTS v_item; DROP VIEW IF EXISTS v_item_arq; DROP TRIGGER IF EXISTS _alt_i_item; DROP TRIGGER IF EXISTS _alt_u_item; DROP TRIGGER IF EXISTS _alt_d_item;');
    conn.exec('BEGIN');
    try {
      conn.exec('ALTER TABLE item RENAME TO item_old');
      conn.exec(ITEM_DDL);
      const idade = cols.includes('idade') ? 'idade' : (cols.includes('idade_anos') ? 'CAST(idade_anos AS TEXT)' : 'NULL');
      conn.exec('INSERT INTO item(id,adesao_id,subparcela_id,cultura_id,sub_ref,ha,prod_kg_ha,preco_eur_kg,idade,oculto_em,perfil_id) SELECT id,adesao_id,subparcela_id,cultura_id,' +
        (cols.includes('sub_ref') ? 'sub_ref' : "''") + ',ha,prod_kg_ha,preco_eur_kg,' + idade + ',' + (cols.includes('oculto_em') ? 'oculto_em' : 'NULL') + ',perfil_id FROM item_old');
      conn.exec('DROP TABLE item_old'); conn.exec('COMMIT');
    } catch (e) { try { conn.exec('ROLLBACK'); } catch (e2) {} throw e; }
  }
  function ensureSchema(conn) {
    migrate(conn);
    conn.exec('DROP VIEW IF EXISTS v_item; DROP VIEW IF EXISTS v_item_arq;');   // as vistas refrescam sempre
    conn.exec(SCHEMA); conn.run("INSERT OR IGNORE INTO meta(chave,valor) VALUES('versao','2')", []);
  }
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
  /* PMI: aceita 20, 0,2 ou 0,201 e guarda sempre em percentagem, arredondada a 0,5 (20 e 20,1 → 20; 0,05 → 5) */
  function pmiPct(v) {
    const n = parseNum(v); if (n == null) return null;
    const p = (n > 0 && n <= 1) ? n * 100 : n; return Math.round(p * 2) / 2;
  }
  const txt = v => v == null ? null : (String(v).trim() || null);
  function idStr(v) { if (v == null || v === '') return null; if (typeof v === 'number') return String(Math.round(v)); return String(v).trim().replace(/\.0+$/, '') || null; }
  function subStr(v) { if (v == null || v === '') return null; if (typeof v === 'number') return String(v); return String(v).trim().replace(',', '.') || null; }
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
    ['Vingamento'], ['Javali', ['JAVALIECEREAIS', 'JAVALISECEREAIS']], ['Escaldão'], ['Escaldão pomóidas'], ['Raio'], ['Desavinho'], ['Incêndio'], ['Precipitação forte'], ['Ventos fortes'],
    ['Aluimento de terras'], ['Flamingo', ['FLAMINGOARROZ']], ['Extensão de prazo'], ['Incêndio não meteorológico', ['INCNAOMETEOROLOGICO']], ['Fendilhamento do fruto'],
    ['Geada no Algarve'], ['Geada na floração', ['GEADANAFLORAC']], ['Replante poda'], ['Seca (paramétrico)'], ['Desavinho paramétrico']];
  const RISK_ALIAS = new Map();
  RISKS.forEach(([nome, al]) => { const k = norm(nome); RISK_ALIAS.set(k, { chave: k, nome }); (al || []).forEach(a => RISK_ALIAS.set(a, { chave: k, nome })); });
  function canonRisk(raw) {
    const k = norm(raw); if (RISK_ALIAS.has(k)) return RISK_ALIAS.get(k);
    const nome = String(raw).trim().toLowerCase().replace(/^./, c => c.toUpperCase()); return { chave: k, nome };
  }

  /* =================== IMPORTAÇÃO (junta sem duplicar, carrega tudo o que tem parcela) =================== */
  const same = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-9 : a === b;
  function capitalCompativel(bruto, calc) {          // o Excel por vezes perde a vírgula (4549,0884 → 45490884)
    if (bruto == null || calc == null) return true;
    if (Math.abs(bruto - calc) < 0.02) return true;
    for (let k = 1; k <= 8; k++) if (Math.abs(bruto / Math.pow(10, k) - calc) < 0.02) return true;
    return false;
  }

  function importRows(conn, rows, fileName, opts) {
    opts = opts || {};
    const rep = { ficheiro: fileName || '', linhas: 0, novos: 0, atualizados: 0, iguais: 0, ignoradas: 0, vazias: 0, arquivadas: 0, semAdesao: 0,
      avisos: [], mudancas: [], linhasIgnoradas: [], completadas: [], incompletas: [], grupos: [] };
    const last = { apolice: null, adesao: null, nome: null, nif: null };
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
    const falta = ['apolice', 'nif', 'tomador'].filter(k => !C[k]);
    if (!C.adesao) rep.avisos.push('O Excel não tem coluna de adesão: todas as linhas entram como "sem nº".');
    if (!C.parcela && !C.comb) falta.push('parcela');
    if (falta.length) { rep.avisos.push('Faltam colunas obrigatórias no Excel: ' + falta.join(', ') + '.'); return rep; }
    const riskCols = [];
    heads.forEach(h => { let m;
      if ((m = h.match(/^\s*AGR\s*[-–]\s*(.+)$/i))) riskCols.push({ h, tipo: 'agr', r: canonRisk(m[1]) });
      else if ((m = h.match(/^\s*FRANQUIA\s*:\s*(.+)$/i))) riskCols.push({ h, tipo: 'franquia', r: canonRisk(m[1]) });
      else if ((m = h.match(/^\s*PMI\s*:\s*(.+)$/i))) riskCols.push({ h, tipo: 'pmi', r: canonRisk(m[1]) }); });

    const one = (sql, p) => conn.all(sql, p || [])[0] || null;
    const cache = { risco: new Map(), perfil: new Map(), cultura: new Map() };
    const mudanca = (m) => { if (rep.mudancas.length < 300) rep.mudancas.push(m); };
    const sumAdesao = new Map(), partilhadas = new Map(), adVisto = new Map(), conflAdesao = new Set();

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
        else if (rc.tipo === 'franquia') e.franquia = txt(v); else e.pmi = pmiPct(v);
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
    function upTomador(nif, nome, nifap, label) {
      const t = one('SELECT * FROM tomador WHERE nif=?', [nif]);
      if (!t) { conn.run('INSERT INTO tomador(nif,nome,nifap) VALUES(?,?,?)', [nif, nome, nifap]); return false; }
      return updateIfChanged('tomador', 'nif=?', [nif], t, { nome, nifap }, label || ('Tomador ' + nif));
    }

    conn.exec('BEGIN');
    try {
      rows.forEach((row, idx) => {
        const linha = idx + 2;
        const adRaw = C.adesao ? txt(row[C.adesao]) : null;

        // linha de grupo (=GRUPO=): identifica o tomador da apólice (ex.: uma associação); não é uma subparcela
        if (adRaw && norm(adRaw) === 'GRUPO') {
          const gnif = idStr(C.nif ? row[C.nif] : null), gnome = txt(C.tomador ? row[C.tomador] : null);
          if (gnif && gnome) { upTomador(gnif, gnome, null, 'Tomador da apólice ' + gnif); rep.grupos.push('Linha ' + linha + ': ' + gnome + ' (NIF ' + gnif + ') registado como tomador da apólice.'); }
          else rep.vazias++;
          return;
        }

        // parcela e subparcela (a subparcela pode ter sufixo, ex.: 38.1 → polígono 38, identificação 38.1)
        let P = idStr(C.parcela ? row[C.parcela] : null), subTxt = null;
        if (C.comb && row[C.comb] != null && String(row[C.comb]).includes('/')) { const t = String(row[C.comb]).split('/'); P = P || (t[0] || '').trim(); subTxt = (t[1] || '').trim().replace(',', '.') || null; }
        if (!subTxt) subTxt = subStr(C.subparcela ? row[C.subparcela] : null);
        let apolice = txt(C.apolice ? row[C.apolice] : null), adesaoN = adRaw ? idStr(row[C.adesao]) : null, nif = idStr(C.nif ? row[C.nif] : null), nome = txt(C.tomador ? row[C.tomador] : null);
        const pOk = /^\d+$/.test(P || ''), sOk = /^\d+(\.\d+)?$/.test(subTxt || '');

        if (opts.preencherAcima && pOk && sOk) {
          const fx = [];
          if (!apolice && last.apolice) { apolice = last.apolice; fx.push('apólice'); }
          if (!adesaoN && last.adesao && apolice === last.apolice) { adesaoN = last.adesao; fx.push('adesão'); }
          if (!nome && last.nome) { nome = last.nome; fx.push('nome'); }
          if (!nif && last.nif && nome === last.nome) { nif = last.nif; fx.push('NIF'); }
          if (fx.length && rep.completadas.length < 200) rep.completadas.push('Linha ' + linha + ' (' + P + '/' + subTxt + '): completada com a linha de cima → ' + fx.join(', '));
        }
        if (apolice && apolice !== last.apolice) { last.apolice = apolice; last.adesao = null; }
        if (adesaoN) last.adesao = adesaoN;
        if (nome) { if (nome !== last.nome) last.nif = null; last.nome = nome; }
        if (nif) last.nif = nif;

        if (!pOk || !sOk) {   // sem parcela/subparcela não há o que guardar
          const falta1 = [];
          if (!pOk) falta1.push('parcela' + (P ? ' ("' + P + '")' : ''));
          if (!sOk) falta1.push('subparcela' + (subTxt ? ' ("' + subTxt + '")' : ''));
          if (!P && !subTxt && !apolice && !adesaoN && !nif && !nome) { rep.vazias++; return; }
          rep.ignoradas++;
          if (rep.avisos.length < 30) rep.avisos.push('Linha ' + linha + ' ignorada: falta ' + falta1.join(', ') + '.');
          if (rep.linhasIgnoradas.length < 500) {
            const g = c => (c && row[c] != null && row[c] !== '') ? (row[c] instanceof Date ? isoDate(row[c]) : row[c]) : '';
            rep.linhasIgnoradas.push({ linha, falta: falta1.join(', '), valores: { 'Tomador': g(C.tomador), 'NIF': g(C.nif), 'Apólice': g(C.apolice), 'Adesão': g(C.adesao),
              'Parcela': P || '', 'Subparcela': subTxt || '', 'Cultura': g(C.cultura), 'Ha': g(C.ha), 'Capital (objeto)': g(C.capObj) } });
          }
          return;
        }

        // tem parcela: importa SEMPRE, mesmo que falte apólice, adesão, NIF ou nome (campos em falta ficam assinalados)
        const emFalta = [];
        if (!apolice) { apolice = 'SEM APÓLICE'; emFalta.push('apólice'); }
        let nifKey = nif;
        if (!nifKey) { nifKey = nome ? 'SEM-NIF:' + norm(nome).slice(0, 24) : 'SEM-TOMADOR'; emFalta.push('NIF'); }
        if (!nome) { nome = nif ? 'Sem nome (NIF ' + nif + ')' : 'Sem tomador'; emFalta.push('nome'); }
        let semNum = false;
        if (!adesaoN) { adesaoN = 'sem nº ' + nifKey; semNum = true; rep.semAdesao++; }
        if ((emFalta.length || semNum) && rep.incompletas.length < 200) rep.incompletas.push('Linha ' + linha + ' (' + P + '/' + subTxt + '): importada sem ' + (semNum ? 'nº de adesão' + (emFalta.length ? ', ' : '') : '') + emFalta.join(', ') + '.');
        rep.linhas++;
        const nosa = parseInt(subTxt, 10), subRef = subTxt === String(nosa) ? '' : subTxt;
        let alterado = false;

        // tomador
        if (upTomador(nifKey, nome, idStr(C.nifap ? row[C.nifap] : null))) alterado = true;

        // adesão (identificada por apólice + nº; se o mesmo nº já pertence a outro tomador, fica uma adesão separada)
        const aNeu = { tomador_nif: nifKey, inicio: isoDate(C.inicio ? row[C.inicio] : null), nif_tomador_apolice: idStr(C.nifTomador ? row[C.nifTomador] : null),
          ref_produtividade: txt(C.refProd ? row[C.refProd] : null), ref_preco: txt(C.refPreco ? row[C.refPreco] : null) };
        let adLabel = adesaoN, a = one('SELECT * FROM adesao WHERE apolice=? AND adesao_n=?', [apolice, adesaoN]), adesaoId;
        if (a && a.tomador_nif !== nifKey) {
          const k2 = apolice + '/' + adesaoN;
          if (!partilhadas.has(k2)) partilhadas.set(k2, new Set([a.tomador_nif]));
          partilhadas.get(k2).add(nifKey);
          adLabel = adesaoN + ' · ' + nifKey;
          a = one('SELECT * FROM adesao WHERE apolice=? AND adesao_n=?', [apolice, adLabel]);
        }
        if (!a) { conn.run('INSERT INTO adesao(apolice,adesao_n,tomador_nif,inicio,nif_tomador_apolice,ref_produtividade,ref_preco) VALUES(?,?,?,?,?,?,?)',
          [apolice, adLabel, nifKey, aNeu.inicio, aNeu.nif_tomador_apolice, aNeu.ref_produtividade, aNeu.ref_preco]); adesaoId = conn.lastId(); adVisto.set(adesaoId, aNeu); }
        else {
          adesaoId = a.id;
          if (adVisto.has(adesaoId)) {      // já vista nesta importação: a 1.ª linha manda; avisa se as outras discordam
            const prev = adVisto.get(adesaoId);
            ['inicio', 'nif_tomador_apolice'].forEach(f => { const kk = adesaoId + f;
              if (aNeu[f] && prev[f] && aNeu[f] !== prev[f] && !conflAdesao.has(kk)) { conflAdesao.add(kk);
                rep.avisos.push('Adesão ' + apolice + '/' + adLabel + ': "' + (f === 'inicio' ? 'Início' : 'NIF tomador') + '" difere entre linhas (' + prev[f] + ' / ' + aNeu[f] + '). Fica o da primeira linha.'); } });
          } else { adVisto.set(adesaoId, aNeu); if (updateIfChanged('adesao', 'id=?', [a.id], a, aNeu, 'Adesão ' + apolice + '/' + adLabel)) alterado = true; }
        }

        // parcela
        let cod = null, nomeConc = null;
        if (C.concelho && row[C.concelho] != null && row[C.concelho] !== '') { const t2 = String(row[C.concelho]).split('|'); cod = txt(t2[0]); nomeConc = txt(t2[1]); if (t2.length === 1) { nomeConc = cod; cod = null; } }
        let p = one('SELECT * FROM parcela WHERE parcela=?', [P]);
        if (!p) conn.run('INSERT INTO parcela(parcela,concelho_cod,concelho) VALUES(?,?,?)', [P, cod, nomeConc]);
        else if (updateIfChanged('parcela', 'parcela=?', [P], p, { concelho_cod: cod, concelho: nomeConc }, 'Parcela ' + P)) alterado = true;

        // subparcela (um polígono por parcela + nº inteiro)
        let s = one('SELECT id FROM subparcela WHERE parcela=? AND nosa=?', [P, nosa]);
        if (!s) { conn.run('INSERT INTO subparcela(parcela,nosa) VALUES(?,?)', [P, nosa]); s = { id: conn.lastId() }; }

        // cultura
        let culturaId = null; const cd = txt(C.cultura ? row[C.cultura] : null);
        if (cd) { culturaId = cache.cultura.get(cd); if (!culturaId) { let c = one('SELECT id FROM cultura WHERE descricao=?', [cd]);
          if (!c) { conn.run('INSERT INTO cultura(descricao) VALUES(?)', [cd]); c = { id: conn.lastId() }; } culturaId = c.id; cache.cultura.set(cd, culturaId); } }

        // item
        const ha = parseNum(C.ha ? row[C.ha] : null), prod = parseNum(C.prod ? row[C.prod] : null), preco = parseNum(C.preco ? row[C.preco] : null);
        const iNeu = { cultura_id: culturaId, ha, prod_kg_ha: prod, preco_eur_kg: preco, idade: txt(C.idade ? row[C.idade] : null), perfil_id: getPerfil(row) };
        const calc = (ha != null && prod != null && preco != null) ? ha * prod * preco : null;
        if (C.capObj && !capitalCompativel(parseNum(row[C.capObj]), calc)) { if (rep.avisos.length < 30) rep.avisos.push('Linha ' + linha + ' (' + P + '/' + subTxt + '): o capital do Excel difere de ha × produtividade × preço.'); }
        const key = apolice + '/' + adLabel; const sa = sumAdesao.get(key) || { calc: 0, decl: null, n: 0 };
        sa.calc += calc || 0; sa.n++; if (C.capital) { const d = parseNum(row[C.capital]); if (d != null) sa.decl = d; } sumAdesao.set(key, sa);
        const it = one('SELECT * FROM item WHERE adesao_id=? AND subparcela_id=? AND sub_ref=?', [adesaoId, s.id, subRef]);
        if (!it) { conn.run('INSERT INTO item(adesao_id,subparcela_id,sub_ref,cultura_id,ha,prod_kg_ha,preco_eur_kg,idade,perfil_id) VALUES(?,?,?,?,?,?,?,?,?)',
          [adesaoId, s.id, subRef, iNeu.cultura_id, ha, prod, preco, iNeu.idade, iNeu.perfil_id]); rep.novos++; }
        else if (it.oculto_em) { rep.arquivadas++; }       // está no arquivo-morto: fica como está
        else { const ch = updateIfChanged('item', 'id=?', [it.id], it, iNeu, 'Subparcela ' + P + '/' + subTxt + ' (adesão ' + apolice + '/' + adLabel + ')');
          if (ch || alterado) rep.atualizados++; else rep.iguais++; }
      });
      partilhadas.forEach((s, k) => rep.avisos.push('Adesão ' + k + ': o mesmo número é usado por ' + s.size + ' tomadores diferentes (NIF ' + [...s].join(', ') + '). Ficam como adesões separadas.'));
      sumAdesao.forEach((v, k) => { if (v.decl != null && Math.abs(v.decl - v.calc) > 0.05)
        rep.avisos.push('Adesão ' + k + ': o capital do Excel (' + v.decl.toFixed(2) + ' €) difere da soma das subparcelas (' + v.calc.toFixed(2) + ' €).'); });
      conn.run('INSERT INTO importacao(ficheiro,em,linhas,novos,atualizados,iguais,avisos) VALUES(?,?,?,?,?,?,?)',
        [rep.ficheiro, new Date().toISOString().slice(0, 19).replace('T', ' '), rep.linhas, rep.novos, rep.atualizados, rep.iguais, rep.avisos.length]);
      conn.exec('COMMIT');
    } catch (e) { try { conn.exec('ROLLBACK'); } catch (e2) {} throw e; }
    return rep;
  }

  /* =================== CONSULTAS (só o que está visível; o arquivo-morto não aparece) =================== */
  const items = conn => conn.all('SELECT * FROM v_item ORDER BY tomador, parcela, nosa, sub_ref');
  function counts(conn) {
    return conn.all(`SELECT COUNT(DISTINCT nif) AS tomadores, COUNT(DISTINCT apolice || '|' || adesao_n) AS adesoes, COUNT(DISTINCT parcela) AS parcelas,
      COUNT(DISTINCT subparcela_id) AS subparcelas, COUNT(*) AS itens,
      COUNT(DISTINCT CASE WHEN ifap_estado IN ('subparcela','parcela_inteira') THEN subparcela_id END) AS com_poligono FROM v_item`)[0];
  }
  function aggregate(list, keyFn, labelFn) {
    const m = new Map();
    list.forEach(r => { const k = keyFn(r); const a = m.get(k) || { key: k, label: labelFn ? labelFn(r) : k, n: 0, ha: 0, prod_kg: 0, capital: 0 };
      a.n++; a.ha += r.ha || 0; a.prod_kg += r.producao_kg || 0; a.capital += r.capital_eur || 0; m.set(k, a); });
    return [...m.values()].map(a => Object.assign(a, { prod_kg_ha: a.ha ? a.prod_kg / a.ha : null, preco_medio: a.prod_kg ? a.capital / a.prod_kg : null }));
  }
  const totals = list => aggregate(list, () => 'total')[0] || { n: 0, ha: 0, prod_kg: 0, capital: 0, prod_kg_ha: null, preco_medio: null };

  /* =================== ARQUIVO-MORTO, ELIMINAÇÃO E LIMPEZA =================== */
  const chunks = (ids, n) => { const out = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; };
  function archive(conn, ids, quando) {
    const ts = quando || new Date().toISOString().slice(0, 19).replace('T', ' ');
    chunks(ids, 400).forEach(c => conn.run('UPDATE item SET oculto_em=? WHERE oculto_em IS NULL AND id IN (' + c.map(() => '?').join(',') + ')', [ts].concat(c)));
    return ids.length;
  }
  function restore(conn, ids) {
    chunks(ids, 400).forEach(c => conn.run('UPDATE item SET oculto_em=NULL WHERE id IN (' + c.map(() => '?').join(',') + ')', c));
    return ids.length;
  }
  /* o que fica sem uso (adesões, subparcelas com polígono, tomadores, parcelas, culturas, perfis) também desaparece */
  function cleanOrphans(conn) {
    conn.exec(`DELETE FROM adesao WHERE id NOT IN (SELECT adesao_id FROM item);
DELETE FROM subparcela WHERE id NOT IN (SELECT subparcela_id FROM item);
DELETE FROM tomador WHERE nif NOT IN (SELECT tomador_nif FROM adesao)
  AND nif NOT IN (SELECT nif_tomador_apolice FROM adesao WHERE nif_tomador_apolice IS NOT NULL);
DELETE FROM parcela WHERE parcela NOT IN (SELECT parcela FROM subparcela);
DELETE FROM cultura WHERE id NOT IN (SELECT cultura_id FROM item WHERE cultura_id IS NOT NULL);
DELETE FROM perfil_risco WHERE perfil_id NOT IN (SELECT perfil_id FROM item WHERE perfil_id IS NOT NULL);
DELETE FROM perfil WHERE id NOT IN (SELECT perfil_id FROM item WHERE perfil_id IS NOT NULL);`);
  }
  function deleteItems(conn, ids) {
    conn.exec('BEGIN');
    try { chunks(ids, 400).forEach(c => conn.run('DELETE FROM item WHERE id IN (' + c.map(() => '?').join(',') + ')', c)); cleanOrphans(conn); conn.exec('COMMIT'); }
    catch (e) { try { conn.exec('ROLLBACK'); } catch (e2) {} throw e; }
    return ids.length;
  }
  const archivedItems = conn => conn.all('SELECT * FROM v_item_arq ORDER BY tomador, parcela, nosa, sub_ref');

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
    { t: 'tomador', k: 'nif', n: 'NEW.nif', o: 'OLD.nif' }, { t: 'parcela', k: 'parcela', n: 'NEW.parcela', o: 'OLD.parcela' }, { t: 'cultura', k: 'id', n: 'NEW.id', o: 'OLD.id' },
    { t: 'risco', k: 'id', n: 'NEW.id', o: 'OLD.id' }, { t: 'perfil', k: 'id', n: 'NEW.id', o: 'OLD.id' },
    { t: 'perfil_risco', k: "perfil_id || '|' || risco_id", n: "NEW.perfil_id || '|' || NEW.risco_id", o: "OLD.perfil_id || '|' || OLD.risco_id" },
    { t: 'adesao', k: 'id', n: 'NEW.id', o: 'OLD.id' }, { t: 'subparcela', k: 'id', n: 'NEW.id', o: 'OLD.id' }, { t: 'item', k: 'id', n: 'NEW.id', o: 'OLD.id' }, { t: 'importacao', k: 'id', n: 'NEW.id', o: 'OLD.id' }];
  function enableTracking(conn) {
    conn.exec('CREATE TABLE IF NOT EXISTS _alt(t TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY(t, k)); CREATE TABLE IF NOT EXISTS _del(t TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY(t, k));');
    TRACK.forEach(x => {
      ['INSERT', 'UPDATE'].forEach(ev => conn.exec('CREATE TRIGGER IF NOT EXISTS _alt_' + ev.charAt(0).toLowerCase() + '_' + x.t + ' AFTER ' + ev + ' ON ' + x.t +
        " BEGIN INSERT OR IGNORE INTO _alt(t, k) VALUES('" + x.t + "', CAST(" + x.n + ' AS TEXT)); END;'));
      conn.exec('CREATE TRIGGER IF NOT EXISTS _alt_d_' + x.t + ' AFTER DELETE ON ' + x.t +
        " BEGIN INSERT OR IGNORE INTO _del(t, k) VALUES('" + x.t + "', CAST(" + x.o + ' AS TEXT)); END;');
    });
  }
  function pendingCount(conn) {
    let n = 0; ['_alt', '_del'].forEach(t => { try { n += conn.all('SELECT COUNT(*) AS n FROM ' + t)[0].n; } catch (e) {} }); return n;
  }
  function clearTouched(conn) { ['_alt', '_del'].forEach(t => { try { conn.exec('DELETE FROM ' + t); } catch (e) {} }); }

  const API = { TRACK, enableTracking, pendingCount, clearTouched, SCHEMA, ensureSchema, migrate, clearAll, importRows, items, counts, aggregate, totals,
    archive, restore, deleteItems, cleanOrphans, archivedItems, fromLookup, saveIfap, geomOf, parseNum, pmiPct, isoDate, norm, canonRisk };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.DB = API;
})(typeof window !== 'undefined' ? window : globalThis);
