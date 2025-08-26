// src/controllers/storeController.js
const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");

const createStore = async (req, res) => {
  const { store_name, address, employees } = req.body;

  if (!store_name || !address) {
    return res
      .status(400)
      .json({ message: "Nama toko dan alamat harus diisi." });
  }
  if (!Array.isArray(employees) || employees.length === 0) {
    return res
      .status(400)
      .json({ message: "Setidaknya satu karyawan harus ditugaskan ke toko." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingStore] = await connection.query(
      "SELECT store_id FROM stores WHERE store_name = ?",
      [store_name]
    );
    if (existingStore.length > 0) {
      await connection.rollback();
      return res.status(409).json({ message: "Nama toko sudah ada." });
    }

    const store_id = uuidv4();
    await connection.query(
      "INSERT INTO stores (store_id, store_name, address) VALUES (?, ?, ?)",
      [store_id, store_name, address]
    );

    for (const userId of employees) {
      const [userCheck] = await connection.query(
        "SELECT user_id, role FROM users WHERE user_id = ?",
        [userId]
      );
      if (userCheck.length === 0 || userCheck[0].role !== "karyawan") {
        await connection.rollback();
        return res.status(400).json({
          message: `Karyawan dengan ID ${userId} tidak ditemukan atau bukan peran 'karyawan'.`,
        });
      }

      // Generate UUID for store_employee record
      const store_employee_id = uuidv4();
      await connection.query(
        "INSERT INTO store_employees (store_employee_id, store_id, user_id) VALUES (?, ?, ?)",
        [store_employee_id, store_id, userId]
      );
    }

    await connection.commit();
    res.status(201).json({
      message: "Toko berhasil dibuat.",
      store_id,
      store_name,
      address,
      assigned_employees: employees,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error creating store:", error);
    res
      .status(500)
      .json({ message: "Gagal membuat toko.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const getAllStores = async (req, res) => {
  const { user_id, role } = req.user;
  let query = `
        SELECT
            s.store_id,
            s.store_name,
            s.address,
            s.created_at,
            GROUP_CONCAT(DISTINCT u.username ORDER BY u.username) AS employee_usernames,
            COUNT(DISTINCT se.user_id) AS employee_count
        FROM stores s
        LEFT JOIN store_employees se ON s.store_id = se.store_id
        LEFT JOIN users u ON se.user_id = u.user_id AND u.role = 'karyawan'
    `;
  const queryParams = [];

  if (role === "karyawan") {
    query += ` WHERE s.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
    queryParams.push(user_id);
  }

  query += ` GROUP BY s.store_id, s.store_name, s.address, s.created_at ORDER BY s.store_name`;

  try {
    const [stores] = await pool.query(query, queryParams);
    res.status(200).json({ stores });
  } catch (error) {
    console.error("Error fetching stores:", error);
    res
      .status(500)
      .json({ message: "Gagal mendapatkan data toko.", error: error.message });
  }
};

const getStoreById = async (req, res) => {
  const { id } = req.params;
  const { user_id, role } = req.user;

  let query = `
        SELECT
            s.store_id,
            s.store_name,
            s.address,
            s.created_at,
            GROUP_CONCAT(DISTINCT u.username ORDER BY u.username) AS employee_usernames,
            GROUP_CONCAT(DISTINCT u.user_id ORDER BY u.username) AS employee_ids
        FROM stores s
        LEFT JOIN store_employees se ON s.store_id = se.store_id
        LEFT JOIN users u ON se.user_id = u.user_id AND u.role = 'karyawan'
        WHERE s.store_id = ?
    `;
  const queryParams = [id];

  if (role === "karyawan") {
    query += ` AND s.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
    queryParams.push(user_id);
  }

  query += ` GROUP BY s.store_id, s.store_name, s.address, s.created_at`;

  try {
    const [stores] = await pool.query(query, queryParams);
    if (stores.length === 0) {
      return res.status(404).json({
        message: "Toko tidak ditemukan atau Anda tidak memiliki akses.",
      });
    }

    const store = stores[0];
    store.employee_ids = store.employee_ids
      ? store.employee_ids.split(",")
      : [];
    store.employee_usernames = store.employee_usernames
      ? store.employee_usernames.split(",")
      : [];

    res.status(200).json(store);
  } catch (error) {
    console.error("Error fetching store by ID:", error);
    res
      .status(500)
      .json({ message: "Gagal mendapatkan data toko.", error: error.message });
  }
};

const updateStore = async (req, res) => {
  const { id } = req.params;
  const { store_name, address, employees } = req.body;
  const { role } = req.user;

  if (role !== "admin") {
    return res.status(403).json({
      message: "Akses ditolak. Hanya admin yang dapat mengupdate toko.",
    });
  }

  if (!store_name || !address) {
    return res
      .status(400)
      .json({ message: "Nama toko dan alamat harus diisi." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingStore] = await connection.query(
      "SELECT store_id FROM stores WHERE store_id = ?",
      [id]
    );
    if (existingStore.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Toko tidak ditemukan." });
    }

    const [duplicateStore] = await connection.query(
      "SELECT store_id FROM stores WHERE store_name = ? AND store_id != ?",
      [store_name, id]
    );
    if (duplicateStore.length > 0) {
      await connection.rollback();
      return res.status(409).json({ message: "Nama toko sudah digunakan." });
    }

    await connection.query(
      "UPDATE stores SET store_name = ?, address = ? WHERE store_id = ?",
      [store_name, address, id]
    );

    if (employees && Array.isArray(employees)) {
      // Delete existing employee assignments
      await connection.query("DELETE FROM store_employees WHERE store_id = ?", [
        id,
      ]);

      // Add new employee assignments
      for (const userId of employees) {
        const [userCheck] = await connection.query(
          "SELECT user_id, role FROM users WHERE user_id = ?",
          [userId]
        );
        if (userCheck.length === 0 || userCheck[0].role !== "karyawan") {
          await connection.rollback();
          return res.status(400).json({
            message: `Karyawan dengan ID ${userId} tidak ditemukan atau bukan peran 'karyawan'.`,
          });
        }

        // Generate UUID for new store_employee record
        const store_employee_id = uuidv4();
        await connection.query(
          "INSERT INTO store_employees (store_employee_id, store_id, user_id) VALUES (?, ?, ?)",
          [store_employee_id, id, userId]
        );
      }
    }

    await connection.commit();
    res.status(200).json({
      message: "Toko berhasil diupdate.",
      store_id: id,
      store_name,
      address,
      assigned_employees: employees || null,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error updating store:", error);
    res
      .status(500)
      .json({ message: "Gagal mengupdate toko.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

const deleteStore = async (req, res) => {
  const { id } = req.params;
  const { role } = req.user;

  if (role !== "admin") {
    return res.status(403).json({
      message: "Akses ditolak. Hanya admin yang dapat menghapus toko.",
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingStore] = await connection.query(
      "SELECT store_id, store_name FROM stores WHERE store_id = ?",
      [id]
    );
    if (existingStore.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Toko tidak ditemukan." });
    }

    const storeName = existingStore[0].store_name;

    // Check if store is being used in reports
    const [reportsUsingStore] = await connection.query(
      "SELECT report_id FROM reports WHERE store_id = ? LIMIT 1",
      [id]
    );

    if (reportsUsingStore.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Toko tidak dapat dihapus karena masih memiliki laporan terkait.",
      });
    }

    // Check if store has banks/payment methods
    const [banksUsingStore] = await connection.query(
      "SELECT bank_id FROM banks WHERE store_id = ? LIMIT 1",
      [id]
    );

    if (banksUsingStore.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Toko tidak dapat dihapus karena masih memiliki bank/metode pembayaran terkait.",
      });
    }

    // Delete store employees first (foreign key constraint)
    await connection.query("DELETE FROM store_employees WHERE store_id = ?", [
      id,
    ]);

    // Delete the store
    await connection.query("DELETE FROM stores WHERE store_id = ?", [id]);

    await connection.commit();
    res.status(200).json({
      message: `Toko '${storeName}' berhasil dihapus.`,
      deleted_store_id: id,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error deleting store:", error);
    res
      .status(500)
      .json({ message: "Gagal menghapus toko.", error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

// Helper function to get available employees (not assigned to any store)
const getAvailableEmployees = async (req, res) => {
  const { role } = req.user;

  if (role !== "admin") {
    return res.status(403).json({
      message: "Akses ditolak. Hanya admin yang dapat melihat data ini.",
    });
  }

  try {
    const [availableEmployees] = await pool.query(`
      SELECT u.user_id, u.username, u.email 
      FROM users u 
      WHERE u.role = 'karyawan' 
      AND u.user_id NOT IN (
        SELECT DISTINCT se.user_id 
        FROM store_employees se
      )
      ORDER BY u.username
    `);

    res.status(200).json({
      available_employees: availableEmployees,
      count: availableEmployees.length,
    });
  } catch (error) {
    console.error("Error fetching available employees:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data karyawan yang tersedia.",
      error: error.message,
    });
  }
};

// Helper function to get all employees
const getAllEmployees = async (req, res) => {
  const { role } = req.user;

  if (role !== "admin") {
    return res.status(403).json({
      message: "Akses ditolak. Hanya admin yang dapat melihat data ini.",
    });
  }

  try {
    const [employees] = await pool.query(`
      SELECT 
        u.user_id, 
        u.username, 
        u.email,
        s.store_name,
        s.store_id
      FROM users u 
      LEFT JOIN store_employees se ON u.user_id = se.user_id
      LEFT JOIN stores s ON se.store_id = s.store_id
      WHERE u.role = 'karyawan' 
      ORDER BY u.username, s.store_name
    `);

    res.status(200).json({
      employees,
      count: employees.length,
    });
  } catch (error) {
    console.error("Error fetching all employees:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data karyawan.",
      error: error.message,
    });
  }
};

module.exports = {
  createStore,
  getAllStores,
  getStoreById,
  updateStore,
  deleteStore,
  getAvailableEmployees,
  getAllEmployees,
};
