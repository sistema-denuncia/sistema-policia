// db.js — wrapper MySQL que expõe a mesma API que o antigo wrapper SQLite:
//   run(sql, params)  → { lastID, changes }
//   get(sql, params)  → row | null
//   all(sql, params)  → row[]
//
// Todas as tabelas (incluindo alertas_policia) são criadas pelo banco.sql
// carregado pelo Docker ao iniciar o container.

const { pool, testarConexao, fecharConexao } = require('./database/mysql');

/**
 * Executa uma query de escrita (INSERT / UPDATE / DELETE).
 * Retorna { lastID, changes } para manter compatibilidade com o SQLite anterior.
 */
async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return {
    lastID: result.insertId ?? null,
    changes: result.affectedRows ?? 0,
  };
}

/**
 * Retorna a primeira linha do resultado ou null.
 */
async function get(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] ?? null;
}

/**
 * Retorna todas as linhas do resultado.
 */
async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Inicializa o banco — no SQLite criávamos as tabelas aqui,
 * mas no MySQL elas já existem via banco.sql (docker-entrypoint-initdb.d).
 * Mantemos a função para não quebrar a chamada em server.js.
 */
async function inicializarBanco() {
  // Garante que a conexão está viva antes de continuar.
  await testarConexao();

  const [indexes] = await pool.query(
    `SELECT INDEX_NAME, NON_UNIQUE, COUNT(*) AS COLUMN_COUNT,
            MAX(CASE WHEN SEQ_IN_INDEX = 1 THEN COLUMN_NAME END) AS FIRST_COLUMN
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'alertas_policia'
     GROUP BY INDEX_NAME, NON_UNIQUE`
  );

  for (const index of indexes) {
    if (Number(index.NON_UNIQUE) === 0 && Number(index.COLUMN_COUNT) === 1
      && index.FIRST_COLUMN === 'cliente_id') {
      const indexName = String(index.INDEX_NAME).replace(/`/g, '``');
      await pool.query(`ALTER TABLE alertas_policia DROP INDEX \`${indexName}\``);
    }
  }

  const possuiIndiceCliente = indexes.some((index) => (
    Number(index.COLUMN_COUNT) === 1 && index.FIRST_COLUMN === 'cliente_id'
      && Number(index.NON_UNIQUE) !== 0
  ));

  if (!possuiIndiceCliente) {
    await pool.query('CREATE INDEX idx_alertas_cliente ON alertas_policia (cliente_id)');
  }
}

module.exports = {
  pool,
  run,
  get,
  all,
  inicializarBanco,
  testarConexao,
  fecharBanco: fecharConexao,
};
