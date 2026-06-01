const { format } = require("date-fns");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { toMysqlDate } = require("../utils/dailyProfitReport");
const { normalizePhoneNumber } = require("../utils/whatsapp");
const {
  generateDailyProfitPdfFile,
  sendDailyProfitReportToRecipients,
} = require("../services/whatsappReportService");

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && toMysqlDate(date) === value;
};

const isValidTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

const getRecipients = async (_req, res) => {
  try {
    const [recipients] = await pool.query(
      `
      SELECT
        recipient_id,
        name,
        phone_number,
        is_active,
        created_at,
        updated_at
      FROM whatsapp_recipients
      ORDER BY is_active DESC, name ASC
      `
    );

    res.status(200).json({ recipients });
  } catch (error) {
    console.error("Error fetching WhatsApp recipients:", error);
    res.status(500).json({
      message: "Gagal mengambil daftar nomor WhatsApp.",
      error: error.message,
    });
  }
};

const createRecipient = async (req, res) => {
  const { name, phone_number, is_active = true } = req.body;
  const normalizedPhone = normalizePhoneNumber(phone_number);

  if (!name || !String(name).trim() || !normalizedPhone) {
    return res.status(400).json({
      message: "Nama dan nomor WhatsApp harus diisi dengan benar.",
    });
  }

  try {
    const recipientId = uuidv4();
    await pool.query(
      `
      INSERT INTO whatsapp_recipients
        (recipient_id, name, phone_number, is_active, created_by)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        recipientId,
        String(name).trim(),
        normalizedPhone,
        is_active ? 1 : 0,
        req.user.user_id,
      ]
    );

    res.status(201).json({
      message: "Nomor WhatsApp berhasil didaftarkan.",
      recipient: {
        recipient_id: recipientId,
        name: String(name).trim(),
        phone_number: normalizedPhone,
        is_active: is_active ? 1 : 0,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Nomor WhatsApp sudah terdaftar.",
      });
    }

    console.error("Error creating WhatsApp recipient:", error);
    res.status(500).json({
      message: "Gagal mendaftarkan nomor WhatsApp.",
      error: error.message,
    });
  }
};

const updateRecipient = async (req, res) => {
  const { id } = req.params;
  const { name, phone_number, is_active } = req.body;
  const normalizedPhone =
    typeof phone_number === "undefined" ? undefined : normalizePhoneNumber(phone_number);

  if (!name && typeof phone_number === "undefined" && typeof is_active === "undefined") {
    return res.status(400).json({
      message: "Tidak ada data yang diubah.",
    });
  }

  if (typeof phone_number !== "undefined" && !normalizedPhone) {
    return res.status(400).json({
      message: "Nomor WhatsApp tidak valid.",
    });
  }

  try {
    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(String(name).trim());
    }

    if (typeof normalizedPhone !== "undefined") {
      fields.push("phone_number = ?");
      values.push(normalizedPhone);
    }

    if (typeof is_active !== "undefined") {
      fields.push("is_active = ?");
      values.push(is_active ? 1 : 0);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const [result] = await pool.query(
      `UPDATE whatsapp_recipients SET ${fields.join(", ")} WHERE recipient_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Nomor WhatsApp tidak ditemukan." });
    }

    res.status(200).json({ message: "Nomor WhatsApp berhasil diperbarui." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Nomor WhatsApp sudah terdaftar.",
      });
    }

    console.error("Error updating WhatsApp recipient:", error);
    res.status(500).json({
      message: "Gagal memperbarui nomor WhatsApp.",
      error: error.message,
    });
  }
};

const deleteRecipient = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      "DELETE FROM whatsapp_recipients WHERE recipient_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Nomor WhatsApp tidak ditemukan." });
    }

    res.status(200).json({ message: "Nomor WhatsApp berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting WhatsApp recipient:", error);
    res.status(500).json({
      message: "Gagal menghapus nomor WhatsApp.",
      error: error.message,
    });
  }
};

const sendDailyProfitReport = async (req, res) => {
  const { date = format(new Date(), "yyyy-MM-dd"), recipient_ids = [], store_id = "" } = req.body;

  if (!isValidDate(date)) {
    return res.status(400).json({
      message: "Tanggal laporan tidak valid. Gunakan format YYYY-MM-DD.",
    });
  }

  try {
    const result = await sendDailyProfitReportToRecipients({
      date,
      recipientIds: recipient_ids,
      storeId: store_id,
      sentBy: req.user.user_id,
    });

    res.status(result.sent > 0 ? 200 : 502).json({
      message:
        result.sent > 0
          ? "Laporan keuntungan harian berhasil diproses."
          : "PDF berhasil dibuat, tetapi pengiriman WhatsApp gagal.",
      ...result,
    });
  } catch (error) {
    console.error("Error sending daily profit WhatsApp report:", error);
    res.status(error.statusCode || 500).json({
      message: "Gagal membuat atau mengirim laporan keuntungan harian.",
      error: error.message,
    });
  }
};

const generateDailyProfitPdfOnly = async (req, res) => {
  const { date = format(new Date(), "yyyy-MM-dd"), store_id = "" } = req.body;

  if (!isValidDate(date)) {
    return res.status(400).json({
      message: "Tanggal laporan tidak valid. Gunakan format YYYY-MM-DD.",
    });
  }

  try {
    const result = await generateDailyProfitPdfFile({
      date,
      storeId: store_id,
    });

    res.status(200).json({
      message: "PDF laporan keuntungan berhasil dibuat.",
      report_date: result.report_date,
      previous_date: result.previous_date,
      file_name: result.file_name,
      pdf_key: result.pdf_key,
      pdf_url: result.pdf_url,
    });
  } catch (error) {
    console.error("Error generating daily profit PDF:", error);
    res.status(500).json({
      message: "Gagal membuat PDF laporan keuntungan harian.",
      error: error.message,
    });
  }
};

const getSchedules = async (_req, res) => {
  try {
    const [schedules] = await pool.query(
      `
      SELECT
        schedule_id,
        TIME_FORMAT(scheduled_time, '%H:%i') AS scheduled_time,
        is_active,
        created_at,
        updated_at
      FROM whatsapp_report_schedules
      ORDER BY scheduled_time ASC
      `
    );

    res.status(200).json({ schedules });
  } catch (error) {
    console.error("Error fetching WhatsApp schedules:", error);
    res.status(500).json({
      message: "Gagal mengambil jadwal kirim WhatsApp.",
      error: error.message,
    });
  }
};

const createSchedule = async (req, res) => {
  const { scheduled_time, is_active = true } = req.body;

  if (!isValidTime(scheduled_time)) {
    return res.status(400).json({
      message: "Jam kirim tidak valid. Gunakan format HH:mm.",
    });
  }

  try {
    const scheduleId = uuidv4();
    await pool.query(
      `
      INSERT INTO whatsapp_report_schedules
        (schedule_id, scheduled_time, is_active, created_by)
      VALUES (?, ?, ?, ?)
      `,
      [scheduleId, `${scheduled_time}:00`, is_active ? 1 : 0, req.user.user_id]
    );

    res.status(201).json({
      message: "Jadwal kirim berhasil dibuat.",
      schedule: {
        schedule_id: scheduleId,
        scheduled_time,
        is_active: is_active ? 1 : 0,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Jadwal jam tersebut sudah terdaftar.",
      });
    }

    console.error("Error creating WhatsApp schedule:", error);
    res.status(500).json({
      message: "Gagal membuat jadwal kirim WhatsApp.",
      error: error.message,
    });
  }
};

const updateSchedule = async (req, res) => {
  const { id } = req.params;
  const { scheduled_time, is_active } = req.body;

  if (typeof scheduled_time === "undefined" && typeof is_active === "undefined") {
    return res.status(400).json({
      message: "Tidak ada data jadwal yang diubah.",
    });
  }

  if (typeof scheduled_time !== "undefined" && !isValidTime(scheduled_time)) {
    return res.status(400).json({
      message: "Jam kirim tidak valid. Gunakan format HH:mm.",
    });
  }

  try {
    const fields = [];
    const values = [];

    if (typeof scheduled_time !== "undefined") {
      fields.push("scheduled_time = ?");
      values.push(`${scheduled_time}:00`);
    }

    if (typeof is_active !== "undefined") {
      fields.push("is_active = ?");
      values.push(is_active ? 1 : 0);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const [result] = await pool.query(
      `UPDATE whatsapp_report_schedules SET ${fields.join(", ")} WHERE schedule_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Jadwal kirim tidak ditemukan." });
    }

    res.status(200).json({ message: "Jadwal kirim berhasil diperbarui." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Jadwal jam tersebut sudah terdaftar.",
      });
    }

    console.error("Error updating WhatsApp schedule:", error);
    res.status(500).json({
      message: "Gagal memperbarui jadwal kirim WhatsApp.",
      error: error.message,
    });
  }
};

const deleteSchedule = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      "DELETE FROM whatsapp_report_schedules WHERE schedule_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Jadwal kirim tidak ditemukan." });
    }

    res.status(200).json({ message: "Jadwal kirim berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting WhatsApp schedule:", error);
    res.status(500).json({
      message: "Gagal menghapus jadwal kirim WhatsApp.",
      error: error.message,
    });
  }
};

module.exports = {
  createRecipient,
  createSchedule,
  deleteRecipient,
  deleteSchedule,
  getRecipients,
  getSchedules,
  generateDailyProfitPdfOnly,
  sendDailyProfitReport,
  updateSchedule,
  updateRecipient,
};
