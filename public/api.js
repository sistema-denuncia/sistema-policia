window.policiaApi = {
    async request(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (options.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(url, {
            ...options,
            headers,
            credentials: 'same-origin'
        });
        const resultado = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(resultado.mensagem || 'Não foi possível concluir a solicitação.');
        }
        return resultado;
    },

    get(url) {
        return this.request(url);
    },

    post(url, dados) {
        return this.request(url, { method: 'POST', body: JSON.stringify(dados) });
    }
};