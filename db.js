require('dotenv').config();

const { databaseConfig, pool } = require('./database/mysql');

async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return { lastID: result.insertId, changes: result.affectedRows };
}

async function get(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Garante a tabela de alertas em instalações novas e em volumes MySQL existentes.
 */
async function inicializarBanco() {
  await testarConexao();
}

async function testarConexao() {
  await pool.query('SELECT 1');
  await pool.query('SELECT 1 FROM atendentes LIMIT 0');
  await pool.query('SELECT 1 FROM denuncias LIMIT 0');
  await pool.query('SELECT 1 FROM localizacoes LIMIT 0');
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
  inicializarBanco,
  testarConexao,
  run,
  get,
  all,
  transaction,
  fecharBanco,
};
