require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const socketIo = require('socket.io');
const { inicializarBanco, testarConexao, run, get, all, fecharBanco, pool } = require('./db');
const emergenciasRoute = require('./routes/emergencias');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.PAINEL_ORIGIN || '*',
    methods: ['GET', 'POST', 'PATCH'],
  },
});

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST;
const API_KEY = process.env.POLICIA_API_KEY || 'desenvolvimento-local';
const SUPERVISOR_LOGIN = process.env.SUPERVISOR_LOGIN || 'supervisor';
const SUPERVISOR_SENHA = process.env.SUPERVISOR_SENHA || 'Supervisor@123';
const SESSION_COOKIE = 'policia_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const scrypt = promisify(crypto.scrypt);

app.set('io', io);
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(express.json({ limit: '64kb' }));
app.get('/', (req, res) => res.redirect('/primeira-tela-login.html'));
app.use(express.static(path.join(__dirname, 'public')));

function getSessionToken(cookieHeader = '') {
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function startSession(res, usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { usuario, expiresAt: Date.now() + SESSION_TTL_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function requireAuth(req, res, next) {
  const session = getSession(getSessionToken(req.headers.cookie));
  if (!session) {
    return res.status(401).json({ sucesso: false, mensagem: 'Faça login para continuar.' });
  }
  req.usuario = session.usuario;
  next();
}

function requireAdmin(req, res, next) {
  if (req.usuario.cargo !== 'ADMINISTRADOR') {
    return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito à administração.' });
  }
  next();
}

function usuarioPublico(row) {
  return {
    id: row.id,
    nome: row.nome,
    usuario: row.usuario,
    cargo: row.cargo === 'atendente' ? 'AGENTE' : 'ADMINISTRADOR',
  };
}

function cargoAtendente(cargo) {
  return cargo === 'AGENTE' ? 'atendente' : 'administrador';
}

function requireApiKey(req, res, next) {
  if (req.get('X-API-Key') !== API_KEY) {
    return res.status(401).json({ sucesso: false, mensagem: 'Chave de API inválida.' });
  }
  return next();
}

function dataValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const parsed = new Date(`${data}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === data;
}

async function criarHashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(senha, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verificarHashSenha(senha, senhaSalva) {
  const [algoritmo, salt, hashSalvoHex] = String(senhaSalva).split('$');
  if (algoritmo !== 'scrypt' || !/^[\da-f]{32}$/i.test(salt || '')
    || !/^[\da-f]{128}$/i.test(hashSalvoHex || '')) {
    return false;
  }
  const hashSalvo = Buffer.from(hashSalvoHex, 'hex');
  const hashRecebido = await scrypt(senha, salt, 64);
  return crypto.timingSafeEqual(hashSalvo, hashRecebido);
}



io.use((socket, next) => {
  const session = getSession(getSessionToken(socket.handshake.headers.cookie));
  if (!session) return next(new Error('Autenticação necessária.'));
  socket.data.usuario = session.usuario;
  next();
});

app.post('/api/auth/supervisor', (req, res) => {
  const { login, senha } = req.body || {};

  if (login !== SUPERVISOR_LOGIN || senha !== SUPERVISOR_SENHA) {
    return res.status(401).json({ sucesso: false, mensagem: 'Login ou senha inválidos.' });
  }

  const usuario = { id: 'supervisor', nome: 'Supervisor', usuario: SUPERVISOR_LOGIN, cargo: 'ADMINISTRADOR' };
  startSession(res, usuario);
  res.json({ sucesso: true, usuario });
});

app.post('/api/auth/login', async (req, res, next) => {
  const usuarioLogin = typeof req.body?.usuario === 'string' ? req.body.usuario.trim().toLowerCase() : '';
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  const cargoEsperado = req.body?.cargo;
  if (!usuarioLogin || !senha || !['ADMINISTRADOR', 'AGENTE'].includes(cargoEsperado)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe usuário, senha e um cargo válido.' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, nome, usuario, cargo, senha_hash, senha_salt FROM atendentes WHERE usuario = ? AND ativo = 1 LIMIT 1',
      [usuarioLogin]
    );
    const row = rows[0];
    if (!row) return res.status(401).json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });

    const hash = await scrypt(senha, row.senha_salt, 64);
    const hashSalvo = Buffer.from(row.senha_hash, 'hex');
    if (hashSalvo.length !== hash.length || !crypto.timingSafeEqual(hash, hashSalvo)) {
      return res.status(401).json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });
    }
    if (usuarioPublico(row).cargo !== cargoEsperado) {
      return res.status(401).json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });
    }

    const usuario = usuarioPublico(row);
    startSession(res, usuario);
    res.json({ sucesso: true, usuario });
  } catch (err) {
    next(err);
  }
});

app.post('/api/usuarios', requireApiKey, async (req, res, next) => {
  const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
  const cpf = typeof req.body?.cpf === 'string' ? req.body.cpf.replace(/\D/g, '') : '';
  const dataNascimento = req.body?.dataNascimento;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const senha = req.body?.senha;

  if (nome.length < 2 || nome.length > 100) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe um nome entre 2 e 100 caracteres.' });
  }
  if (!/^\d{11}$/.test(cpf)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe um CPF válido.' });
  }
  if (!dataValida(dataNascimento)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe uma data de nascimento válida.' });
  }
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe um e-mail válido.' });
  }
  if (typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
    return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter entre 6 e 128 caracteres.' });
  }

  try {
    const senhaHash = await criarHashSenha(senha);
    const [result] = await pool.execute(
      'INSERT INTO usuarios (nome, cpf, data_nascimento, email, senha) VALUES (?, ?, ?, ?, ?)',
      [nome, cpf, dataNascimento, email, senhaHash]
    );
    return res.status(201).json({
      sucesso: true,
      usuario: { id: result.insertId, nome, email },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ sucesso: false, mensagem: 'CPF ou e-mail já cadastrado.' });
    }
    return next(err);
  }
});

app.post('/api/usuarios/login', requireApiKey, async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  if (!email || !senha) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe e-mail e senha.' });
  }

  try {
    const [usuarios] = await pool.execute(
      'SELECT id, nome, email, senha FROM usuarios WHERE email = ? LIMIT 1',
      [email]
    );
    const usuario = usuarios[0];
    if (!usuario || !(await verificarHashSenha(senha, usuario.senha))) {
      return res.status(401).json({ sucesso: false, mensagem: 'E-mail ou senha inválidos.' });
    }
    return res.json({
      sucesso: true,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ sucesso: true, usuario: req.usuario });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getSessionToken(req.headers.cookie);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ sucesso: true });
});

app.get('/api/admin/usuarios', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [atendentes] = await pool.execute('SELECT id, nome, usuario, cargo, ativo, criado_em FROM atendentes ORDER BY nome');
    const usuarios = atendentes.map((row) => ({
      ...usuarioPublico(row),
      ativo: Boolean(row.ativo),
      criadoEm: row.criado_em,
    }));
    res.json({ sucesso: true, usuarios });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/usuarios', requireAuth, requireAdmin, async (req, res, next) => {
  const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
  const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim().toLowerCase() : '';
  const cargo = req.body?.cargo;
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

  if (nome.length < 2 || nome.length > 100) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe um nome entre 2 e 100 caracteres.' });
  }
  if (usuario.length < 3 || usuario.length > 32) {
    return res.status(400).json({ sucesso: false, mensagem: 'O usuário deve ter de 3 a 32 caracteres.' });
  }
  if (!['ADMINISTRADOR', 'AGENTE'].includes(cargo)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Cargo inválido.' });
  }
  if (senha.length < 6 || !/[A-Z]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
    return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 6 caracteres, uma letra maiúscula e um caractere especial.' });
  }

  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(senha, salt, 64);
    const [result] = await pool.execute(
      'INSERT INTO atendentes (nome, usuario, cargo, senha_hash, senha_salt) VALUES (?, ?, ?, ?, ?)',
      [nome, usuario, cargoAtendente(cargo), hash.toString('hex'), salt]
    );
    res.status(201).json({ sucesso: true, usuario: { id: result.insertId, nome, usuario, cargo } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já está cadastrado.' });
    }
    next(err);
  }
});

app.use('/api/emergencia', (req, res, next) => {
  if (req.method === 'POST') {
    const chave = req.get('X-API-Key');
    if (!chave || chave !== API_KEY) {
      return res.status(401).json({ sucesso: false, mensagem: 'Chave de API inválida.' });
    }
    return next();
  }
  return requireAuth(req, res, next);
});

app.use('/api/emergencia', emergenciasRoute);

app.get('/api/saude', async (req, res) => {
  try {
    await testarConexao();
    res.json({
      sucesso: true,
      servidor: 'online',
      banco: 'online',
      bancoTipo: 'MySQL',
    });
  } catch (err) {
    res.status(503).json({ sucesso: false, servidor: 'online', banco: 'offline' });
  }
});

app.use((req, res) => {
  res.status(404).json({ erro: `Rota "${req.method} ${req.path}" não encontrada.` });
});

app.use((err, req, res, next) => {
  console.error('Erro inesperado:', err);
  res.status(500).json({ sucesso: false, mensagem: 'Erro interno no servidor.' });
});

io.on('connection', async (socket) => {
  try {
    const rows = await all(
      'SELECT * FROM alertas_policia ORDER BY criado_em DESC LIMIT 100'
    );

    const alertas = rows.map((row) => ({
      id: row.id,
      protocolo: row.protocolo,
      clienteId: row.cliente_id,
      tipo: row.tipo,
      status: row.status,
      prioridade: row.prioridade,
      quantidadeAcionamentos: row.quantidade_acionamentos || 1,
      localizacao: row.latitude === null && row.longitude === null ? null : {
        latitude: row.latitude,
        longitude: row.longitude,
      },
      dispositivo: row.dispositivo,
      ipOrigem: row.ip_origem,
      origem: row.origem,
      observacoes: row.observacoes,
      timestamp: row.criado_em,
      atualizadoEm: row.atualizado_em,
      encerradoEm: row.encerrado_em,
    }));

    socket.emit('carregar-alertas', alertas);
  } catch (err) {
    console.error('Erro ao carregar alertas no Socket.IO:', err);
  }

  io.emit('usuarios-conectados', io.engine.clientsCount);

  socket.on('disconnect', () => {
    io.emit('usuarios-conectados', io.engine.clientsCount);
  });
});

async function iniciar() {
  try {
    await inicializarBanco();

    console.log('MySQL conectado com sucesso.');

    const hostForUrl = HOST?.includes(':') ? `[${HOST}]` : HOST || 'localhost';
    server.listen({ port: PORT, ...(HOST ? { host: HOST } : {}) }, () => {
      console.log(`Sistema policial disponível em http://${hostForUrl}:${PORT}`);
      console.log(`Saúde: http://${hostForUrl}:${PORT}/api/saude`);
    });
  } catch (err) {
    console.error('Não foi possível iniciar o sistema.');
    console.error(err);
    process.exit(1);
  }
}

async function encerrar(signal) {
  console.log(`Encerrando (${signal})...`);
  server.close(async () => {
    try {
      await fecharBanco();
    } finally {
      process.exit(0);
    }
  });
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

iniciar();
