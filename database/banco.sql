USE projeto_denuncia;

CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    cpf VARCHAR(14) NOT NULL UNIQUE,
    data_nascimento DATE NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE atendentes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    usuario VARCHAR(100) NOT NULL UNIQUE,
    senha VARCHAR(100) NOT NULL,
    cargo ENUM('atendente', 'supervisor', 'administrador') DEFAULT 'atendente',
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE denuncias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    protocolo VARCHAR(30) NOT NULL UNIQUE,
    usuario_id INT NOT NULL,
    atendente_id INT NULL,
    tipo VARCHAR(30) NOT NULL DEFAULT 'EMERGENCIA',
    status ENUM(
        'ATIVO',
        'EM_ATENDIMENTO',
        'RESOLVIDO',
        'FALSO_ALARME'
    ) NOT NULL DEFAULT 'ATIVO',
    prioridade ENUM(
        'BAIXA',
        'MEDIA',
        'ALTA',
        'CRITICA'
    ) NOT NULL DEFAULT 'ALTA',
    quantidade_acionamentos INT NOT NULL DEFAULT 1,
    latitude DOUBLE,
    longitude DOUBLE,
    acuracia_metros DOUBLE,
    dispositivo VARCHAR(100),
    ip_origem VARCHAR(45),
    origem VARCHAR(100) NOT NULL DEFAULT 'botao-emergencia',
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    encerrado_em TIMESTAMP NULL,

    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (atendente_id) REFERENCES atendentes(id)
);

CREATE TABLE localizacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    denuncia_id INT NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    acuracia_metros DOUBLE,
    registrado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (denuncia_id) REFERENCES denuncias(id)
);