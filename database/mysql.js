const mysql = require('mysql2/promise');

const databaseConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'root',
  database: process.env.MYSQL_DATABASE || 'projeto_denuncia',
};

const pool = mysql.createPool({
  ...databaseConfig,
  waitForConnections: true,
  connectionLimit: 10,
});

async function testarConexao() {
  await pool.query('SELECT 1 FROM atendentes LIMIT 0');
}

module.exports = { databaseConfig, pool, testarConexao, fecharConexao: () => pool.end() };