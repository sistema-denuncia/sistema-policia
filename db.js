require('dotenv').config();

const mysql = require('mysql2/promise');

const databaseConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'projeto_denuncia',
};

const pool = mysql.createPool({
  ...databaseConfig,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
});

async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return { lastID: result.insertId, changes: result.affectedRows };
}

async function get(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
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

  await run(`
    CREATE TABLE IF NOT EXISTS atendentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
      senha_hash TEXT NOT NULL,
      senha_salt TEXT NOT NULL,
      cargo TEXT NOT NULL DEFAULT 'atendente'
        CHECK (cargo IN ('atendente', 'supervisor', 'administrador')),
      ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const tabelaAntiga = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usuarios_sistema'"
  );
  if (tabelaAntiga) {
    await run(`
      INSERT INTO atendentes (nome, usuario, senha_hash, senha_salt, cargo, ativo, criado_em)
      SELECT nome, usuario, senha_hash, senha_salt,
        CASE cargo WHEN 'AGENTE' THEN 'atendente' ELSE 'administrador' END,
        1, criado_em
      FROM usuarios_sistema
    `);
    await run('DROP TABLE usuarios_sistema');
  }

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
  await get('SELECT 1 AS online FROM denuncias LIMIT 1');
}

function fecharBanco() {
  return pool.end();
}

async function transaction(callback) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback({
      run: async (sql, params = []) => {
        const [queryResult] = await connection.execute(sql, params);
        return { lastID: queryResult.insertId, changes: queryResult.affectedRows };
      },
      get: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows[0] || null;
      },
    });
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Erro ao desfazer transação MySQL:', rollbackError);
    }
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  databaseConfig,
  testarConexao,
  run,
  get,
  all,
  transaction,
  fecharBanco,
};
