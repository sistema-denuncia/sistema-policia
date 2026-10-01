const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const databaseDir = path.join(__dirname, 'database');
const databaseFile = path.join(databaseDir, 'emergencia.db');

fs.mkdirSync(databaseDir, { recursive: true });

const db = new sqlite3.Database(databaseFile);

db.configure('busyTimeout', 5000);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function inicializarBanco() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');

  await run(`
    CREATE TABLE IF NOT EXISTS alertas_policia (
      id TEXT NOT NULL PRIMARY KEY,
      protocolo TEXT NOT NULL UNIQUE,
      cliente_id TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'EMERGENCIA',
      status TEXT NOT NULL DEFAULT 'ATIVO'
        CHECK (status IN ('ATIVO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FALSO_ALARME')),
      prioridade TEXT NOT NULL DEFAULT 'ALTA'
        CHECK (prioridade IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
      quantidade_acionamentos INTEGER NOT NULL DEFAULT 1,
      latitude REAL,
      longitude REAL,
      acuracia_metros REAL,
      dispositivo TEXT,
      ip_origem TEXT,
      origem TEXT NOT NULL DEFAULT 'botao-emergencia-web',
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      encerrado_em TEXT
    )
  `);

  const colunas = await all('PRAGMA table_info(alertas_policia)');
  if (!colunas.some((coluna) => coluna.name === 'quantidade_acionamentos')) {
    await run(`ALTER TABLE alertas_policia
               ADD COLUMN quantidade_acionamentos INTEGER NOT NULL DEFAULT 1`);
  }

  await run(`CREATE INDEX IF NOT EXISTS idx_alertas_status_criado
             ON alertas_policia (status, criado_em DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_alertas_tipo_criado
             ON alertas_policia (tipo, criado_em DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_alertas_criado
             ON alertas_policia (criado_em DESC)`);
}

async function testarConexao() {
  await get('SELECT 1 AS online');
}

function fecharBanco() {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

module.exports = {
  databaseFile,
  inicializarBanco,
  testarConexao,
  run,
  get,
  all,
  fecharBanco,
};
