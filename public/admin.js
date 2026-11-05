const adminApp = document.getElementById('admin-app');

if (adminApp) {
    const message = document.getElementById('register-message');
    const usersMessage = document.getElementById('users-message');
    const usersList = document.getElementById('users-list');
    const usersForm = document.getElementById('users-filters');
    const usersCargo = document.getElementById('users-cargo');
    const usersDate = document.getElementById('users-date');
    const registerForm = document.getElementById('form-register');
    const historyMessage = document.getElementById('history-message');
    const historyList = document.getElementById('history-list');
    const historyForm = document.getElementById('history-filters');
    const historyStartDate = document.getElementById('history-start-date');
    const historyEndDate = document.getElementById('history-end-date');
    const historyStatus = document.getElementById('history-status');
    const historyPriority = document.getElementById('history-priority');
    const statsMessage = document.getElementById('stats-message');
    const statsSummary = document.getElementById('stats-summary');
    const statsStatus = document.getElementById('stats-status');
    const statsPriority = document.getElementById('stats-priority');
    const statsDays = document.getElementById('stats-days');
    const statsSeriesCard = document.getElementById('stats-series-card');
    const statsForm = document.getElementById('stats-filters');
    const statsPeriod = document.getElementById('stats-period');
    const statsDate = document.getElementById('stats-date');
    const statsDateLabel = document.getElementById('stats-date-label');

    function setMessage(element, text, type = 'erro') {
        element.textContent = text;
        element.dataset.tipo = type;
    }

    async function carregarUsuarios(event) {
        event?.preventDefault();
        const query = new URLSearchParams();
        const cargo = usersCargo.value;
        const data = usersDate.value;
        if (cargo) query.set('cargo', cargo);
        if (data) {
            const [ano, mes, dia] = data.split('-');
            query.set('data', `${dia}/${mes}/${ano}`);
        }

        setMessage(usersMessage, 'Carregando usuários...');
        usersList.replaceChildren();
        try {
            const resultado = await window.policiaApi.get(`/api/admin/usuarios?${query.toString()}`);
            const usuarios = cargo
                ? resultado.usuarios.filter((usuario) => usuario.cargo === cargo)
                : resultado.usuarios;

            if (!usuarios.length) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.textContent = 'Nenhum usuário encontrado com esses filtros.';
                row.appendChild(cell);
                usersList.appendChild(row);
            } else {
                usuarios.forEach((usuario) => {
                    const row = document.createElement('tr');
                    const dataNascimento = typeof usuario.dataNascimento === 'string'
                        ? usuario.dataNascimento.split('-').reverse().join('/')
                        : '—';
                    const genero = {
                        MASCULINO: 'Masculino',
                        FEMININO: 'Feminino',
                    }[usuario.genero] || 'Não informado';
                    [usuario.nome, usuario.usuario, genero, usuario.cargo, dataNascimento].forEach((valor) => {
                        const cell = document.createElement('td');
                        cell.textContent = valor || '—';
                        row.appendChild(cell);
                    });
                    usersList.appendChild(row);
                });
            }
            setMessage(usersMessage, `${usuarios.length} usuário(s) encontrado(s).`, 'sucesso');
        } catch (error) {
            setMessage(usersMessage, error.message);
        }
    }

    async function carregarHistorico(event) {
        event?.preventDefault();
        const inicio = historyStartDate.value;
        const fim = historyEndDate.value;
        const status = historyStatus.value;
        const prioridade = historyPriority.value;
        const query = new URLSearchParams();

        if (inicio && fim && inicio > fim) {
            setMessage(historyMessage, 'A data inicial não pode ser posterior à data final.');
            return;
        }
        if (inicio) query.set('inicio', inicio);
        if (fim) query.set('fim', fim);
        if (status) query.set('status', status);
        if (prioridade) query.set('prioridade', prioridade);

        setMessage(historyMessage, 'Carregando emergências...');
        historyList.replaceChildren();
        try {
            const resultado = await window.policiaApi.get(`/api/emergencia?${query.toString()}`);
            if (!resultado.alertas.length) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.textContent = 'Nenhuma emergência encontrada neste período.';
                row.appendChild(cell);
                historyList.appendChild(row);
            } else {
                resultado.alertas.forEach((alerta) => {
                    const row = document.createElement('tr');
                    const timestamp = alerta.timestamp ? new Date(alerta.timestamp.replace(' ', 'T')) : null;
                    const dataFormatada = timestamp && !Number.isNaN(timestamp.getTime())
                        ? timestamp.toLocaleString('pt-BR')
                        : '—';
                    [alerta.protocolo, alerta.tipo, alerta.status, alerta.prioridade, dataFormatada].forEach((valor) => {
                        const cell = document.createElement('td');
                        cell.textContent = valor || '—';
                        row.appendChild(cell);
                    });
                    historyList.appendChild(row);
                });
            }
            setMessage(historyMessage, `${resultado.total} emergência(s) encontrada(s).`, 'sucesso');
        } catch (error) {
            setMessage(historyMessage, error.message);
        }
    }

    function renderizarIndicadores(resumo) {
        const indicadores = [
            ['Emergências no período', resumo.total],
            ['Em aberto', resumo.abertos],
            ['Resolvidas', resumo.resolvidos],
            ['Falsos alarmes', resumo.falsosAlarmes],
            ['Prioridade crítica', resumo.criticos],
        ];
        statsSummary.replaceChildren();

        indicadores.forEach(([rotulo, valor]) => {
            const cartao = document.createElement('article');
            cartao.className = 'stats-kpi';
            const numero = document.createElement('strong');
            numero.textContent = String(valor);
            const texto = document.createElement('span');
            texto.textContent = rotulo;
            cartao.append(numero, texto);
            statsSummary.appendChild(cartao);
        });
    }

    function renderizarBarras(container, registros, rotulo, formatarRotulo = (valor) => valor) {
        const maiorValor = Math.max(1, ...registros.map((registro) => registro.total));
        container.replaceChildren();

        registros.forEach((registro) => {
            const linha = document.createElement('div');
            linha.className = 'stats-bar-row';
            const nome = document.createElement('span');
            nome.className = 'stats-bar-label';
            nome.textContent = formatarRotulo(registro[rotulo]);
            const trilha = document.createElement('span');
            trilha.className = 'stats-bar-track';
            const barra = document.createElement('span');
            barra.className = 'stats-bar-fill';
            barra.style.width = `${(registro.total / maiorValor) * 100}%`;
            trilha.appendChild(barra);
            const total = document.createElement('strong');
            total.className = 'stats-bar-value';
            total.textContent = String(registro.total);
            linha.append(nome, trilha, total);
            container.appendChild(linha);
        });
    }

    function renderizarGraficoVertical(registros, formatarRotulo) {
        const maiorValor = Math.max(1, ...registros.map((registro) => registro.total));
        statsDays.replaceChildren();

        registros.forEach((registro) => {
            const coluna = document.createElement('div');
            coluna.className = 'stats-column';
            const total = document.createElement('strong');
            total.className = 'stats-column-value';
            total.textContent = String(registro.total);
            const trilha = document.createElement('span');
            trilha.className = 'stats-column-track';
            const barra = document.createElement('span');
            barra.className = 'stats-column-fill';
            barra.style.height = `${(registro.total / maiorValor) * 100}%`;
            trilha.appendChild(barra);
            const rotulo = document.createElement('span');
            rotulo.className = 'stats-column-label';
            rotulo.textContent = formatarRotulo(registro.periodo);
            coluna.append(total, trilha, rotulo);
            statsDays.appendChild(coluna);
        });
    }

    function atualizarCampoPeriodoEstatisticas() {
        const anoAtual = new Date().getFullYear();
        const periodoMensal = statsPeriod.value === 'mes';
        statsDate.type = periodoMensal ? 'month' : 'number';
        statsDateLabel.textContent = periodoMensal ? 'Mês' : 'Ano';
        statsDate.min = periodoMensal ? '1000-01' : '1000';
        statsDate.max = periodoMensal
            ? `${anoAtual}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
            : String(anoAtual);
        statsDate.step = '1';
        statsDate.required = true;
        statsDate.value = periodoMensal
            ? `${anoAtual}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
            : String(anoAtual);
    }

    async function carregarEstatisticas(event) {
        event?.preventDefault();
        const buscarSerie = Boolean(event);
        const query = new URLSearchParams({
            periodo: statsPeriod.value,
            data: statsDate.value,
        });
        document.getElementById('stats-days-title').textContent = statsPeriod.value === 'mes'
            ? 'Emergências por dia no mês'
            : 'Emergências por mês no ano';
        setMessage(statsMessage, 'Carregando estatísticas...');
        statsSummary.replaceChildren();
        statsStatus.replaceChildren();
        statsPriority.replaceChildren();
        statsDays.replaceChildren();
        statsSeriesCard.hidden = true;
        try {
            const resultado = await window.policiaApi.get(`/api/admin/estatisticas?${query.toString()}`);
            if (!resultado.resumo || !Array.isArray(resultado.porStatus)
                || !Array.isArray(resultado.porPrioridade) || !Array.isArray(resultado.serie)) {
                throw new Error('O servidor está desatualizado. Reinicie-o para carregar as estatísticas por período.');
            }

            renderizarIndicadores(resultado.resumo);

            const contagensStatus = new Map(resultado.porStatus.map((item) => [item.status, item.total]));
            const contagensPrioridade = new Map(resultado.porPrioridade.map((item) => [item.prioridade, item.total]));
            renderizarBarras(statsStatus, [
                { status: 'ATIVO', total: contagensStatus.get('ATIVO') || 0 },
                { status: 'EM_ATENDIMENTO', total: contagensStatus.get('EM_ATENDIMENTO') || 0 },
                { status: 'RESOLVIDO', total: contagensStatus.get('RESOLVIDO') || 0 },
                { status: 'FALSO_ALARME', total: contagensStatus.get('FALSO_ALARME') || 0 },
            ], 'status', (status) => ({
                ATIVO: 'Ativo',
                EM_ATENDIMENTO: 'Em atendimento',
                RESOLVIDO: 'Resolvido',
                FALSO_ALARME: 'Falso alarme',
            }[status]));
            renderizarBarras(statsPriority, [
                { prioridade: 'CRITICA', total: contagensPrioridade.get('CRITICA') || 0 },
                { prioridade: 'ALTA', total: contagensPrioridade.get('ALTA') || 0 },
                { prioridade: 'MEDIA', total: contagensPrioridade.get('MEDIA') || 0 },
                { prioridade: 'BAIXA', total: contagensPrioridade.get('BAIXA') || 0 },
            ], 'prioridade', (prioridade) => ({
                CRITICA: 'Crítica',
                ALTA: 'Alta',
                MEDIA: 'Média',
                BAIXA: 'Baixa',
            }[prioridade]));
            if (buscarSerie) {
                renderizarGraficoVertical(resultado.serie, (valor) => (
                    statsPeriod.value === 'mes'
                        ? valor.slice(8, 10)
                        : new Date(`${valor}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'short' })
                ));
                statsSeriesCard.hidden = false;
            }
            setMessage(statsMessage, 'Estatísticas atualizadas.', 'sucesso');
        } catch (error) {
            setMessage(statsMessage, error.message);
        }
    }

    document.querySelectorAll('[data-admin-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
            const abrirPainel = tab.getAttribute('aria-expanded') !== 'true';
            document.querySelectorAll('[data-admin-tab]').forEach((item) => {
                item.setAttribute('aria-expanded', String(abrirPainel && item === tab));
            });
            document.querySelectorAll('.admin-panel').forEach((panel) => {
                panel.hidden = !abrirPainel || panel.id !== tab.dataset.adminTab;
            });
            if (abrirPainel && tab.dataset.adminTab === 'panel-usuarios') carregarUsuarios();
            if (abrirPainel && tab.dataset.adminTab === 'panel-historico') carregarHistorico();
            if (abrirPainel && tab.dataset.adminTab === 'panel-estatisticas') carregarEstatisticas();
        });
    });

    historyForm.addEventListener('submit', carregarHistorico);
    usersForm.addEventListener('submit', carregarUsuarios);
    statsPeriod.addEventListener('change', atualizarCampoPeriodoEstatisticas);
    statsForm.addEventListener('submit', carregarEstatisticas);
    atualizarCampoPeriodoEstatisticas();
    document.getElementById('users-clear').addEventListener('click', () => {
        usersCargo.value = '';
        usersDate.value = '';
        carregarUsuarios();
    });
    document.getElementById('history-clear').addEventListener('click', () => {
        historyStartDate.value = '';
        historyEndDate.value = '';
        historyStatus.value = '';
        historyPriority.value = '';
        carregarHistorico();
    });
    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = registerForm.querySelector('[type="submit"]');
        const dados = Object.fromEntries(new FormData(registerForm));
        submitButton.disabled = true;
        setMessage(message, 'Salvando usuário...');

        try {
            await window.policiaApi.post('/api/admin/usuarios', dados);
            registerForm.reset();
            setMessage(message, 'Usuário cadastrado com sucesso.', 'sucesso');
        } catch (error) {
            setMessage(message, error.message);
        } finally {
            submitButton.disabled = false;
        }
    });

    document.getElementById('logout-button').addEventListener('click', async () => {
        await window.policiaApi.post('/api/auth/logout', {});
        window.location.replace('primeira-tela-login.html');
    });

    window.policiaApi.get('/api/auth/me').then(({ usuario }) => {
        if (usuario.cargo !== 'ADMINISTRADOR') {
            throw new Error('Acesso restrito à administração.');
        }
        document.getElementById('admin-identity').textContent = `${usuario.nome} (${usuario.cargo})`;
        adminApp.hidden = false;
        carregarUsuarios();
    }).catch(() => window.location.replace('Login-adm.html'));
}