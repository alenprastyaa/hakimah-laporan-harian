const { pool } = require("../config/db");
const { v4: uuidv4 } = require('uuid');

const createBank = async (req, res) => {
  const { bank_name, store_id } = req.body;

  if (!bank_name) {
    return res
      .status(400)
      .json({ message: "Nama bank/pembayaran harus diisi." });
  }

  if (!store_id) {
    return res.status(400).json({ message: "Store ID harus diisi." });
  }

  try {
    const [store] = await pool.query(
      "SELECT store_id FROM stores WHERE store_id = ?",
      [store_id]
    );
    if (store.length === 0) {
      return res.status(404).json({ message: "Toko tidak ditemukan." });
    }

    await pool.query("INSERT INTO banks (bank_name, store_id) VALUES (?, ?)", [
      bank_name,
      store_id,
    ]);

    const [newBank] = await pool.query(
      "SELECT bank_id FROM banks WHERE bank_name = ? AND store_id = ?",
      [bank_name, store_id]
    );

    res.status(201).json({
      message: "Bank/Pembayaran berhasil dibuat.",
      bank_id: newBank[0].bank_id,
      bank_name,
      store_id,
    });
  } catch (error) {
    console.error("Error creating bank:", error);
    res.status(500).json({
      message: "Gagal membuat bank/pembayaran.",
      error: error.message,
    });
  }
};

const getAllBanks = async (req, res) => {
  try {
    const [banks] = await pool.query(`
      SELECT 
        b.bank_id, 
        b.bank_name, 
        b.store_id,
        s.store_name,
        b.created_at 
      FROM banks b
      LEFT JOIN stores s ON b.store_id = s.store_id
      ORDER BY s.store_name, b.bank_name
    `);
    res.status(200).json({ banks });
  } catch (error) {
    console.error("Error fetching banks:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data bank/pembayaran.",
      error: error.message,
    });
  }
};

const getBanksByStoreId = async (req, res) => {
  const { store_id } = req.params;

  try {
    const [banks] = await pool.query(
      `
      SELECT 
        b.bank_id, 
        b.bank_name, 
        b.store_id,
        s.store_name,
        b.created_at 
      FROM banks b
      LEFT JOIN stores s ON b.store_id = s.store_id
      WHERE b.store_id = ?
      ORDER BY b.bank_name
    `,
      [store_id]
    );

    if (banks.length === 0) {
      return res.status(200).json({ banks: [] });
    }

    res.status(200).json({ banks });
  } catch (error) {
    console.error("Error fetching banks by store ID:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data bank/pembayaran untuk toko.",
      error: error.message,
    });
  }
};

const getBankById = async (req, res) => {
  const { id } = req.params;

  try {
    const [banks] = await pool.query(
      `
      SELECT 
        b.bank_id, 
        b.bank_name, 
        b.store_id,
        s.store_name,
        b.created_at 
      FROM banks b
      LEFT JOIN stores s ON b.store_id = s.store_id
      WHERE b.bank_id = ?
    `,
      [id]
    );

    if (banks.length === 0) {
      return res
        .status(404)
        .json({ message: "Bank/Pembayaran tidak ditemukan." });
    }

    res.status(200).json(banks[0]);
  } catch (error) {
    console.error("Error fetching bank by ID:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data bank/pembayaran.",
      error: error.message,
    });
  }
};

const updateBank = async (req, res) => {
  const { id } = req.params;
  const { bank_name } = req.body;

  if (!bank_name) {
    return res
      .status(400)
      .json({ message: "Nama bank/pembayaran harus diisi." });
  }

  try {
    const [existingBank] = await pool.query(
      "SELECT bank_id, store_id FROM banks WHERE bank_id = ?",
      [id]
    );
    if (existingBank.length === 0) {
      return res
        .status(404)
        .json({ message: "Bank/Pembayaran tidak ditemukan." });
    }

    await pool.query("UPDATE banks SET bank_name = ? WHERE bank_id = ?", [
      bank_name,
      id,
    ]);

    res.status(200).json({ message: "Bank/Pembayaran berhasil diperbarui." });
  } catch (error) {
    console.error("Error updating bank:", error);
    res.status(500).json({
      message: "Gagal memperbarui bank/pembayaran.",
      error: error.message,
    });
  }
};

const deleteBank = async (req, res) => {
  const { id } = req.params;

  try {
    const [usedInReports] = await pool.query(
      "SELECT report_balance_id FROM report_balances WHERE bank_id = ? LIMIT 1",
      [id]
    );

    if (usedInReports.length > 0) {
      return res.status(400).json({
        message:
          "Bank/Pembayaran tidak dapat dihapus karena sedang digunakan dalam laporan.",
      });
    }

    const [result] = await pool.query("DELETE FROM banks WHERE bank_id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Bank/Pembayaran tidak ditemukan." });
    }

    res.status(200).json({ message: "Bank/Pembayaran berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting bank:", error);
    res.status(500).json({
      message: "Gagal menghapus bank/pembayaran.",
      error: error.message,
    });
  }
};

module.exports = {
  createBank,
  getAllBanks,
  getBanksByStoreId,
  getBankById,
  updateBank,
  deleteBank,
};
