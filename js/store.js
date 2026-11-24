/* AGROPERIT Parcelário – guarda a base de dados (SQLite) compactada, no navegador e em ficheiro */
(function (root) {
  'use strict';
  const CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/';
  let SQL = null, db = null, persist = true;
  const info = { raw: 0, gz: 0, em: null, guardadoNoNavegador: false };

  const conn = {
    exec(sql) { db.exec(sql); },
    run(sql, p) { db.run(sql, (p || []).map(v => v === undefined ? null : v)); },
    all(sql, p) {
      const st = db.prepare(sql);
      try { if (p && p.length) st.bind(p.map(v => v === undefined ? null : v)); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
      finally { st.free(); }
    },
    lastId() { return db.exec('SELECT last_insert_rowid()')[0].values[0][0]; }
  };

  async function pipe(bytes, stream) {
    const w = stream.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  const gzip = bytes => pipe(bytes, new CompressionStream('gzip'));
  const gunzip = bytes => pipe(bytes, new DecompressionStream('gzip'));

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('agroperit-parcelario', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function kv(mode, fn) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), s = t.objectStore('kv'), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); }

  async function init() {
    if (typeof initSqlJs === 'undefined') throw new Error('Não consegui carregar o motor da base de dados (precisa de internet na primeira vez).');
    SQL = await initSqlJs({ locateFile: f => CDN + f });
    let bytes = null;
    try { const saved = await kv('readonly', s => s.get('bd')); if (saved && saved.bytes) { bytes = await gunzip(saved.bytes); info.guardadoNoNavegador = true; } } catch (e) {}
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    DB.ensureSchema(conn);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  }

  async function save() {
    if (!persist) return;
    const raw = db.export(); const gz = await gzip(raw);
    info.raw = raw.length; info.gz = gz.length; info.em = new Date();
    try { await kv('readwrite', s => s.put({ bytes: gz, em: info.em.toISOString() }, 'bd')); info.guardadoNoNavegador = true; }
    catch (e) { info.guardadoNoNavegador = false; throw new Error('Não foi possível guardar no navegador. Guarde uma cópia em ficheiro.'); }
  }

  async function initMemory() {            // modo nuvem: nada fica guardado no navegador
    if (typeof initSqlJs === 'undefined') throw new Error('Não consegui carregar o motor da base de dados (precisa de internet).');
    SQL = await initSqlJs({ locateFile: f => CDN + f }); persist = false; reset();
  }
  function reset() { try { if (db) db.close(); } catch (e) {} db = new SQL.Database(); DB.ensureSchema(conn); }

  async function fileBytes(compressed) {
    db.exec('VACUUM'); const raw = db.export();
    return compressed ? gzip(raw) : raw;
  }

  async function openFile(file) {
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
    if (String.fromCharCode(...bytes.slice(0, 15)) !== 'SQLite format 3') throw new Error('Este ficheiro não é uma base de dados AGROPERIT.');
    const nova = new SQL.Database(bytes);
    const velha = db; db = nova;
    try { DB.ensureSchema(conn); conn.all('SELECT COUNT(*) AS n FROM v_item'); } catch (e) { db = velha; throw new Error('Este ficheiro não tem a estrutura esperada.'); }
    try { velha.close(); } catch (e) {}
    await save();
  }

  root.Store = { init, initMemory, reset, save, fileBytes, openFile, conn, info };
})(typeof window !== 'undefined' ? window : globalThis);
