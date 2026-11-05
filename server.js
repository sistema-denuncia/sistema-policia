require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const socketIo = require('socket.io');
const { databaseConfig, inicializarBanco, testarConexao, all, fecharBanco } = require('./db');
const { pool: mysqlPool } = require('./database/mysql');
const emergenciasRoute = require('./routes/emergencias');
const usuariosRoute = require('./routes/usuarios');
const { SELECT_DENUNCIA, formatarAlerta } = require('./lib/alertas');
const { contemTermoOfensivo, validarSenha } = require('./lib/credential-policy');

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

async function garantirTabelaUsuarios() {
  await mysqlPool.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      cpf VARCHAR(14) NOT NULL UNIQUE,
      data_nascimento DATE NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      senha VARCHAR(255) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function garantirTabelaAtendentes() {
  await mysqlPool.execute(`
    CREATE TABLE IF NOT EXISTS atendentes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      usuario VARCHAR(100) NOT NULL UNIQUE,
      data_nascimento DATE NULL,
      genero ENUM('MASCULINO', 'FEMININO') NULL,
      senha_hash CHAR(128) NULL,
      senha_salt CHAR(32) NULL,
      cargo ENUM('atendente', 'supervisor', 'administrador') DEFAULT 'atendente',
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [columns] = await mysqlPool.query('SHOW COLUMNS FROM atendentes');
  const columnNames = new Set(columns.map((column) => column.Field));
  if (!columnNames.has('senha_hash')) {
    await mysqlPool.query('ALTER TABLE atendentes ADD COLUMN senha_hash CHAR(128) NULL');
  }
  if (!columnNames.has('senha_salt')) {
    await mysqlPool.query('ALTER TABLE atendentes ADD COLUMN senha_salt CHAR(32) NULL');
  }
  if (!columnNames.has('data_nascimento')) {
    await mysqlPool.query('ALTER TABLE atendentes ADD COLUMN data_nascimento DATE NULL');
  }
  if (!columnNames.has('genero')) {
    await mysqlPool.query("ALTER TABLE atendentes ADD COLUMN genero ENUM('MASCULINO', 'FEMININO') NULL");
  }
  const legacyPasswordColumn = columns.find((column) => column.Field === 'senha');
  if (legacyPasswordColumn && legacyPasswordColumn.Null === 'NO') {
    await mysqlPool.query('ALTER TABLE atendentes MODIFY COLUMN senha VARCHAR(100) NULL');
  }
}

io.use((socket, next) => {
  const session = getSession(getSessionToken(socket.handshake.headers.cookie));
  if (!session) return next(new Error('Autenticação necessária.'));
  socket.data.usuario = session.usuario;
  next();
});

app.post('/api/auth/supervisor', async (req, res, next) => {
  const login = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase() : '';
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

  if (!login || !senha) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe usuário e senha.' });
  }
  if (contemTermoOfensivo(login) || contemTermoOfensivo(senha)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Login e senha não podem conter termos ofensivos.' });
  }

  try {
    const [supervisores] = await mysqlPool.execute(
      `SELECT id, nome, usuario, cargo, senha_hash, senha_salt
       FROM atendentes
       WHERE usuario = ? AND cargo = 'supervisor' AND ativo = 1
       LIMIT 1`,
      [login]
    );
    const row = supervisores[0];
    if (!row || !/^[\da-f]{32}$/i.test(row.senha_salt || '')
      || !/^[\da-f]{128}$/i.test(row.senha_hash || '')) {
      return res.status(401).json({ sucesso: false, mensagem: 'Login ou senha inválidos.' });
    }

    const hash = await scrypt(senha, row.senha_salt, 64);
    const hashSalvo = Buffer.from(row.senha_hash, 'hex');
    if (hashSalvo.length !== hash.length || !crypto.timingSafeEqual(hash, hashSalvo)) {
      return res.status(401).json({ sucesso: false, mensagem: 'Login ou senha inválidos.' });
    }

    const usuario = usuarioPublico(row);
    startSession(res, usuario);
    return res.json({ sucesso: true, usuario });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  const usuarioLogin = typeof req.body?.usuario === 'string' ? req.body.usuario.trim().toLowerCase() : '';
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  const cargoEsperado = req.body?.cargo;
  if (!usuarioLogin || !senha || !['ADMINISTRADOR', 'AGENTE'].includes(cargoEsperado)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe usuário, senha e um cargo válido.' });
  }
  if (contemTermoOfensivo(usuarioLogin) || contemTermoOfensivo(senha)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Login e senha não podem conter termos ofensivos.' });
  }

  try {
    const [rows] = await mysqlPool.execute(
      'SELECT id, nome, usuario, cargo, senha_hash, senha_salt FROM atendentes WHERE usuario = ? AND ativo = 1 LIMIT 1',
      [usuarioLogin]
    );
    const row = rows[0];
    if (!row || !/^[\da-f]{32}$/i.test(row.senha_salt || '')
      || !/^[\da-f]{128}$/i.test(row.senha_hash || '')) {
      return res.status(401).json({ sucesso: false, mensagem: 'Usuário ou senha inválidos.' });
    }

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
    const [result] = await mysqlPool.execute(
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
    const [usuarios] = await mysqlPool.execute(
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

function validarApiKey(req, res, next) {
  const chave = req.get('X-API-Key');
  if (!chave || chave !== API_KEY) {
    return res.status(401).json({ sucesso: false, mensagem: 'Chave de API inválida.' });
  }
  next();
}
app.get('/api/admin/usuarios', requireAuth, requireAdmin, async (req, res, next) => {
  if ((req.query.cargo !== undefined && typeof req.query.cargo !== 'string')
    || (req.query.data !== undefined && typeof req.query.data !== 'string')) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe filtros válidos.' });
  }

  const cargo = typeof req.query.cargo === 'string' ? req.query.cargo : '';
  const data = req.query.data;

  if (cargo && !['ADMINISTRADOR', 'AGENTE'].includes(cargo)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Cargo inválido.' });
  }

  const filtros = [];
  const parametros = [];
  if (cargo === 'AGENTE') {
    filtros.push("LOWER(TRIM(cargo)) IN ('atendente', 'agente')");
  } else if (cargo === 'ADMINISTRADOR') {
    filtros.push("LOWER(TRIM(cargo)) IN ('administrador', 'supervisor')");
  }

  if (data !== undefined && data !== '') {
    const partesData = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
    const dataIso = partesData
      ? `${partesData[3]}-${partesData[2]}-${partesData[1]}`
      : '';
    if (!dataValida(dataIso)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Informe a data no formato DD/MM/AAAA.' });
    }

    filtros.push('data_nascimento = ?');
    parametros.push(dataIso);
  }

  try {
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    const [atendentes] = await mysqlPool.execute(
      `SELECT id, nome, usuario, genero, cargo, ativo,
              DATE_FORMAT(data_nascimento, '%Y-%m-%d') AS dataNascimento, criado_em
       FROM atendentes ${where}
       ORDER BY nome`,
      parametros
    );
    const usuarios = atendentes.map((row) => ({
      ...usuarioPublico(row),
      genero: row.genero,
      dataNascimento: row.dataNascimento,
      ativo: Boolean(row.ativo),
      criadoEm: row.criado_em,
    }));
    return res.json({ sucesso: true, usuarios });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/admin/estatisticas', requireAuth, requireAdmin, async (req, res, next) => {
  const periodo = req.query.periodo;
  const data = req.query.data;
  if ((periodo !== undefined && typeof periodo !== 'string')
    || (data !== undefined && typeof data !== 'string')) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe um período válido.' });
  }

  const periodoFinal = periodo || 'mes';
  const dataAtual = new Date();
  const anoAtual = dataAtual.getFullYear();
  const dataPadrao = periodoFinal === 'ano'
    ? String(anoAtual)
    : `${anoAtual}-${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;
  const dataFinal = data || dataPadrao;
  let inicio;
  let fim;
  let formatoSerie;

  if (periodoFinal === 'mes') {
    const correspondencia = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(dataFinal);
    if (!correspondencia || Number(correspondencia[1]) < 1000
      || Number(correspondencia[1]) > anoAtual) {
      return res.status(400).json({ sucesso: false, mensagem: 'Selecione um mês válido.' });
    }
    const ano = Number(correspondencia[1]);
    const mes = Number(correspondencia[2]);
    inicio = `${dataFinal}-01`;
    fim = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
    formatoSerie = '%Y-%m-%d';
  } else if (periodoFinal === 'ano' && /^\d{4}$/.test(dataFinal)
    && Number(dataFinal) >= 1000 && Number(dataFinal) <= anoAtual) {
    inicio = `${dataFinal}-01-01`;
    fim = `${Number(dataFinal) + 1}-01-01`;
    formatoSerie = '%Y-%m';
  } else {
    return res.status(400).json({
      sucesso: false,
      mensagem: periodoFinal === 'ano' ? 'Selecione um ano válido.' : 'Período inválido.',
    });
  }

  const parametros = [`${inicio} 00:00:00`, `${fim} 00:00:00`];
  const numeroIntervalos = periodoFinal === 'mes'
    ? new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)), 0)).getUTCDate()
    : 12;

  try {
    const [resumoRows] = await mysqlPool.execute(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(status IN ('ATIVO', 'EM_ATENDIMENTO')), 0) AS abertos,
        COALESCE(SUM(status = 'RESOLVIDO'), 0) AS resolvidos,
        COALESCE(SUM(status = 'FALSO_ALARME'), 0) AS falsosAlarmes,
        COALESCE(SUM(prioridade = 'CRITICA'), 0) AS criticos
      FROM denuncias
      WHERE criado_em >= ? AND criado_em < ?
    `, parametros);
    const [statusRows] = await mysqlPool.execute(
      'SELECT status, COUNT(*) AS total FROM denuncias WHERE criado_em >= ? AND criado_em < ? GROUP BY status',
      parametros
    );
    const [prioridadeRows] = await mysqlPool.execute(
      'SELECT prioridade, COUNT(*) AS total FROM denuncias WHERE criado_em >= ? AND criado_em < ? GROUP BY prioridade',
      parametros
    );
    const [serieRows] = await mysqlPool.execute(
      `SELECT DATE_FORMAT(criado_em, '${formatoSerie}') AS periodo, COUNT(*) AS total
       FROM denuncias
       WHERE criado_em >= ? AND criado_em < ?
       GROUP BY DATE_FORMAT(criado_em, '${formatoSerie}')`,
      parametros
    );

    const serieRegistrada = new Map(serieRows.map((row) => [row.periodo, Number(row.total)]));
    const serie = Array.from({ length: numeroIntervalos }, (_, indice) => {
      const dataPeriodo = periodoFinal === 'mes'
        ? new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)) - 1, indice + 1))
        : new Date(Date.UTC(Number(inicio.slice(0, 4)), indice, 1));
      const periodoFormatado = periodoFinal === 'mes'
        ? dataPeriodo.toISOString().slice(0, 10)
        : dataPeriodo.toISOString().slice(0, 7);
      return { periodo: periodoFormatado, total: serieRegistrada.get(periodoFormatado) || 0 };
    });

    return res.json({
      sucesso: true,
      periodo: periodoFinal,
      data: dataFinal,
      resumo: Object.fromEntries(
        Object.entries(resumoRows[0]).map(([chave, valor]) => [chave, Number(valor)])
      ),
      porStatus: statusRows.map((row) => ({ status: row.status, total: Number(row.total) })),
      porPrioridade: prioridadeRows.map((row) => ({ prioridade: row.prioridade, total: Number(row.total) })),
      serie,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/usuarios', requireAuth, requireAdmin, async (req, res, next) => {
  const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
  const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim().toLowerCase() : '';
  const dataNascimento = typeof req.body?.dataNascimento === 'string' ? req.body.dataNascimento : '';
  const genero = req.body?.genero;
  const cargo = req.body?.cargo;
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

  if (nome.length < 2 || nome.length > 100) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe um nome entre 2 e 100 caracteres.' });
  }
  if (usuario.length < 3 || usuario.length > 32) {
    return res.status(400).json({ sucesso: false, mensagem: 'O usuário deve ter de 3 a 32 caracteres.' });
  }
  if (contemTermoOfensivo(usuario)) {
    return res.status(400).json({ sucesso: false, mensagem: 'O usuário não pode conter termos ofensivos.' });
  }
  if (!dataValida(dataNascimento) || dataNascimento > new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe uma data de nascimento válida.' });
  }
  if (!['MASCULINO', 'FEMININO'].includes(genero)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Selecione um gênero válido.' });
  }
  if (!['ADMINISTRADOR', 'AGENTE'].includes(cargo)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Cargo inválido.' });
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) {
    return res.status(400).json({ sucesso: false, mensagem: erroSenha });
  }

  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(senha, salt, 64);
    const [result] = await mysqlPool.execute(
      'INSERT INTO atendentes (nome, usuario, data_nascimento, genero, cargo, senha_hash, senha_salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nome, usuario, dataNascimento, genero, cargoAtendente(cargo), hash.toString('hex'), salt]
    );
    res.status(201).json({
      sucesso: true,
      usuario: { id: result.insertId, nome, usuario, dataNascimento, genero, cargo },
    });
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

app.use('/api/usuarios', validarApiKey, usuariosRoute);
app.use('/api/emergencia', (req, res, next) => {
  if (req.method !== 'POST') return next();
  validarApiKey(req, res, next);
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
      bancoServidor: `${databaseConfig.host}:${databaseConfig.port}`,
      bancoNome: databaseConfig.database,
      bancoAtendentes: 'online',
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
    const [ativas, recentes] = await Promise.all([
      all(`${SELECT_DENUNCIA} WHERE d.status = 'ATIVO' ORDER BY d.criado_em DESC, d.id DESC`),
      all(`${SELECT_DENUNCIA} WHERE d.status <> 'ATIVO' ORDER BY d.criado_em DESC, d.id DESC LIMIT 100`),
    ]);
    const alertas = [...ativas, ...recentes].map(formatarAlerta);

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
    await garantirTabelaUsuarios();
    await garantirTabelaAtendentes();
    await inicializarBanco();
    await testarConexao();

    console.log('MySQL conectado com sucesso.');
    console.log(`Banco: ${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.database}`);

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
