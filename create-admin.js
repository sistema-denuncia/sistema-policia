/**
 * Reseta/cria a senha do administrador na tabela `atendentes`.
 *
 * - Se o usuário JÁ EXISTE → atualiza a senha.
 * - Se NÃO EXISTE → insere um novo.
 *
 * Uso: node create-admin.js
 * Altere as variáveis abaixo antes de rodar.
 */

require('dotenv').config();
const crypto = require('crypto');
const { promisify } = require('util');
const { pool } = require('./db');

const scrypt = promisify(crypto.scrypt);

// ─── Configure aqui ───────────────────────────────────────────────
const NOME    = 'Administrador';
const USUARIO = 'admin';
const SENHA   = 'Admin@123';   // mín. 6 chars, 1 maiúscula, 1 especial
const CARGO   = 'administrador'; // 'atendente' | 'supervisor' | 'administrador'
// ──────────────────────────────────────────────────────────────────

async function main() {
  const salt     = crypto.randomBytes(16).toString('hex');  // 32 chars hex
  const hash     = await scrypt(SENHA, salt, 64);           // 128 chars hex
  const senhaHash = hash.toString('hex');

  // Verifica se o usuário já existe
  const [[existente]] = await pool.execute(
    'SELECT id FROM atendentes WHERE usuario = ? LIMIT 1',
    [USUARIO]
  );

  if (existente) {
    await pool.execute(
      'UPDATE atendentes SET nome = ?, senha_hash = ?, senha_salt = ?, cargo = ?, ativo = 1 WHERE id = ?',
      [NOME, senhaHash, salt, CARGO, existente.id]
    );
    console.log(`\n✅ Senha do admin resetada! id = ${existente.id}`);
  } else {
    const [result] = await pool.execute(
      `INSERT INTO atendentes (nome, usuario, senha_hash, senha_salt, cargo, ativo)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [NOME, USUARIO, senhaHash, salt, CARGO]
    );
    console.log(`\n✅ Admin criado com sucesso! id = ${result.insertId}`);
  }

  console.log(`   Login : ${USUARIO}`);
  console.log(`   Senha : ${SENHA}`);

  await pool.end();
}

main().catch((err) => {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
});

