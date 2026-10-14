# Sistema de Denúncia / Emergência

As ocorrências são armazenadas em SQLite. Os usuários e agentes são armazenados em MySQL na tabela `atendentes`.

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
  ├── grava no SQLite
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

O backend conecta ao MySQL em `127.0.0.1:3307`, banco `projeto_denuncia`, e usa o SQLite em:

```text
database/emergencia.db
```

O Compose cria a tabela `atendentes` a partir de `database/banco.sql`. O backend também mantém as tabelas de ocorrências no SQLite.

## Execução

### 1. Backend da polícia

```bash
npm install
npm start
```

Na primeira execução, o arquivo `database/emergencia.db` será criado automaticamente. Os agentes que já estavam no SQLite são copiados para `atendentes` no MySQL sem sobrescrever usuários existentes.

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
