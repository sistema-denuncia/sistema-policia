const express = require('express');
const rateLimit = require('express-rate-limit');
const { run, get, all, transaction } = require('../db');

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

function normalizarNumero(valor, campo) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw new Error(`${campo} inválida.`);
  return numero;
}

function validarLocalizacao(localizacao) {
  if (!localizacao) {
    return { latitude: null, longitude: null, acuraciaMetros: null };
  }

  const latitude = normalizarNumero(localizacao.latitude, 'Latitude');
  const longitude = normalizarNumero(localizacao.longitude, 'Longitude');
  const acuraciaMetros = normalizarNumero(
    localizacao.acuraciaMetros ?? localizacao.accuracy,
    'Acurácia'
  );

  if ((latitude === null) !== (longitude === null)) {
    throw new Error('Latitude e longitude devem ser informadas juntas.');
  }
  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    throw new Error('Latitude inválida.');
  }
  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    throw new Error('Longitude inválida.');
  }
  if (acuraciaMetros !== null && acuraciaMetros < 0) {
    throw new Error('Acurácia inválida.');
  }

  return { latitude, longitude, acuraciaMetros };
}

function formatarAlerta(row) {
  const latitude = row.localizacao_latitude ?? row.latitude;
  const longitude = row.localizacao_longitude ?? row.longitude;

  return {
    id: row.id,
    protocolo: row.protocolo,
    clienteId: String(row.usuario_id),
    tipo: row.tipo,
    status: row.status,
    prioridade: row.prioridade,
    quantidadeAcionamentos: row.quantidade_acionamentos || 1,
    localizacao: latitude === null || latitude === undefined
      ? null
      : {
          latitude,
          longitude,
          acuraciaMetros: row.localizacao_acuracia_metros ?? row.acuracia_metros,
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

const SELECT_DENUNCIA = `
  SELECT d.*,
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
  )`;

function gerarProtocolo() {
  const agora = new Date();
  const data = agora.toISOString().replace(/\D/g, '').slice(0, 14);
  const sufixo = Math.floor(100 + Math.random() * 900);
  return `EMERG-${data}-${sufixo}`;
}

router.post('/', emergenciaLimiter, async (req, res, next) => {
  const { clienteId, tipo, prioridade, dispositivo, localizacao } = req.body || {};
  const usuarioId = Number(clienteId);

  if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'clienteId deve ser o ID numérico de um usuário cadastrado.',
    });
  }

  let loc;
  try {
    loc = validarLocalizacao(localizacao);
  } catch (err) {
    return res.status(400).json({ sucesso: false, mensagem: err.message });
  }

  const tipoFinal = typeof tipo === 'string' && tipo.trim()
    ? tipo.trim().slice(0, 30)
    : 'EMERGENCIA';
  const prioridadeFinal = PRIORIDADES_VALIDAS.includes(prioridade) ? prioridade : 'ALTA';
  const dispositivoFinal = dispositivo ? String(dispositivo).slice(0, 100) : null;

  try {
    const resultado = await transaction(async ({ run: executar, get: buscar }) => {
      const usuario = await buscar(
        'SELECT id FROM usuarios WHERE id = ? FOR UPDATE',
        [usuarioId]
      );

      if (!usuario) return { usuarioInexistente: true };

      const denunciaAtiva = await buscar(
        `SELECT id FROM denuncias
         WHERE usuario_id = ? AND status IN ('ATIVO', 'EM_ATENDIMENTO')
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [usuarioId]
      );

      let denunciaId;
      let duplicado = false;

      if (denunciaAtiva) {
        denunciaId = denunciaAtiva.id;
        duplicado = true;
        await executar(
          `UPDATE denuncias
           SET quantidade_acionamentos = quantidade_acionamentos + 1,
               dispositivo = ?,
               ip_origem = ?
           WHERE id = ?`,
          [dispositivoFinal, getIp(req), denunciaId]
        );
      } else {
        const protocolo = gerarProtocolo();
        const insercao = await executar(
          `INSERT INTO denuncias
            (protocolo, usuario_id, tipo, status, prioridade, quantidade_acionamentos,
             latitude, longitude, acuracia_metros, dispositivo, ip_origem, origem)
           VALUES (?, ?, ?, 'ATIVO', ?, 1, ?, ?, ?, ?, ?, 'botao-emergencia-web')`,
          [
            protocolo,
            usuarioId,
            tipoFinal,
            prioridadeFinal,
            loc.latitude,
            loc.longitude,
            loc.acuraciaMetros,
            dispositivoFinal,
            getIp(req),
          ]
        );
        denunciaId = insercao.lastID;
      }

      if (loc.latitude !== null && loc.longitude !== null) {
        await executar(
          `INSERT INTO localizacoes
            (denuncia_id, latitude, longitude, acuracia_metros)
           VALUES (?, ?, ?, ?)`,
          [denunciaId, loc.latitude, loc.longitude, loc.acuraciaMetros]
        );

        if (duplicado) {
          await executar(
            `UPDATE denuncias
             SET latitude = ?, longitude = ?, acuracia_metros = ?
             WHERE id = ?`,
            [loc.latitude, loc.longitude, loc.acuraciaMetros, denunciaId]
          );
        }
      }

      return { denunciaId, duplicado };
    });

    if (resultado.usuarioInexistente) {
      return res.status(404).json({
        sucesso: false,
        mensagem: 'O clienteId informado não corresponde a um usuário cadastrado.',
      });
    }

    const row = await get(
      `${SELECT_DENUNCIA} WHERE d.id = ?`,
      [resultado.denunciaId]
    );
    const alerta = formatarAlerta(row);

    req.app.get('io').emit(resultado.duplicado ? 'alerta-atualizado' : 'novo-alerta', alerta);

    return res.status(resultado.duplicado ? 200 : 201).json({
      sucesso: true,
      mensagem: resultado.duplicado
        ? 'Este acionamento já foi registrado. A nova tentativa foi contabilizada.'
        : 'Alerta recebido com sucesso.',
      id: alerta.id,
      protocolo: alerta.protocolo,
      ...(resultado.duplicado ? {
        quantidadeAcionamentos: alerta.quantidadeAcionamentos,
        alerta,
        duplicado: true,
      } : {}),
    });
  } catch (err) {
    console.error('Erro ao registrar emergência:', err);
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let sql = SELECT_DENUNCIA;

    if (status && STATUS_VALIDOS.includes(status)) {
      sql += ' WHERE d.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY d.criado_em DESC, d.id DESC LIMIT 100';

    const rows = await all(sql, params);
    res.json({ total: rows.length, alertas: rows.map(formatarAlerta) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await get(`${SELECT_DENUNCIA} WHERE d.id = ?`, [req.params.id]);

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

    const existente = await get(
      'SELECT id FROM denuncias WHERE id = ?',
      [req.params.id]
    );

    if (!existente) {
      return res.status(404).json({ sucesso: false, mensagem: 'Alerta não encontrado.' });
    }

    await run(
      `UPDATE denuncias
       SET status = ?, observacoes = ?,
           encerrado_em = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, observacoes ? String(observacoes).slice(0, 5000) : null, encerradoEm, req.params.id]
    );

    const alerta = await get(
      `${SELECT_DENUNCIA} WHERE d.id = ?`,
      [req.params.id]
    );

    const alertaFormatado = formatarAlerta(alerta);
    req.app.get('io').emit('alerta-atualizado', alertaFormatado);
    res.json({ sucesso: true, mensagem: 'Status atualizado.', alerta: alertaFormatado });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
