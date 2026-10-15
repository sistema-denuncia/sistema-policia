const adminApp = document.getElementById('admin-app');

if (adminApp) {
    const message = document.getElementById('register-message');
    const usersMessage = document.getElementById('users-message');
    const usersList = document.getElementById('users-list');
    const registerForm = document.getElementById('form-register');

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

    document.querySelectorAll('[data-admin-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('[data-admin-tab]').forEach((item) => {
                item.setAttribute('aria-selected', String(item === tab));
            });
            document.querySelectorAll('.admin-panel').forEach((panel) => {
                panel.hidden = panel.id !== tab.dataset.adminTab;
            });
            if (tab.dataset.adminTab === 'panel-usuarios') carregarUsuarios();
        });
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