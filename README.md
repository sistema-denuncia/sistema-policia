# Sistema de Denúncia / Emergência — SQLite

O backend da polícia usa **SQLite** como banco persistente. Não é necessário instalar, iniciar ou configurar MySQL.

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

O banco é criado automaticamente na primeira inicialização:

```text
database/emergencia.db
```

O backend também cria a tabela e os índices automaticamente. Não é necessário executar `schema.sql` manualmente.

## Execução

### 1. Backend da polícia

```bash
cd sistema-policia-backend
npm install
npm start
```

Na primeira execução, o arquivo `database/emergencia.db` será criado automaticamente.

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
