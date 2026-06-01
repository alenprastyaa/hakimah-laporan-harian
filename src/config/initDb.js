const { pool } = require("./db");

const addColumnIfMissing = async (tableName, columnName, columnDefinition) => {
  const [rows] = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [tableName, columnName],
  );

  if (rows.length === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
};

const initializeDatabase = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      withdrawal_id CHAR(36) NOT NULL,
      withdrawal_name VARCHAR(150) NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      ktp_file_name VARCHAR(255) NOT NULL,
      ktp_file_key VARCHAR(500) NOT NULL,
      ktp_file_url VARCHAR(1000) NOT NULL,
      ktp_ocr_status VARCHAR(30) DEFAULT 'pending',
      ktp_ocr_text TEXT NULL,
      ktp_ocr_error VARCHAR(500) NULL,
      ktp_nik VARCHAR(32) NULL,
      ktp_name VARCHAR(150) NULL,
      ktp_birth_place VARCHAR(100) NULL,
      ktp_birth_date DATE NULL,
      ktp_gender VARCHAR(30) NULL,
      ktp_address TEXT NULL,
      created_by CHAR(36) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (withdrawal_id),
      KEY idx_withdrawals_created_by (created_by),
      KEY idx_withdrawals_created_at (created_at),
      CONSTRAINT fk_withdrawals_created_by
        FOREIGN KEY (created_by) REFERENCES users (user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await addColumnIfMissing("withdrawals", "ktp_ocr_status", "VARCHAR(30) DEFAULT 'pending'");
  await addColumnIfMissing("withdrawals", "ktp_ocr_text", "TEXT NULL");
  await addColumnIfMissing("withdrawals", "ktp_ocr_error", "VARCHAR(500) NULL");
  await addColumnIfMissing("withdrawals", "ktp_nik", "VARCHAR(32) NULL");
  await addColumnIfMissing("withdrawals", "ktp_name", "VARCHAR(150) NULL");
  await addColumnIfMissing("withdrawals", "ktp_birth_place", "VARCHAR(100) NULL");
  await addColumnIfMissing("withdrawals", "ktp_birth_date", "DATE NULL");
  await addColumnIfMissing("withdrawals", "ktp_gender", "VARCHAR(30) NULL");
  await addColumnIfMissing("withdrawals", "ktp_address", "TEXT NULL");
};

module.exports = { initializeDatabase };
