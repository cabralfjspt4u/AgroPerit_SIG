/* AGROPERIT Parcelário – ligação à base partilhada (Supabase): login por convite, descarregar e publicar */
(function (root) {
  'use strict';
  const TABLES = [
    { t: 'tomador', cols: ['nif', 'nome', 'nifap'], pk: ['nif'], batch: 500 },
    { t: 'parcela', cols: ['parcela', 'concelho_cod', 'concelho'], pk: ['parcela'], batch: 500 },
    { t: 'cultura', cols: ['id', 'descricao'], pk: ['id'], batch: 500 },
    { t: 'risco', cols: ['id', 'chave', 'nome'], pk: ['id'], batch: 500 },
    { t: 'perfil', cols: ['id', 'chave'], pk: ['id'], batch: 500 },
    { t: 'perfil_risco', cols: ['perfil_id', 'risco_id', 'agr', 'franquia', 'pmi'], pk: ['perfil_id', 'risco_id'], batch: 500 },
    { t: 'adesao', cols: ['id', 'apolice', 'adesao_n', 'tomador_nif', 'inicio', 'nif_tomador_apolice', 'ref_produtividade', 'ref_preco'], pk: ['id'], batch: 500 },
    { t: 'subparcela', cols: ['id', 'parcela', 'nosa', 'ifap_estado', 'ifap_em', 'ifap_classe', 'ifap_grau_cob', 'ifap_abandono', 'ifap_data_revisao', 'ifap_area_m2', 'geom'], pk: ['id'], batch: 150 },
    { t: 'item', cols: ['id', 'adesao_id', 'subparcela_id', 'cultura_id', 'ha', 'prod_kg_ha', 'preco_eur_kg', 'idade_anos', 'perfil_id'], pk: ['id'], batch: 500 },
    { t: 'importacao', cols: ['id', 'ficheiro', 'em', 'linhas', 'novos', 'atualizados', 'iguais', 'avisos'], pk: ['id'], batch: 500 }
  ];
  let sb = null, ligado = false;
  const fail = e => { throw new Error((e && e.message) || String(e)); };
  const getMeta = (conn, k) => { const r = conn.all('SELECT valor FROM meta WHERE chave=?', [k])[0]; return r ? r.valor : null; };
  const setMeta = (conn, k, v) => conn.run('INSERT OR REPLACE INTO meta(chave,valor) VALUES(?,?)', [k, String(v)]);

  function init(cfg) {
    cfg = cfg || {}; if (!cfg.supabaseUrl || !cfg.supabaseKey) return false;
    if (!root.supabase || !root.supabase.createClient) return false;
    sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: {
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
      storage: cfg.manterSessao ? root.localStorage : root.sessionStorage } });
    ligado = true; return true;
  }
  function use(client) { sb = client; ligado = true; }          // para testes
  const enabled = () => ligado;

  /* ---- sessão ---- */
  async function session() { const { data, error } = await sb.auth.getSession(); if (error) fail(error); return data && data.session; }
  async function signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) fail(error); return data; }
  async function signOut() { try { await sb.auth.signOut(); } catch (e) {} }
  async function setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) fail(error); }
  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: root.location ? root.location.origin + root.location.pathname : undefined }); if (error) fail(error);
  }
  async function role() { const { data, error } = await sb.rpc('papel'); if (error) fail(error); return data || null; }   // 'admin' | 'leitor' | null

  /* ---- versão da base na nuvem ---- */
  async function remoteVersion() {
    const { data, error } = await sb.from('estado').select('versao').eq('id', 1).single(); if (error) fail(error); return Number(data.versao);
  }

  /* ---- descarregar tudo para a memória ---- */
  async function pull(conn, onProgress) {
    const v = await remoteVersion();
    conn.exec('BEGIN');
    try {
      for (const T of TABLES) {
        const ins = 'INSERT OR REPLACE INTO ' + T.t + '(' + T.cols.join(',') + ') VALUES(' + T.cols.map(() => '?').join(',') + ')';
        for (let from = 0; ; from += 1000) {
          let q = sb.from(T.t).select(T.cols.join(','));
          T.pk.forEach(c => { q = q.order(c, { ascending: true }); });
          const { data, error } = await q.range(from, from + 999); if (error) fail(error);
          data.forEach(r => conn.run(ins, T.cols.map(c => r[c] === undefined ? null : r[c])));
          if (onProgress) onProgress(T.t, from + data.length);
          if (data.length < 1000) break;
        }
      }
      setMeta(conn, 'versao_nuvem', v); conn.exec('COMMIT');
    } catch (e) { try { conn.exec('ROLLBACK'); } catch (e2) {} throw e; }
    DB.enableTracking(conn);                      // daqui em diante regista-se o que mudar
    return v;
  }

  /* ---- publicar só o que mudou (só o administrador) ---- */
  async function push(conn, onProgress) {
    const n = DB.pendingCount(conn); if (!n) return { enviadas: 0 };
    const v0 = Number(getMeta(conn, 'versao_nuvem'));
    if (await remoteVersion() !== v0) fail('A base na nuvem foi alterada entretanto. Clique em "Atualizar da nuvem" e repita.');
    let enviadas = 0;
    for (const T of TABLES) {
      const tr = DB.TRACK.find(x => x.t === T.t);
      const keys = conn.all('SELECT k FROM _alt WHERE t=?', [T.t]).map(r => r.k); if (!keys.length) continue;
      for (let i = 0; i < keys.length; i += T.batch) {
        const part = keys.slice(i, i + T.batch), rows = [];
        for (let j = 0; j < part.length; j += 300) {
          const ch = part.slice(j, j + 300);
          conn.all('SELECT ' + T.cols.join(',') + ' FROM ' + T.t + ' WHERE CAST(' + tr.k + ' AS TEXT) IN (' + ch.map(() => '?').join(',') + ')', ch).forEach(r => rows.push(r));
        }
        if (rows.length) { const { error } = await sb.from(T.t).upsert(rows, { onConflict: T.pk.join(',') }); if (error) fail(error); }
        enviadas += rows.length; if (onProgress) onProgress(T.t, enviadas, n);
      }
    }
    const { data, error } = await sb.from('estado').update({ versao: v0 + 1, atualizado_em: new Date().toISOString() }).eq('id', 1).eq('versao', v0).select();
    if (error) fail(error);
    if (!data || !data.length) fail('Outra pessoa publicou ao mesmo tempo. Clique em "Atualizar da nuvem" e repita.');
    setMeta(conn, 'versao_nuvem', v0 + 1); DB.clearTouched(conn);
    return { enviadas };
  }

  root.Cloud = { init, use, enabled, session, signIn, signOut, setPassword, resetPassword, role, pull, push, remoteVersion, TABLES };
})(typeof window !== 'undefined' ? window : globalThis);
