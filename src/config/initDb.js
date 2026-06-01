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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_recipients (
      recipient_id CHAR(36) NOT NULL,
      name VARCHAR(150) NOT NULL,
      phone_number VARCHAR(30) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by VARCHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (recipient_id),
      UNIQUE KEY uq_whatsapp_recipients_phone_number (phone_number),
      KEY idx_whatsapp_recipients_is_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_report_sends (
      send_id CHAR(36) NOT NULL,
      report_date DATE NOT NULL,
      pdf_file_key VARCHAR(500) NOT NULL,
      pdf_file_url VARCHAR(1000) NOT NULL,
      recipient_id CHAR(36) NULL,
      phone_number VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL,
      provider_response TEXT NULL,
      error_message TEXT NULL,
      sent_by VARCHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (send_id),
      KEY idx_whatsapp_report_sends_report_date (report_date),
      KEY idx_whatsapp_report_sends_status (status),
      KEY idx_whatsapp_report_sends_recipient_id (recipient_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_report_schedules (
      schedule_id CHAR(36) NOT NULL,
      scheduled_time TIME NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by VARCHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (schedule_id),
      UNIQUE KEY uq_whatsapp_report_schedules_time (scheduled_time),
      KEY idx_whatsapp_report_schedules_is_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_report_schedule_runs (
      run_id CHAR(36) NOT NULL,
      schedule_id CHAR(36) NOT NULL,
      report_date DATE NOT NULL,
      scheduled_time TIME NOT NULL,
      status VARCHAR(30) NOT NULL,
      sent_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      pdf_file_url VARCHAR(1000) NULL,
      error_message TEXT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL,
      PRIMARY KEY (run_id),
      UNIQUE KEY uq_whatsapp_report_schedule_runs_once (schedule_id, report_date, scheduled_time),
      KEY idx_whatsapp_report_schedule_runs_report_date (report_date),
      KEY idx_whatsapp_report_schedule_runs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
};

module.exports = { initializeDatabase };
