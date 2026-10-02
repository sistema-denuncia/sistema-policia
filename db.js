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

async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
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
