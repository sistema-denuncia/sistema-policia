# Sistema de Denúncia / Emergência — MySQL

O backend da polícia usa MySQL para armazenar os alertas recebidos do botão de
emergência e disponibilizá-los no painel em tempo real.

## Fluxo

```text
Botão de emergência
  │ POST /api/emergencia + X-API-Key
  ▼
Backend da polícia (porta 3001)
  ├── valida e grava o acionamento no MySQL
  └── emite o alerta via Socket.IO
            │
            ▼
      Painel da polícia
```

O endpoint recebe `clienteId`, `tipo`, `prioridade`, `dispositivo` e
`localizacao` (`latitude`, `longitude` e, opcionalmente, `accuracy` ou
`acuraciaMetros`). `clienteId` deve ser o ID numérico de um usuário já
cadastrado em `usuarios`. Os dados da ocorrência são gravados em `denuncias`;
cada posição enviada também é registrada em `localizacoes`.

O serviço do botão cria contas usando `POST /api/usuarios` e autentica usuários
em `POST /api/usuarios/login`. Essas rotas, assim como o acionamento, exigem a
chave de integração `X-API-Key`. As senhas novas são armazenadas usando scrypt.

## Execução local

Requisitos: Node.js, npm e Docker Desktop.

1. Na raiz do projeto, inicie o banco:

   ```bash
   docker compose -f database/docker-compose.yml up -d
   ```

   O MySQL será disponibilizado em `127.0.0.1:3307`. O banco
   O banco `projeto_denuncia` e as tabelas são criados pelo script
   `database/banco.sql` na primeira inicialização do volume.

2. Configure e inicie o backend:

   ```powershell
   Copy-Item .env.example .env
   npm install
   npm start
   ```

   As credenciais padrão do MySQL local são `root` / `root`. Se alterar essas
   credenciais no Docker, atualize também `DB_USER`, `DB_PASSWORD`, `DB_HOST`,
   `DB_PORT` e `DB_NAME` no `.env`.

3. Abra o painel em `http://localhost:3001`. Verifique a conexão em
   `http://localhost:3001/api/saude`.

## Chave da API

O backend do botão deve enviar `X-API-Key` com o mesmo valor de
`POLICIA_API_KEY` definido no `.env` da aplicação policial. O valor padrão é
adequado apenas para desenvolvimento local.

## Persistência

As denúncias são armazenadas em `denuncias`, vinculadas a `usuarios` por
`usuario_id`. As coordenadas mais recentes ficam na denúncia e cada posição
recebida é mantida em `localizacoes`. Novos acionamentos do mesmo usuário
reutilizam sua denúncia ativa ou em atendimento e incrementam
`quantidade_acionamentos`; se não houver denúncia aberta, uma nova é criada.
