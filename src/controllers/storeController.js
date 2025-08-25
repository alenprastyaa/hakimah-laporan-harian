// src/controllers/storeController.js
const { pool } = require("../config/db");

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

    const [storeResult] = await connection.query(
      "INSERT INTO stores (store_name, address) VALUES (?, ?)",
      [store_name, address]
    );
    const [newStore] = await connection.query(
      "SELECT store_id FROM stores WHERE store_name = ?",
      [store_name]
    );
    const store_id = newStore[0].store_id;

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
      await connection.query(
        "INSERT INTO store_employees (store_id, user_id) VALUES (?, ?)",
        [store_id, userId]
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
            GROUP_CONCAT(u.username) AS employee_usernames
        FROM stores s
        LEFT JOIN store_employees se ON s.store_id = se.store_id
        LEFT JOIN users u ON se.user_id = u.user_id
    `;
  const queryParams = [];

  if (role === "karyawan") {
    query += ` WHERE s.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
    queryParams.push(user_id);
  }

  query += ` GROUP BY s.store_id`;

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
            GROUP_CONCAT(u.username) AS employee_usernames,
            GROUP_CONCAT(u.user_id) AS employee_ids
        FROM stores s
        LEFT JOIN store_employees se ON s.store_id = se.store_id
        LEFT JOIN users u ON se.user_id = u.user_id
        WHERE s.store_id = ?
    `;
  const queryParams = [id];

  if (role === "karyawan") {
    query += ` AND s.store_id IN (SELECT store_id FROM store_employees WHERE user_id = ?)`;
    queryParams.push(user_id);
  }

  query += ` GROUP BY s.store_id`;

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
      await connection.query("DELETE FROM store_employees WHERE store_id = ?", [
        id,
      ]);
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
        await connection.query(
          "INSERT INTO store_employees (store_id, user_id) VALUES (?, ?)",
          [id, userId]
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
    await connection.query("DELETE FROM store_employees WHERE store_id = ?", [
      id,
    ]);

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

module.exports = {
  createStore,
  getAllStores,
  getStoreById,
  updateStore,
  deleteStore,
};
