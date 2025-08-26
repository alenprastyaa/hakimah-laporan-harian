// src/controllers/reportController.js
const { pool } = require("../config/db");
const { format } = require("date-fns");
const { v4: uuidv4 } = require("uuid");

const createReport = async (req, res) => {
  const { store_id, report_date, balances, keterangan, uang_nitip } = req.body;
  const created_by = req.user.user_id;

  if (
    !store_id ||
    !report_date ||
    !Array.isArray(balances) ||
    balances.length === 0 ||
    typeof uang_nitip === "undefined" ||
    typeof uang_nitip !== "number"
  ) {
    return res.status(400).json({
      message:
        "ID Toko, tanggal laporan, saldo bank, dan uang nitip harus diisi dengan benar.",
    });
  }

  let total_balance = 0;
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingReport] = await connection.query(
      "SELECT report_id FROM reports WHERE store_id = ? AND report_date = ?",
      [store_id, report_date]
    );
    if (existingReport.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        message: "Laporan untuk toko ini pada tanggal ini sudah ada.",
      });
    }

    for (const balance of balances) {
      if (
        !balance.bank_id ||
        typeof balance.saldo !== "number" ||
        balance.saldo < 0
      ) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Format saldo bank tidak valid (bank_id dan saldo numerik positif diperlukan).",
        });
      }
      const [bankCheck] = await connection.query(
        "SELECT bank_id FROM banks WHERE bank_id = ?",
        [balance.bank_id]
      );
      if (bankCheck.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          message: `Bank dengan ID ${balance.bank_id} tidak ditemukan.`,
        });
      }
      total_balance += balance.saldo;
    }

    // Add uang_nitip to total_balance
    total_balance += uang_nitip;

    const report_id = uuidv4();
    await connection.query(
      "INSERT INTO reports (report_id, store_id, report_date, total_balance, created_by, keterangan, uang_nitip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        report_id,
        store_id,
        report_date,
        total_balance,
        created_by,
        keterangan || null,
        uang_nitip,
      ]
    );

    // Generate UUID for each report_balance record
    for (const balance of balances) {
      const report_balance_id = uuidv4();
      await connection.query(
        "INSERT INTO report_balances (report_balance_id, report_id, bank_id, saldo) VALUES (?, ?, ?, ?)",
        [report_balance_id, report_id, balance.bank_id, balance.saldo]
      );
    }

    await connection.commit();
    res.status(201).json({
      message: "Laporan berhasil dibuat.",
      report_id,
      store_id,
      report_date,
      total_balance,
      keterangan,
      uang_nitip,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error creating report:", error);
    res
      .status(500)
      .json({ message: "Gagal membuat laporan.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const getAllReports = async (req, res) => {
  const { user_id, role } = req.user;
  const { store_id, start_date, end_date, creator_id } = req.query;

  let query = `
        SELECT
            r.report_id,
            r.store_id,
            s.store_name,
            r.report_date,
            r.total_balance,
            r.keterangan,
            r.uang_nitip,
            r.created_by,
            u.username AS creator_username,
            r.created_at
        FROM reports r
        JOIN stores s ON r.store_id = s.store_id
        JOIN users u ON r.created_by = u.user_id
        WHERE 1=1
    `;
  const queryParams = [];

  if (role === "karyawan") {
    query += ` AND r.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
    queryParams.push(user_id);
    if (store_id && !(await hasEmployeeAccessToStore(user_id, store_id))) {
      return res.status(403).json({
        message:
          "Akses ditolak. Karyawan tidak terhubung dengan toko yang diminta.",
      });
    }
  }

  if (store_id) {
    query += ` AND r.store_id = ?`;
    queryParams.push(store_id);
  }
  if (start_date) {
    query += ` AND r.report_date >= ?`;
    queryParams.push(start_date);
  }
  if (end_date) {
    query += ` AND r.report_date <= ?`;
    queryParams.push(end_date);
  }
  if (creator_id && role === "admin") {
    query += ` AND r.created_by = ?`;
    queryParams.push(creator_id);
  } else if (creator_id && role === "karyawan" && creator_id !== user_id) {
    return res.status(403).json({
      message:
        "Akses ditolak. Karyawan hanya dapat melihat laporan yang dibuat oleh dirinya sendiri.",
    });
  } else if (role === "karyawan" && !creator_id) {
    query += ` AND r.created_by = ?`;
    queryParams.push(user_id);
  }

  query += ` ORDER BY r.report_date DESC, r.created_at DESC`;

  try {
    const [reports] = await pool.query(query, queryParams);
    for (let report of reports) {
      const [balances] = await pool.query(
        `SELECT rb.bank_id, b.bank_name, rb.saldo
                 FROM report_balances rb
                 JOIN banks b ON rb.bank_id = b.bank_id
                 WHERE rb.report_id = ?`,
        [report.report_id]
      );
      report.balances_detail = balances;
    }

    res.status(200).json({ reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res
      .status(500)
      .json({ message: "Gagal mendapatkan laporan.", error: error.message });
  }
};

const getReportById = async (req, res) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  let query = `
        SELECT
            r.report_id,
            r.store_id,
            s.store_name,
            s.address,
            r.report_date,
            r.total_balance,
            r.keterangan,
            r.uang_nitip,
            r.created_by,
            u.username AS creator_username,
            r.created_at
        FROM reports r
        JOIN stores s ON r.store_id = s.store_id
        JOIN users u ON r.created_by = u.user_id
        WHERE r.report_id = ?
    `;
  const queryParams = [id];

  if (role === "karyawan") {
    query += ` AND r.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
    queryParams.push(user_id);
  }

  try {
    const [reports] = await pool.query(query, queryParams);
    if (reports.length === 0) {
      return res.status(404).json({
        message: "Laporan tidak ditemukan atau Anda tidak memiliki akses.",
      });
    }

    const report = reports[0];
    const [balances] = await pool.query(
      `SELECT rb.bank_id, b.bank_name, rb.saldo
             FROM report_balances rb
             JOIN banks b ON rb.bank_id = b.bank_id
             WHERE rb.report_id = ?`,
      [report.report_id]
    );
    report.balances_detail = balances;

    res.status(200).json(report);
  } catch (error) {
    console.error("Error fetching report by ID:", error);
    res
      .status(500)
      .json({ message: "Gagal mendapatkan laporan.", error: error.message });
  }
};

const updateReport = async (req, res) => {
  const { id } = req.params;
  const { store_id, report_date, balances, keterangan, uang_nitip } = req.body;
  const { user_id, role } = req.user;

  if (
    !store_id ||
    !report_date ||
    !Array.isArray(balances) ||
    balances.length === 0 ||
    typeof uang_nitip === "undefined" ||
    typeof uang_nitip !== "number"
  ) {
    return res.status(400).json({
      message:
        "ID Toko, tanggal laporan, saldo bank, dan uang nitip harus diisi dengan benar.",
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingReport] = await connection.query(
      "SELECT r.report_id, r.store_id, r.created_by, r.report_date FROM reports r WHERE r.report_id = ?",
      [id]
    );

    if (existingReport.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Laporan tidak ditemukan.",
      });
    }

    const currentReport = existingReport[0];

    if (role === "karyawan") {
      const hasCurrentAccess = await hasEmployeeAccessToStore(
        user_id,
        currentReport.store_id
      );
      const hasNewAccess = await hasEmployeeAccessToStore(user_id, store_id);

      if (!hasCurrentAccess || !hasNewAccess) {
        await connection.rollback();
        return res.status(403).json({
          message: "Akses ditolak. Anda tidak memiliki akses ke toko ini.",
        });
      }

      if (currentReport.created_by !== user_id) {
        await connection.rollback();
        return res.status(403).json({
          message:
            "Akses ditolak. Karyawan hanya dapat mengubah laporan yang dibuat sendiri.",
        });
      }
    }

    const [conflictCheck] = await connection.query(
      "SELECT report_id FROM reports WHERE store_id = ? AND report_date = ? AND report_id != ?",
      [store_id, report_date, id]
    );

    if (conflictCheck.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        message: "Laporan untuk toko ini pada tanggal ini sudah ada.",
      });
    }

    let total_balance = 0;
    for (const balance of balances) {
      if (
        !balance.bank_id ||
        typeof balance.saldo !== "number" ||
        balance.saldo < 0
      ) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Format saldo bank tidak valid (bank_id dan saldo numerik positif diperlukan).",
        });
      }

      const [bankCheck] = await connection.query(
        "SELECT bank_id FROM banks WHERE bank_id = ?",
        [balance.bank_id]
      );

      if (bankCheck.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          message: `Bank dengan ID ${balance.bank_id} tidak ditemukan.`,
        });
      }

      total_balance += balance.saldo;
    }

    // Add uang_nitip to total_balance
    total_balance += uang_nitip;

    await connection.query(
      "UPDATE reports SET store_id = ?, report_date = ?, total_balance = ?, keterangan = ?, uang_nitip = ? WHERE report_id = ?",
      [store_id, report_date, total_balance, keterangan || null, uang_nitip, id]
    );

    await connection.query("DELETE FROM report_balances WHERE report_id = ?", [
      id,
    ]);

    // Generate new UUIDs for updated report_balance records
    for (const balance of balances) {
      const report_balance_id = uuidv4();
      await connection.query(
        "INSERT INTO report_balances (report_balance_id, report_id, bank_id, saldo) VALUES (?, ?, ?, ?)",
        [report_balance_id, id, balance.bank_id, balance.saldo]
      );
    }

    await connection.commit();
    res.status(200).json({
      message: "Laporan berhasil diperbarui.",
      report_id: id,
      store_id,
      report_date,
      total_balance,
      keterangan,
      uang_nitip,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error updating report:", error);
    res
      .status(500)
      .json({ message: "Gagal memperbarui laporan.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const deleteReport = async (req, res) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let checkQuery = `
      SELECT r.report_id, r.store_id, r.created_by, s.store_name
      FROM reports r
      JOIN stores s ON r.store_id = s.store_id
      WHERE r.report_id = ?
    `;
    const checkParams = [id];

    if (role === "karyawan") {
      checkQuery += ` AND r.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
      checkParams.push(user_id);
    }

    const [existingReport] = await connection.query(checkQuery, checkParams);

    if (existingReport.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Laporan tidak ditemukan atau Anda tidak memiliki akses.",
      });
    }

    const currentReport = existingReport[0];

    if (role === "karyawan" && currentReport.created_by !== user_id) {
      await connection.rollback();
      return res.status(403).json({
        message:
          "Akses ditolak. Karyawan hanya dapat menghapus laporan yang dibuat sendiri.",
      });
    }

    await connection.query("DELETE FROM report_balances WHERE report_id = ?", [
      id,
    ]);

    await connection.query("DELETE FROM reports WHERE report_id = ?", [id]);

    await connection.commit();
    res.status(200).json({
      message: "Laporan berhasil dihapus.",
      deleted_report: {
        report_id: id,
        store_name: currentReport.store_name,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error deleting report:", error);
    res
      .status(500)
      .json({ message: "Gagal menghapus laporan.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const getProfitAnalysis = async (req, res) => {
  const { store_id, date } = req.query;
  const { user_id, role } = req.user;

  if (!date) {
    return res
      .status(400)
      .json({ message: "Parameter tanggal (date) harus diisi." });
  }

  let targetStoreId = store_id;

  if (role === "karyawan") {
    if (!store_id) {
      return res
        .status(400)
        .json({ message: "ID Toko (store_id) harus diisi untuk karyawan." });
    }
    const hasAccess = await hasEmployeeAccessToStore(user_id, store_id);
    if (!hasAccess) {
      return res.status(403).json({
        message: "Akses ditolak. Anda tidak terhubung dengan toko ini.",
      });
    }
    targetStoreId = store_id;
  }

  try {
    let storesToAnalyze = [];
    if (targetStoreId) {
      const [store] = await pool.query(
        "SELECT store_id, store_name FROM stores WHERE store_id = ?",
        [targetStoreId]
      );
      if (store.length === 0) {
        return res.status(404).json({ message: "Toko tidak ditemukan." });
      }
      storesToAnalyze.push(store[0]);
    } else if (role === "admin") {
      const [allStores] = await pool.query(
        "SELECT store_id, store_name FROM stores"
      );
      storesToAnalyze = allStores;
    } else {
      return res
        .status(400)
        .json({ message: "Parameter store_id diperlukan untuk karyawan." });
    }

    const profitResults = [];

    for (const store of storesToAnalyze) {
      const today = new Date(date);
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      const formattedToday = format(today, "yyyy-MM-dd");
      const formattedYesterday = format(yesterday, "yyyy-MM-dd");

      const [todayReport] = await pool.query(
        "SELECT total_balance FROM reports WHERE store_id = ? AND report_date = ?",
        [store.store_id, formattedToday]
      );

      const [yesterdayReport] = await pool.query(
        "SELECT total_balance FROM reports WHERE store_id = ? AND report_date = ?",
        [store.store_id, formattedYesterday]
      );

      const today_balance =
        todayReport.length > 0 ? todayReport[0].total_balance : 0;
      const yesterday_balance =
        yesterdayReport.length > 0 ? yesterdayReport[0].total_balance : 0;
      const profit = today_balance - yesterday_balance;

      profitResults.push({
        store_id: store.store_id,
        store_name: store.store_name,
        date: formattedToday,
        today_balance,
        yesterday_balance,
        profit,
      });
    }

    res.status(200).json({ analysis: profitResults });
  } catch (error) {
    console.error("Error getting profit analysis:", error);
    res.status(500).json({
      message: "Gagal melakukan analisis profit.",
      error: error.message,
    });
  }
};

async function hasEmployeeAccessToStore(userId, storeId) {
  try {
    const [rows] = await pool.query(
      "SELECT store_employee_id FROM store_employees WHERE user_id = ? AND store_id = ?",
      [userId, storeId]
    );
    return rows.length > 0;
  } catch (error) {
    console.error("Error in hasEmployeeAccessToStore:", error);
    return false;
  }
}

const removeUangNitip = async (req, res) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if the report exists and the user has access
    let checkQuery = `
      SELECT r.report_id, r.store_id, r.created_by, r.total_balance, r.uang_nitip
      FROM reports r
      WHERE r.report_id = ?
    `;
    const checkParams = [id];

    if (role === "karyawan") {
      checkQuery += ` AND r.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
      checkParams.push(user_id);
    }

    const [existingReport] = await connection.query(checkQuery, checkParams);

    if (existingReport.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        message: "Laporan tidak ditemukan atau Anda tidak memiliki akses.",
      });
    }

    const currentReport = existingReport[0];

    if (role === "karyawan" && currentReport.created_by !== user_id) {
      await connection.rollback();
      return res.status(403).json({
        message:
          "Akses ditolak. Karyawan hanya dapat mengubah laporan yang dibuat sendiri.",
      });
    }

    // Calculate new total_balance by subtracting uang_nitip
    const new_total_balance =
      currentReport.total_balance - currentReport.uang_nitip;

    // Update both uang_nitip and total_balance
    await connection.query(
      "UPDATE reports SET uang_nitip = ?, total_balance = ? WHERE report_id = ?",
      [0, new_total_balance, id]
    );

    await connection.commit();
    res.status(200).json({
      message: "Uang nitip berhasil dihapus dari laporan.",
      report_id: id,
      new_uang_nitip: 0,
      new_total_balance: new_total_balance,
      removed_uang_nitip: currentReport.uang_nitip,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error removing uang nitip from report:", error);
    res.status(500).json({
      message: "Gagal menghapus uang nitip dari laporan.",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  removeUangNitip,
  createReport,
  getAllReports,
  getReportById,
  updateReport,
  deleteReport,
  getProfitAnalysis,
};
