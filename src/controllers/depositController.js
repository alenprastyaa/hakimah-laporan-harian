const { format } = require("date-fns");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");

const parseAmount = (value) => {
  const normalized = String(value ?? "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");

  return Number(normalized);
};

const cleanText = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || "";
};

const parsePositiveInt = (value, fallback, max = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && format(date, "yyyy-MM-dd") === value;
};

const getDateRange = ({ start_date, end_date, period }) => {
  const today = new Date();
  const normalizedPeriod = ["today", "week", "month", "year"].includes(period) ? period : "";

  if (isValidDate(start_date) || isValidDate(end_date)) {
    return {
      startDate: isValidDate(start_date) ? start_date : null,
      endDate: isValidDate(end_date) ? end_date : null,
    };
  }

  if (normalizedPeriod === "today") {
    const date = format(today, "yyyy-MM-dd");
    return { startDate: date, endDate: date };
  }

  if (normalizedPeriod === "week") {
    const date = new Date(today);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return { startDate: format(date, "yyyy-MM-dd"), endDate: format(today, "yyyy-MM-dd") };
  }

  if (normalizedPeriod === "month") {
    return { startDate: format(today, "yyyy-MM-01"), endDate: format(today, "yyyy-MM-dd") };
  }

  if (normalizedPeriod === "year") {
    return { startDate: format(today, "yyyy-01-01"), endDate: format(today, "yyyy-MM-dd") };
  }

  return { startDate: null, endDate: null };
};

const buildDepositWhere = (req) => {
  const { user_id, role } = req.user;
  const search = cleanText(req.query.search);
  const recipientId = cleanText(req.query.recipient_id);
  const storeId = cleanText(req.query.store_id);
  const createdBy = cleanText(req.query.created_by);
  const { startDate, endDate } = getDateRange(req.query);
  const whereClauses = [];
  const params = [];

  if (role !== "admin") {
    whereClauses.push("d.created_by = ?");
    params.push(user_id);
  } else if (createdBy) {
    whereClauses.push("d.created_by = ?");
    params.push(createdBy);
  }

  if (recipientId) {
    whereClauses.push("d.recipient_id = ?");
    params.push(recipientId);
  }

  if (storeId) {
    whereClauses.push("COALESCE(d.store_id, inferred_store.store_id) = ?");
    params.push(storeId);
  }

  if (startDate) {
    whereClauses.push("DATE(d.created_at) >= ?");
    params.push(startDate);
  }

  if (endDate) {
    whereClauses.push("DATE(d.created_at) <= ?");
    params.push(endDate);
  }

  if (search) {
    const searchLike = `%${search}%`;
    const searchDigits = search.replace(/\D/g, "");
    const conditions = [
      "dr.name LIKE ?",
      "COALESCE(s.store_name, inferred_store.store_name) LIKE ?",
      "u.username LIKE ?",
      "CAST(d.amount AS CHAR) LIKE ?",
      "DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i') LIKE ?",
    ];
    params.push(searchLike, searchLike, searchLike, searchLike, searchLike);

    if (searchDigits) {
      conditions.push("REPLACE(CAST(d.amount AS CHAR), '.', '') LIKE ?");
      params.push(`%${searchDigits}%`);
    }

    whereClauses.push(`(${conditions.join(" OR ")})`);
  }

  return {
    whereSql: whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "",
    params,
    search,
    startDate,
    endDate,
    storeId,
  };
};

const userHasStoreAccess = async (userId, storeId) => {
  const [rows] = await pool.query(
    "SELECT store_employee_id FROM store_employees WHERE user_id = ? AND store_id = ? LIMIT 1",
    [userId, storeId],
  );
  return rows.length > 0;
};

const getRecipients = async (_req, res) => {
  try {
    const [recipients] = await pool.query(
      `
      SELECT
        recipient_id,
        name,
        is_active,
        created_at,
        updated_at
      FROM deposit_recipients
      ORDER BY is_active DESC, name ASC
      `,
    );

    res.status(200).json({ recipients });
  } catch (error) {
    console.error("Error fetching deposit recipients:", error);
    res.status(500).json({
      message: "Gagal mengambil daftar penerima setoran.",
      error: error.message,
    });
  }
};

const createRecipient = async (req, res) => {
  const name = cleanText(req.body.name);
  const isActive = typeof req.body.is_active === "undefined" ? true : Boolean(req.body.is_active);

  if (!name) {
    return res.status(400).json({ message: "Nama penerima harus diisi." });
  }

  try {
    const recipientId = uuidv4();
    await pool.query(
      `
      INSERT INTO deposit_recipients (recipient_id, name, is_active, created_by)
      VALUES (?, ?, ?, ?)
      `,
      [recipientId, name, isActive ? 1 : 0, req.user.user_id],
    );

    res.status(201).json({
      message: "Penerima setoran berhasil dibuat.",
      recipient: {
        recipient_id: recipientId,
        name,
        is_active: isActive ? 1 : 0,
      },
    });
  } catch (error) {
    console.error("Error creating deposit recipient:", error);
    res.status(500).json({
      message: "Gagal membuat penerima setoran.",
      error: error.message,
    });
  }
};

const updateRecipient = async (req, res) => {
  const { id } = req.params;
  const name = cleanText(req.body.name);
  const hasIsActive = typeof req.body.is_active !== "undefined";

  if (!name && !hasIsActive) {
    return res.status(400).json({ message: "Tidak ada data yang diubah." });
  }

  try {
    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }

    if (hasIsActive) {
      fields.push("is_active = ?");
      values.push(req.body.is_active ? 1 : 0);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const [result] = await pool.query(
      `UPDATE deposit_recipients SET ${fields.join(", ")} WHERE recipient_id = ?`,
      values,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Penerima setoran tidak ditemukan." });
    }

    res.status(200).json({ message: "Penerima setoran berhasil diperbarui." });
  } catch (error) {
    console.error("Error updating deposit recipient:", error);
    res.status(500).json({
      message: "Gagal memperbarui penerima setoran.",
      error: error.message,
    });
  }
};

const deleteRecipient = async (req, res) => {
  const { id } = req.params;

  try {
    const [usedRows] = await pool.query(
      "SELECT deposit_id FROM deposits WHERE recipient_id = ? LIMIT 1",
      [id],
    );

    if (usedRows.length > 0) {
      return res.status(409).json({
        message: "Penerima sudah dipakai pada data setoran. Nonaktifkan saja jika tidak digunakan lagi.",
      });
    }

    const [result] = await pool.query("DELETE FROM deposit_recipients WHERE recipient_id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Penerima setoran tidak ditemukan." });
    }

    res.status(200).json({ message: "Penerima setoran berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting deposit recipient:", error);
    res.status(500).json({
      message: "Gagal menghapus penerima setoran.",
      error: error.message,
    });
  }
};

const createDeposit = async (req, res) => {
  const amount = parseAmount(req.body.amount);
  const recipientId = cleanText(req.body.recipient_id);
  const storeId = cleanText(req.body.store_id);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "Total setoran harus lebih dari 0." });
  }

  if (!storeId) {
    return res.status(400).json({ message: "Toko harus dipilih." });
  }

  if (!recipientId) {
    return res.status(400).json({ message: "Penerima harus dipilih." });
  }

  try {
    const [stores] = await pool.query("SELECT store_id FROM stores WHERE store_id = ? LIMIT 1", [
      storeId,
    ]);

    if (stores.length === 0) {
      return res.status(400).json({ message: "Toko tidak ditemukan." });
    }

    if (req.user.role !== "admin" && !(await userHasStoreAccess(req.user.user_id, storeId))) {
      return res.status(403).json({ message: "Akses toko ditolak." });
    }

    const [recipients] = await pool.query(
      "SELECT recipient_id FROM deposit_recipients WHERE recipient_id = ? AND is_active = 1 LIMIT 1",
      [recipientId],
    );

    if (recipients.length === 0) {
      return res.status(400).json({ message: "Penerima tidak aktif atau tidak ditemukan." });
    }

    const depositId = uuidv4();
    const createdAt = new Date();
    await pool.query(
      `
      INSERT INTO deposits (deposit_id, amount, store_id, recipient_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [depositId, amount, storeId, recipientId, req.user.user_id, createdAt],
    );

    res.status(201).json({
      message: "Setoran berhasil disimpan.",
      deposit: {
        deposit_id: depositId,
        amount,
        store_id: storeId,
        recipient_id: recipientId,
        created_by: req.user.user_id,
        created_at: createdAt,
      },
    });
  } catch (error) {
    console.error("Error creating deposit:", error);
    res.status(500).json({
      message: "Gagal menyimpan setoran.",
      error: error.message,
    });
  }
};

const getDeposits = async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const limit = parsePositiveInt(req.query.limit, 10, 100);
  const offset = (page - 1) * limit;
  const { whereSql, params, search, startDate, endDate, storeId } = buildDepositWhere(req);

  try {
    const [deposits] = await pool.query(
      `
      SELECT
        d.deposit_id,
        d.amount,
        COALESCE(d.store_id, inferred_store.store_id) AS store_id,
        COALESCE(s.store_name, inferred_store.store_name) AS store_name,
        d.recipient_id,
        dr.name AS recipient_name,
        dr.is_active AS recipient_is_active,
        d.created_by,
        u.username AS created_by_username,
        u.role AS created_by_role,
        d.created_at
      FROM deposits d
      LEFT JOIN stores s ON s.store_id = d.store_id
      LEFT JOIN (
        SELECT
          se.user_id,
          MIN(se.store_id) AS store_id,
          MIN(st.store_name) AS store_name,
          COUNT(DISTINCT se.store_id) AS store_count
        FROM store_employees se
        INNER JOIN stores st ON st.store_id = se.store_id
        GROUP BY se.user_id
      ) inferred_store ON inferred_store.user_id = d.created_by
        AND d.store_id IS NULL
        AND inferred_store.store_count = 1
      INNER JOIN deposit_recipients dr ON dr.recipient_id = d.recipient_id
      LEFT JOIN users u ON u.user_id = d.created_by
      ${whereSql}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    const [countRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM deposits d
      LEFT JOIN stores s ON s.store_id = d.store_id
      LEFT JOIN (
        SELECT
          se.user_id,
          MIN(se.store_id) AS store_id,
          MIN(st.store_name) AS store_name,
          COUNT(DISTINCT se.store_id) AS store_count
        FROM store_employees se
        INNER JOIN stores st ON st.store_id = se.store_id
        GROUP BY se.user_id
      ) inferred_store ON inferred_store.user_id = d.created_by
        AND d.store_id IS NULL
        AND inferred_store.store_count = 1
      INNER JOIN deposit_recipients dr ON dr.recipient_id = d.recipient_id
      LEFT JOIN users u ON u.user_id = d.created_by
      ${whereSql}
      `,
      params,
    );

    const total = Number(countRows[0]?.total || 0);

    res.status(200).json({
      deposits,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
      filters: {
        search,
        start_date: startDate,
        end_date: endDate,
        recipient_id: cleanText(req.query.recipient_id),
        store_id: storeId,
      },
    });
  } catch (error) {
    console.error("Error fetching deposits:", error);
    res.status(500).json({
      message: "Gagal mengambil data setoran.",
      error: error.message,
    });
  }
};

const getDepositSummary = async (req, res) => {
  const { user_id, role } = req.user;
  const createdBy = cleanText(req.query.created_by);
  const recipientId = cleanText(req.query.recipient_id);
  const storeId = cleanText(req.query.store_id);
  const baseWhere = [];
  const params = [];

  if (role !== "admin") {
    baseWhere.push("created_by = ?");
    params.push(user_id);
  } else if (createdBy) {
    baseWhere.push("created_by = ?");
    params.push(createdBy);
  }

  if (recipientId) {
    baseWhere.push("recipient_id = ?");
    params.push(recipientId);
  }

  if (storeId) {
    baseWhere.push("store_id = ?");
    params.push(storeId);
  }

  const baseWhereSql = baseWhere.length ? `AND ${baseWhere.join(" AND ")}` : "";

  try {
    const [rows] = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN amount ELSE 0 END), 0) AS today,
        COALESCE(SUM(CASE WHEN YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1) THEN amount ELSE 0 END), 0) AS week,
        COALESCE(SUM(CASE WHEN YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE()) THEN amount ELSE 0 END), 0) AS month,
        COALESCE(SUM(CASE WHEN YEAR(created_at) = YEAR(CURDATE()) THEN amount ELSE 0 END), 0) AS year
      FROM deposits
      WHERE 1 = 1 ${baseWhereSql}
      `,
      params,
    );

    res.status(200).json({
      summary: {
        today: Number(rows[0]?.today || 0),
        week: Number(rows[0]?.week || 0),
        month: Number(rows[0]?.month || 0),
        year: Number(rows[0]?.year || 0),
      },
    });
  } catch (error) {
    console.error("Error fetching deposit summary:", error);
    res.status(500).json({
      message: "Gagal mengambil ringkasan setoran.",
      error: error.message,
    });
  }
};

const deleteDeposit = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query("DELETE FROM deposits WHERE deposit_id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Data setoran tidak ditemukan." });
    }

    res.status(200).json({ message: "Data setoran berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting deposit:", error);
    res.status(500).json({
      message: "Gagal menghapus data setoran.",
      error: error.message,
    });
  }
};

module.exports = {
  createDeposit,
  createRecipient,
  deleteDeposit,
  deleteRecipient,
  getDeposits,
  getDepositSummary,
  getRecipients,
  updateRecipient,
};
