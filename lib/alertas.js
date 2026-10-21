// Consulta e formatação de alertas, compartilhadas entre a rota REST e o Socket.IO.
const SELECT_DENUNCIA = `
  SELECT d.*,
         l.latitude AS localizacao_latitude,
         l.longitude AS localizacao_longitude,
         l.acuracia_metros AS localizacao_acuracia_metros,
         l.registrado_em AS localizacao_registrado_em,
         u.nome AS solicitante_nome,
         u.cpf AS solicitante_cpf,
         DATE_FORMAT(u.data_nascimento, '%Y-%m-%d') AS solicitante_nascimento,
         u.email AS solicitante_email,
         u.criado_em AS solicitante_desde,
         a.nome AS atendente_nome,
         (SELECT COUNT(*) FROM denuncias h
           WHERE h.usuario_id = d.usuario_id AND h.id <> d.id) AS historico_total,
         (SELECT COUNT(*) FROM denuncias h
           WHERE h.usuario_id = d.usuario_id AND h.id <> d.id
             AND h.status = 'FALSO_ALARME') AS historico_falsos
  FROM denuncias d
  JOIN usuarios u ON u.id = d.usuario_id
  LEFT JOIN atendentes a ON a.id = d.atendente_id
  LEFT JOIN localizacoes l ON l.id = (
    SELECT l2.id
    FROM localizacoes l2
    WHERE l2.denuncia_id = d.id
    ORDER BY l2.registrado_em DESC, l2.id DESC
    LIMIT 1
  )`;

function calcularIdade(nascimento) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nascimento || '');
  if (!m) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - Number(m[1]);
  const antes = hoje.getMonth() + 1 < Number(m[2])
    || (hoje.getMonth() + 1 === Number(m[2]) && hoje.getDate() < Number(m[3]));
  if (antes) idade -= 1;
  return idade >= 0 ? idade : null;
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
          registradoEm: row.localizacao_registrado_em ?? row.atualizado_em,
        },
    solicitante: {
      nome: row.solicitante_nome,
      cpf: row.solicitante_cpf,
      dataNascimento: row.solicitante_nascimento,
      idade: calcularIdade(row.solicitante_nascimento),
      email: row.solicitante_email,
      cadastradoEm: row.solicitante_desde,
    },
    historico: {
      total: Number(row.historico_total) || 0,
      falsosAlarmes: Number(row.historico_falsos) || 0,
    },
    atendente: row.atendente_nome || null,
    dispositivo: row.dispositivo,
    ipOrigem: row.ip_origem,
    origem: row.origem,
    observacoes: row.observacoes,
    timestamp: row.criado_em,
    atualizadoEm: row.atualizado_em,
    encerradoEm: row.encerrado_em,
  };
}

module.exports = { SELECT_DENUNCIA, formatarAlerta };
