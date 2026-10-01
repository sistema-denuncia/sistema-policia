const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Caminho do banco de dados
const DB_PATH = path.join(__dirname, 'emergencia.db');

// Inicializa a conexão
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Erro ao abrir o banco de dados:', err.message);
        process.exit(1);
    }

    console.log('✔ Conectado ao banco de dados SQLite.');
});

// Executa as queries em sequência
db.serialize(() => {

    // =========================================================
    // 1. ATIVAR FOREIGN KEYS
    // =========================================================
    db.run('PRAGMA foreign_keys = ON;', (err) => {
        if (err) {
            console.error('Erro ao ativar Foreign Keys:', err.message);
        } else {
            console.log('Foreign Keys ativadas.');
        }
    });

    // =========================================================
    // 2. REGIONS
    // =========================================================
    const queryRegions = `
        CREATE TABLE IF NOT EXISTS regions (
            id INTEGER PRIMARY KEY NOT NULL,
            name TEXT NOT NULL
        );
    `;

    db.run(queryRegions, (err) => {
        if (err) {
            console.error('Erro ao criar "regions":', err.message);
        } else {
            console.log(' Tabela "regions" criada/verificada.');
        }
    });

    // =========================================================
    // 3. MUNICIPALITIES
    // =========================================================
    const queryMunicipalities = `
        CREATE TABLE IF NOT EXISTS municipalities (
            ibge_code INTEGER PRIMARY KEY NOT NULL,
            city TEXT NOT NULL,
            uf TEXT NOT NULL CHECK(length(uf) = 2),
            latitude REAL,
            longitude REAL,
            region_id INTEGER,

            FOREIGN KEY (region_id)
                REFERENCES regions(id)
        );
    `;

    db.run(queryMunicipalities, (err) => {
        if (err) {
            console.error('Erro ao criar "municipalities":', err.message);
        } else {
            console.log(' Tabela "municipalities" criada/verificada.');
        }
    });

    // =========================================================
    // 4. PROFILES
    // =========================================================
    const queryProfiles = `
        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            cpf TEXT NOT NULL UNIQUE,
            birth_date TEXT NOT NULL,
            phone TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `;

    db.run(queryProfiles, (err) => {
        if (err) {
            console.error('Erro ao criar "profiles":', err.message);
        } else {
            console.log(' Tabela "profiles" criada/verificada.');
        }
    });

    // =========================================================
    // 5. ATTENDANTS
    // =========================================================
    const queryAttendants = `
        CREATE TABLE IF NOT EXISTS attendants (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,

            role TEXT NOT NULL DEFAULT 'attendant'
                CHECK(role IN ('attendant', 'supervisor', 'admin')),

            active INTEGER NOT NULL DEFAULT 1
                CHECK(active IN (0, 1)),

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

            ibge_code INTEGER,

            FOREIGN KEY (id)
                REFERENCES profiles(id),

            FOREIGN KEY (ibge_code)
                REFERENCES municipalities(ibge_code)
        );
    `;

    db.run(queryAttendants, (err) => {
        if (err) {
            console.error('Erro ao criar "attendants":', err.message);
        } else {
            console.log(' Tabela "attendants" criada/verificada.');
        }
    });

    // =========================================================
    // 6. SOS
    // =========================================================
    const querySos = `
        CREATE TABLE IF NOT EXISTS sos (
            id TEXT PRIMARY KEY NOT NULL,

            user_id TEXT NOT NULL,

            status TEXT NOT NULL
                CHECK(
                    status IN (
                        'active',
                        'cancelled',
                        'in_progress',
                        'finished',
                        'unresolved'
                    )
                ),

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            closed_at TEXT,

            attendant_id TEXT,

            dispatched_at TEXT,
            dispatch_eta TEXT,

            city TEXT,

            uf TEXT
                CHECK(uf IS NULL OR length(uf) = 2),

            ibge_code INTEGER,

            latitude REAL,
            longitude REAL,

            FOREIGN KEY (user_id)
                REFERENCES profiles(id),

            FOREIGN KEY (attendant_id)
                REFERENCES attendants(id),

            FOREIGN KEY (ibge_code)
                REFERENCES municipalities(ibge_code)
        );
    `;

    db.run(querySos, (err) => {
        if (err) {
            console.error('Erro ao criar "sos":', err.message);
        } else {
            console.log(' Tabela "sos" criada/verificada.');
        }
    });

    // =========================================================
    // 7. LOCATIONS
    // =========================================================
    const queryLocations = `
        CREATE TABLE IF NOT EXISTS locations (
            id TEXT PRIMARY KEY NOT NULL,

            sos_id TEXT NOT NULL,

            latitude REAL NOT NULL,
            longitude REAL NOT NULL,

            accuracy REAL,

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (sos_id)
                REFERENCES sos(id)
        );
    `;

    db.run(queryLocations, (err) => {
        if (err) {
            console.error('Erro ao criar "locations":', err.message);
        } else {
            console.log(' Tabela "locations" criada/verificada.');
        }
    });

    // =========================================================
    // 8. NOTIFICATIONS
    // =========================================================
    const queryNotifications = `
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY NOT NULL,

            user_id TEXT NOT NULL,
            sos_id TEXT NOT NULL,

            title TEXT NOT NULL,
            message TEXT NOT NULL,

            read INTEGER NOT NULL DEFAULT 0
                CHECK(read IN (0, 1)),

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (user_id)
                REFERENCES profiles(id),

            FOREIGN KEY (sos_id)
                REFERENCES sos(id)
        );
    `;

    db.run(queryNotifications, (err) => {
        if (err) {
            console.error('Erro ao criar "notifications":', err.message);
        } else {
            console.log(' Tabela "notifications" criada/verificada.');
        }
    });

    // =========================================================
    // 9. AUDIT LOG
    // =========================================================
    const queryAuditLog = `
        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY NOT NULL,

            table_name TEXT NOT NULL,
            record_id TEXT NOT NULL,

            action TEXT NOT NULL
                CHECK(action IN ('INSERT', 'UPDATE', 'DELETE')),

            changed_by TEXT,
            changed_by_email TEXT,

            old_data TEXT,
            new_data TEXT,

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `;

    db.run(queryAuditLog, (err) => {
        if (err) {
            console.error('Erro ao criar "audit_log":', err.message);
        } else {
            console.log(' Tabela "audit_log" criada/verificada.');
        }
    });

    // =========================================================
    // 10. ÍNDICES
    // =========================================================

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_sos_user_id
        ON sos(user_id);
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_sos_attendant_id
        ON sos(attendant_id);
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_sos_status
        ON sos(status);
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_locations_sos_id
        ON locations(sos_id);
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_notifications_user_id
        ON notifications(user_id);
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_notifications_sos_id
        ON notifications(sos_id);
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_record_id
        ON audit_log(record_id);
    `);

    console.log(' Tabela "audit_log" criada/verificada.');
});

// =============================================================
// FECHAR BANCO
// =============================================================
db.close((err) => {
    if (err) {
        console.error('Erro ao fechar o banco:', err.message);
    } else {
        console.log('Banco de dados pronto para uso!');
        console.log(`Local: ${DB_PATH}`);
    }
});