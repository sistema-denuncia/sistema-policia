const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { run, get, all } = require('../db');

const router = express.Router();

const STATUS_VALIDOS = ['ATIVO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FALSO_ALARME'];
const PRIORIDADES_VALIDAS = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];

const emergenciaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.EMERGENCIA_RATE_LIMIT || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

function getIp(req) {
  return req.ip || req.socket.remoteAddress || null;
}

function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function validarLocalizacao(localizacao) {
  if (!localizacao) return { latitude: null, longitude: null };

  const latitude = normalizarNumero(localizacao.latitude);
  const longitude = normalizarNumero(localizacao.longitude);

  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    throw new Error('Latitude inválida.');
  }
  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    throw new Error('Longitude inválida.');
  }

  return { latitude, longitude };
}

function formatarAlerta(row) {
  return {
    id: row.id,
    protocolo: row.protocolo,
    clienteId: row.cliente_id,
    tipo: row.tipo,
    status: row.status,
    prioridade: row.prioridade,
    quantidadeAcionamentos: row.quantidade_acionamentos || 1,
    localizacao: row.latitude === null && row.longitude === null
      ? null
      : {
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
  };
}

function gerarProtocolo() {
  const agora = new Date();
  const data = agora.toISOString().replace(/\D/g, '').slice(0, 14);
  const sufixo = Math.floor(100 + Math.random() * 900);
  return `EMERG-${data}-${sufixo}`;
}

router.post('/', emergenciaLimiter, async (req, res) => {
  const { clienteId, tipo, prioridade, dispositivo, localizacao } = req.body;

  if (!clienteId || typeof clienteId !== 'string' || clienteId.length > 100) {
    return res.status(400).json({ sucesso: false, mensagem: 'clienteId é obrigatório.' });
  }

  try {
    const loc = validarLocalizacao(localizacao);
    const existente = await get(
      'SELECT * FROM alertas_policia WHERE cliente_id = ? LIMIT 1',
      [clienteId]
    );

    if (existente) {
      await run(
        `UPDATE alertas_policia
         SET quantidade_acionamentos = COALESCE(quantidade_acionamentos, 1) + 1,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [existente.id]
      );

      const alertaAtualizado = formatarAlerta(await get(
        'SELECT * FROM alertas_policia WHERE id = ?',
        [existente.id]
      ));

      req.app.get('io').emit('alerta-atualizado', alertaAtualizado);

      return res.status(200).json({
        sucesso: true,
        mensagem: 'Este acionamento já foi registrado. A nova tentativa foi contabilizada.',
        id: alertaAtualizado.id,
        protocolo: alertaAtualizado.protocolo,
        quantidadeAcionamentos: alertaAtualizado.quantidadeAcionamentos,
        alerta: alertaAtualizado,
        duplicado: true,
      });
    }

    const id = uuidv4();
    const protocolo = gerarProtocolo();
    const tipoFinal = typeof tipo === 'string' && tipo.trim()
      ? tipo.trim().slice(0, 30)
      : 'EMERGENCIA';
    const prioridadeFinal = PRIORIDADES_VALIDAS.includes(prioridade) ? prioridade : 'ALTA';
    const dispositivoFinal = dispositivo ? String(dispositivo).slice(0, 2000) : null;

    await run(
      `INSERT INTO alertas_policia
        (id, protocolo, cliente_id, tipo, status, prioridade, latitude, longitude,
         dispositivo, ip_origem)
         VALUES (?, ?, ?, ?, 'ATIVO', ?, ?, ?, ?, ?)`,
      [
        id,
        protocolo,
        clienteId,
        tipoFinal,
        prioridadeFinal,
        loc.latitude,
        loc.longitude,
        dispositivoFinal,
        getIp(req),
      ]
    );

    const alerta = formatarAlerta(await get(
      'SELECT * FROM alertas_policia WHERE id = ?',
      [id]
    ));

    req.app.get('io').emit('novo-alerta', alerta);

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Alerta recebido com sucesso.',
      id: alerta.id,
      protocolo: alerta.protocolo,
    });
  } catch (err) {
    console.error('Erro ao registrar emergência:', err);
    return res.status(400).json({ sucesso: false, mensagem: err.message || 'Dados inválidos.' });
  }
});

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let sql = 'SELECT * FROM alertas_policia';

    if (status && STATUS_VALIDOS.includes(status)) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY criado_em DESC LIMIT 100';

    const rows = await all(sql, params);
    res.json({ total: rows.length, alertas: rows.map(formatarAlerta) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await get('SELECT * FROM alertas_policia WHERE id = ?', [req.params.id]);

    if (!row) {
      return res.status(404).json({ sucesso: false, mensagem: 'Alerta não encontrado.' });
    }

    res.json(formatarAlerta(row));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  const { status, observacoes } = req.body;

  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({
      sucesso: false,
      mensagem: `Status inválido. Use: ${STATUS_VALIDOS.join(', ')}`,
    });
  }

  try {
    const encerradoEm = ['RESOLVIDO', 'FALSO_ALARME'].includes(status)
      ? new Date().toISOString()
      : null;

    const result = await run(
      `UPDATE alertas_policia
       SET status = ?, observacoes = ?,
           encerrado_em = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, observacoes ? String(observacoes).slice(0, 5000) : null, encerradoEm, req.params.id]
    );

    if (!result.changes) {
      return res.status(404).json({ sucesso: false, mensagem: 'Alerta não encontrado.' });
    }

    const alerta = formatarAlerta(await get(
      'SELECT * FROM alertas_policia WHERE id = ?',
      [req.params.id]
    ));

    req.app.get('io').emit('alerta-atualizado', alerta);
    res.json({ sucesso: true, mensagem: 'Status atualizado.', alerta });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
