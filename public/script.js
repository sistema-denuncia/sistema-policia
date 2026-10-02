function exibirMensagem(elemento, mensagem, tipo = 'erro') {
    if (!elemento) return;
    elemento.textContent = mensagem;
    elemento.dataset.tipo = tipo;
}

function mensagemFalhaLogin(error) {
    return /inválid[oa]s/i.test(error.message)
        ? 'Usuário incorreto. Tente novamente.'
        : error.message;
}

async function autenticarAdministrador(login, senha) {
    try {
        return await window.policiaApi.post('/api/auth/supervisor', { login, senha });
    } catch (erroSupervisor) {
        const resultado = await window.policiaApi.post('/api/auth/login', {
            usuario: login,
            senha,
            cargo: 'ADMINISTRADOR'
        });
        if (resultado.usuario.cargo !== 'ADMINISTRADOR') {
            await window.policiaApi.post('/api/auth/logout', {});
            throw erroSupervisor;
        }
        return resultado;
    }
}

const formSupervisor = document.getElementById('form-login');
if (formSupervisor) {
    formSupervisor.addEventListener('submit', async (event) => {
        event.preventDefault();
        const mensagem = document.getElementById('login-message');
        const botao = formSupervisor.querySelector('[type="submit"]');
        const login = formSupervisor.elements.usuario.value.trim();
        const senha = formSupervisor.elements.senha.value;
        botao.disabled = true;
        mensagem.textContent = '';

        try {
            await autenticarAdministrador(login, senha);
            window.location.assign('/tela-adm-opcoes.html');
        } catch (error) {
            exibirMensagem(mensagem, mensagemFalhaLogin(error));
            botao.disabled = false;
        }
    });
}

const formAgente = document.getElementById('form-agent-login');
if (formAgente) {
    formAgente.addEventListener('submit', async (event) => {
        event.preventDefault();
        const mensagem = document.getElementById('agent-login-message');
        const botao = formAgente.querySelector('[type="submit"]');
        const usuario = formAgente.elements.usuario.value.trim();
        const senha = formAgente.elements.senha.value;
        botao.disabled = true;
        mensagem.textContent = '';

        try {
            await window.policiaApi.post('/api/auth/login', { usuario, senha, cargo: 'AGENTE' });
            window.location.assign('tela-emergencias.html');
        } catch (error) {
            exibirMensagem(mensagem, mensagemFalhaLogin(error));
            botao.disabled = false;
        }
    });
}