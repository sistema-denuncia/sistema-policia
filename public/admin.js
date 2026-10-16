const adminApp = document.getElementById('admin-app');

if (adminApp) {
    const message = document.getElementById('register-message');
    const usersMessage = document.getElementById('users-message');
    const usersList = document.getElementById('users-list');
    const registerForm = document.getElementById('form-register');
    const historyMessage = document.getElementById('history-message');
    const historyList = document.getElementById('history-list');
    const historyForm = document.getElementById('history-filters');
    const historyPeriod = document.getElementById('history-period');
    const historyDate = document.getElementById('history-date');
    const historyDateLabel = document.getElementById('history-date-label');

    function setMessage(element, text, type = 'erro') {
        element.textContent = text;
        element.dataset.tipo = type;
    }

    async function carregarUsuarios() {
        setMessage(usersMessage, 'Carregando usuários...');
        try {
            const resultado = await window.policiaApi.get('/api/admin/usuarios');
            usersList.replaceChildren();

            if (!resultado.usuarios.length) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 3;
                cell.textContent = 'Nenhum usuário cadastrado.';
                row.appendChild(cell);
                usersList.appendChild(row);
            } else {
                resultado.usuarios.forEach((usuario) => {
                    const row = document.createElement('tr');
                    [usuario.nome, usuario.usuario, usuario.cargo].forEach((valor) => {
                        const cell = document.createElement('td');
                        cell.textContent = valor;
                        row.appendChild(cell);
                    });
                    usersList.appendChild(row);
                });
            }
            setMessage(usersMessage, `${resultado.usuarios.length} usuário(s) cadastrado(s).`, 'sucesso');
        } catch (error) {
            setMessage(usersMessage, error.message);
        }
    }

    function atualizarCampoData() {
        const periodo = historyPeriod.value;
        historyDate.type = periodo === 'dia' ? 'date' : periodo === 'mes' ? 'month' : 'number';
        historyDateLabel.textContent = periodo === 'dia' ? 'Data' : periodo === 'mes' ? 'Mês' : 'Ano';
        historyDate.min = periodo === 'ano' ? '2000' : '';
        historyDate.max = periodo === 'ano' ? String(new Date().getFullYear()) : '';
        historyDate.required = true;
    }

    async function carregarHistorico(event) {
        event?.preventDefault();
        const periodo = historyPeriod.value;
        const data = historyDate.value;
        const query = new URLSearchParams();
        if (data) {
            query.set('periodo', periodo);
            query.set('data', data);
        }

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
        });
    });

    historyPeriod.addEventListener('change', atualizarCampoData);
    historyForm.addEventListener('submit', carregarHistorico);
    document.getElementById('history-clear').addEventListener('click', () => {
        historyDate.value = '';
        carregarHistorico();
    });
    atualizarCampoData();

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