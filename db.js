// db.js — wrapper MySQL que expõe a mesma API que o antigo wrapper SQLite:
//   run(sql, params)  → { lastID, changes }
//   get(sql, params)  → row | null
//   all(sql, params)  → row[]
//
// As tabelas de usuários vêm do banco.sql; alertas_policia é garantida na
// inicialização para também funcionar com volumes MySQL criados anteriormente.

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
 * Garante a tabela de alertas em instalações novas e em volumes MySQL existentes.
 */
async function inicializarBanco() {
  // Garante que a conexão está viva antes de continuar.
  await testarConexao();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alertas_policia (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      protocolo VARCHAR(30) NOT NULL UNIQUE,
      cliente_id VARCHAR(100) NOT NULL,
      tipo VARCHAR(30) NOT NULL DEFAULT 'EMERGENCIA',
      status ENUM('ATIVO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FALSO_ALARME')
        NOT NULL DEFAULT 'ATIVO',
      prioridade ENUM('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL DEFAULT 'ALTA',
      quantidade_acionamentos INT NOT NULL DEFAULT 1,
      latitude DOUBLE,
      longitude DOUBLE,
      acuracia_metros DOUBLE,
      dispositivo VARCHAR(2000),
      ip_origem VARCHAR(45),
      origem VARCHAR(100) NOT NULL DEFAULT 'botao-emergencia-web',
      observacoes TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      encerrado_em TIMESTAMP NULL,
      INDEX idx_alertas_cliente (cliente_id),
      INDEX idx_alertas_status (status, criado_em),
      INDEX idx_alertas_tipo (tipo, criado_em),
      INDEX idx_alertas_criado (criado_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

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
