// src/routes/bankRoutes.js
const express = require("express");
const {
  createBank,
  getAllBanks,
  getBankById,
  getBanksByStoreId, // <--- Tambahkan ini
  updateBank,
  deleteBank,
} = require("../controllers/bankController");
const { verifyToken, authorizeRole } = require("../middleware/auth");
const router = express.Router();

// Membuat bank (hanya admin/karyawan)
router.post("/", verifyToken, authorizeRole(["admin", "karyawan"]), createBank);

// Mendapatkan semua bank (admin dan karyawan)
router.get("/", verifyToken, authorizeRole(["admin", "karyawan"]), getAllBanks);

// Mendapatkan bank berdasarkan Store ID (admin dan karyawan) <--- Rute baru
router.get(
  "/store/:store_id", // <--- Tambahkan rute ini
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getBanksByStoreId // <--- Panggil controller ini
);

// Mendapatkan bank berdasarkan ID (admin dan karyawan)
router.get(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getBankById
);

// Memperbarui bank berdasarkan ID (admin dan karyawan)
router.put(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  updateBank
);

// Menghapus bank berdasarkan ID (admin dan karyawan)
router.delete(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  deleteBank
);

module.exports = router;
