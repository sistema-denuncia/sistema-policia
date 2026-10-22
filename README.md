# Sistema de Denúncia / Emergência

As ocorrências e os usuários/agentes são armazenados em MySQL. Os agentes ficam na tabela `atendentes`.

## Fluxo

```text
Usuário
  │
  │ POST /api/emergencia
  ▼
Botão de emergência (porta 3000)
  │
  │ X-API-Key servidor -> servidor
  ▼
Backend da polícia (porta 3001)
  │
  ├── grava no MySQL
  └── emite novo-alerta via Socket.IO
            │
            ▼
      Painel da polícia
```

## Banco

Inicie o MySQL pelo Docker Compose na raiz do projeto:

```bash
docker compose -f database/docker-compose.yml up -d
```

O backend conecta ao MySQL em `127.0.0.1:3307`, banco `projeto_denuncia`.

O Compose cria a tabela `atendentes` a partir de `database/banco.sql`. Ao iniciar, o backend garante que a tabela `alertas_policia` exista no MySQL, inclusive em volumes criados antes dessa tabela ser adicionada.

Ao iniciar, o backend garante que `cliente_id` em `alertas_policia` tenha um
índice não exclusivo. Assim, o mesmo cliente pode gerar novos alertas depois
que um anterior for encerrado; a atualização do índice preserva os registros.

## Execução

### 1. Backend da polícia

```bash
npm install
npm start
```

Os agentes cadastrados ficam na tabela `atendentes` do MySQL.

### 2. Backend do botão

Em outro terminal:

```bash
cd botao-emergencia-web
npm install
npm start
```

Abra:

- Usuário: `http://localhost:3000`
- Polícia: `http://localhost:3001`
- Saúde da polícia: `http://localhost:3001/api/saude`

## Configuração da chave

Crie `sistema-policia-backend/.env` a partir de `.env.example` se quiser alterar a chave padrão.

No backend do botão, o `.env` deve usar a mesma chave em `POLICIA_API_KEY`.

Para desenvolvimento local, `desenvolvimento-local` já funciona, mas para apresentação/rede real use uma chave longa e aleatória.

## Estados da ocorrência

- `ATIVO`
- `EM_ATENDIMENTO`
- `RESOLVIDO`
- `FALSO_ALARME`

## Persistência

As ocorrências continuam disponíveis depois que o backend é reiniciado porque são armazenadas no arquivo SQLite.

O arquivo do banco é ignorado pelo Git para evitar que dados reais sejam versionados.
