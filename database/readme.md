BANCO DE DADOS

Requisitos:
- Docker Desktop

Para iniciar o banco:

1. Abra um terminal nesta pasta:
   database/

2. Execute:

   docker compose up -d

3. O MySQL estará disponível em:

   Host: 127.0.0.1
   Porta: 3307
   Usuário: root
   Senha: root
   Banco: projeto_denuncia

Depois de iniciar o MySQL, volte à raiz do projeto e execute `npm install` e `npm start`.
O backend grava e consulta os agentes na tabela `atendentes`. A conexão pode ser ajustada com
`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` e `MYSQL_DATABASE` no arquivo `.env`.