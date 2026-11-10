(() => {
  const modal = document.getElementById('modalEstatisticasOperacionais');
  const openButton = document.getElementById('abrirEstatisticasOperacionais');
  const form = document.getElementById('operational-filters');
  const period = document.getElementById('operational-period');
  const date = document.getElementById('operational-date');
  const dateLabel = document.getElementById('operational-date-label');
  const message = document.getElementById('operational-message');
  const agentsBody = document.getElementById('operational-agents');
  const casesBody = document.getElementById('operational-cases');
  const casesToggle = document.getElementById('operational-cases-toggle');
  const casesContent = document.getElementById('operational-cases-content');

  function atualizarCampoData() {
    const mensal = period.value === 'mes';
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    const dataAnterior = date.value;
    date.type = mensal ? 'month' : 'date';
    dateLabel.textContent = mensal ? 'Mês' : 'Data';
    date.max = mensal ? `${ano}-${mes}` : `${ano}-${mes}-${dia}`;
    if (mensal) {
      date.value = /^\d{4}-\d{2}/.test(dataAnterior)
        ? dataAnterior.slice(0, 7)
        : `${ano}-${mes}`;
    } else {
      date.value = /^\d{4}-\d{2}-\d{2}$/.test(dataAnterior)
        ? dataAnterior
        : `${dataAnterior.slice(0, 7) || `${ano}-${mes}`}-01`;
    }
  }

  function celula(linha, valor) {
    const item = document.createElement('td');
    item.textContent = valor;
    linha.appendChild(item);
  }

  function formatarDuracao(segundos) {
    if (segundos === null || segundos === undefined) return '—';
    const total = Math.max(0, Number(segundos));
    const horas = Math.floor(total / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const resto = total % 60;
    if (horas) return `${horas}h ${minutos}min`;
    if (minutos) return `${minutos}min ${resto}s`;
    return `${resto}s`;
  }

  function formatarData(valor) {
    if (!valor) return '—';
    const dataLocal = new Date(valor.replace(' ', 'T'));
    return Number.isNaN(dataLocal.getTime()) ? valor : dataLocal.toLocaleString('pt-BR');
  }

  function preencherTabela(corpo, registros, colunas, mensagemVazia) {
    corpo.replaceChildren();
    if (!registros.length) {
      const linha = document.createElement('tr');
      const item = document.createElement('td');
      item.colSpan = colunas;
      item.textContent = mensagemVazia;
      linha.appendChild(item);
      corpo.appendChild(linha);
      return;
    }
    registros.forEach((registro) => {
      const linha = document.createElement('tr');
      registro.forEach((valor) => celula(linha, valor));
      corpo.appendChild(linha);
    });
  }

  function renderizar(resultado) {
    preencherTabela(agentsBody, resultado.agentes.map((agente) => [
      agente.agenteNome,
      agente.agenteCargo,
      String(agente.atendidas),
      String(agente.resolvidas),
      formatarDuracao(agente.tempoMedioSegundos),
    ]), 5, 'Nenhum agente ou operador cadastrado.');

    preencherTabela(casesBody, resultado.atendimentos.map((atendimento) => [
      atendimento.agenteNome,
      atendimento.agenteCargo,
      atendimento.protocolo,
      `${formatarData(atendimento.assumidaEm)}${atendimento.estimado ? ' (estimado)' : ''}`,
      `${formatarData(atendimento.encerradaEm)}${atendimento.estimado && atendimento.encerradaEm ? ' (estimado)' : ''}`,
      formatarDuracao(atendimento.duracaoSegundos),
      {
        RESOLVIDO: 'Resolvida',
        FALSO_ALARME: 'Falso alarme',
        TRANSFERIDO: 'Transferida',
      }[atendimento.resultado] || 'Em atendimento',
    ]), 7, 'Nenhum atendimento registrado neste período.');
  }

  async function carregar(event) {
    event?.preventDefault();
    message.textContent = 'Carregando estatísticas...';
    agentsBody.replaceChildren();
    casesBody.replaceChildren();
    const query = new URLSearchParams({ periodo: period.value, data: date.value });
    try {
      const resposta = await fetch(`/api/estatisticas-operacionais?${query}`, {
        credentials: 'same-origin',
      });
      const resultado = await resposta.json();
      if (!resposta.ok) throw new Error(resultado.mensagem || 'Não foi possível carregar as estatísticas.');
      renderizar(resultado);
      message.textContent = 'Registros antigos sem horário de assunção usam a data do acionamento como estimativa; atendimentos novos usam os horários reais.';
    } catch (error) {
      message.textContent = error.message;
    }
  }

  function abrir() {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (!date.value) atualizarCampoData();
    carregar();
    document.getElementById('operational-period').focus();
  }

  function fechar() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    openButton.focus();
  }

  openButton.addEventListener('click', abrir);
  casesToggle.addEventListener('click', () => {
    const expanded = casesToggle.getAttribute('aria-expanded') !== 'true';
    casesToggle.setAttribute('aria-expanded', String(expanded));
    casesContent.hidden = !expanded;
  });
  period.addEventListener('change', atualizarCampoData);
  form.addEventListener('submit', carregar);
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-ops-act="fechar"]')) fechar();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) fechar();
  });
})();
