require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const { databaseConfig, testarConexao, all, fecharBanco } = require('./db');
const emergenciasRoute = require('./routes/emergencias');
const usuariosRoute = require('./routes/usuarios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.PAINEL_ORIGIN || '*',
    methods: ['GET', 'POST', 'PATCH'],
  },
});

const PORT = Number(process.env.PORT || 3001);
const API_KEY = process.env.POLICIA_API_KEY || 'desenvolvimento-local';
const SUPERVISOR_LOGIN = process.env.SUPERVISOR_LOGIN || 'supervisor';
const SUPERVISOR_SENHA = process.env.SUPERVISOR_SENHA || 'Supervisor@123';

app.set('io', io);
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/supervisor', (req, res) => {
  const { login, senha } = req.body || {};

  if (login !== SUPERVISOR_LOGIN || senha !== SUPERVISOR_SENHA) {
    return res.status(401).json({ sucesso: false, mensagem: 'Login ou senha inválidos.' });
  }

  res.json({ sucesso: true });
});

function validarApiKey(req, res, next) {
  const chave = req.get('X-API-Key');
  if (!chave || chave !== API_KEY) {
    return res.status(401).json({ sucesso: false, mensagem: 'Chave de API inválida.' });
  }
  next();
}

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
      `SELECT d.*,
              l.latitude AS localizacao_latitude,
              l.longitude AS localizacao_longitude,
              l.acuracia_metros AS localizacao_acuracia_metros
       FROM denuncias d
       LEFT JOIN localizacoes l ON l.id = (
         SELECT l2.id
         FROM localizacoes l2
         WHERE l2.denuncia_id = d.id
         ORDER BY l2.registrado_em DESC, l2.id DESC
         LIMIT 1
       )
       ORDER BY d.criado_em DESC
       LIMIT 100`
    );

    const alertas = rows.map((row) => ({
      id: row.id,
      protocolo: row.protocolo,
      clienteId: String(row.usuario_id),
      tipo: row.tipo,
      status: row.status,
      prioridade: row.prioridade,
      quantidadeAcionamentos: row.quantidade_acionamentos || 1,
      localizacao: row.localizacao_latitude === null ? null : {
        latitude: row.localizacao_latitude,
        longitude: row.localizacao_longitude,
        acuraciaMetros: row.localizacao_acuracia_metros,
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
    await testarConexao();

    console.log('MySQL conectado com sucesso.');
    console.log(`Banco: ${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.database}`);

    server.listen(PORT, () => {
      console.log(`Sistema policial disponível em http://localhost:${PORT}`);
      console.log(`Saúde: http://localhost:${PORT}/api/saude`);
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
