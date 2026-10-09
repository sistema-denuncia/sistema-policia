const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { get, run } = require('../db');

const scrypt = promisify(crypto.scrypt);
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcularDigito = (base, pesoInicial) => {
    const soma = [...base].reduce(
      (total, digito, indice) => total + Number(digito) * (pesoInicial - indice),
      0
    );
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcularDigito(cpf.slice(0, 9), 10) === Number(cpf[9])
    && calcularDigito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function dataValida(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return false;
  const [ano, mes, dia] = data.split('-').map(Number);
  const valor = new Date(Date.UTC(ano, mes - 1, dia));
  return valor.getUTCFullYear() === ano
    && valor.getUTCMonth() === mes - 1
    && valor.getUTCDate() === dia
    && valor <= new Date();
}

router.post('/', async (req, res, next) => {
  const { nome, cpf, dataNascimento, email, senha } = req.body || {};
  const nomeFinal = typeof nome === 'string' ? nome.trim() : '';
  const cpfFinal = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
  const emailFinal = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (nomeFinal.length < 2 || nomeFinal.length > 100) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe seu nome completo.' });
  }
  if (!cpfValido(cpfFinal)) {
    return res.status(400).json({ sucesso: false, mensagem: 'CPF inválido.' });
  }
  if (!dataValida(dataNascimento)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Data de nascimento inválida.' });
  }
  if (emailFinal.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFinal)) {
    return res.status(400).json({ sucesso: false, mensagem: 'E-mail inválido.' });
  }
  if (typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'A senha deve ter entre 6 e 128 caracteres.',
    });
  }

  try {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(senha, salt, 64);
    const senhaArmazenada = `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
    const result = await run(
      `INSERT INTO usuarios (nome, cpf, data_nascimento, email, senha)
       VALUES (?, ?, ?, ?, ?)`,
      [nomeFinal, cpfFinal, dataNascimento, emailFinal, senhaArmazenada]
    );

    res.status(201).json({
      sucesso: true,
      mensagem: 'Cadastro realizado. Entre com seu e-mail e senha.',
      usuario: { id: result.lastID, nome: nomeFinal, email: emailFinal },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        sucesso: false,
        mensagem: 'Este CPF ou e-mail já está cadastrado.',
      });
    }
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';
  const senha = req.body?.senha;

  if (!email || typeof senha !== 'string') {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe e-mail e senha.' });
  }

  try {
    const usuario = await get(
      'SELECT id, nome, email, senha FROM usuarios WHERE email = ?',
      [email]
    );

    if (!usuario) {
      return res.status(401).json({ sucesso: false, mensagem: 'E-mail ou senha inválidos.' });
    }

    const [algoritmo, saltHex, hashHex] = usuario.senha.split(':');
    if (algoritmo !== 'scrypt' || !/^[a-f\d]{32}$/i.test(saltHex || '')
      || !/^[a-f\d]{128}$/i.test(hashHex || '')) {
      console.error(`Formato de senha não suportado para o usuário ${usuario.id}.`);
      return res.status(500).json({
        sucesso: false,
        mensagem: 'A conta precisa redefinir a senha para usar o acesso seguro.',
      });
    }

    const hashSalvo = Buffer.from(hashHex, 'hex');
    const hashInformado = await scrypt(senha, Buffer.from(saltHex, 'hex'), hashSalvo.length);
    if (!crypto.timingSafeEqual(hashSalvo, hashInformado)) {
      return res.status(401).json({ sucesso: false, mensagem: 'E-mail ou senha inválidos.' });
    }

    res.json({
      sucesso: true,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
