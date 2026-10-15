const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'root',
  database: process.env.MYSQL_DATABASE || 'projeto_denuncia',
  waitForConnections: true,
  connectionLimit: 10,
});

async function testarConexao() {
  await pool.query('SELECT 1 FROM atendentes LIMIT 0');
}

module.exports = { pool, testarConexao, fecharConexao: () => pool.end() };