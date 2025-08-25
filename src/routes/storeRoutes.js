// src/routes/storeRoutes.js
const express = require("express");
const {
  createStore,
  getAllStores,
  getStoreById,
  updateStore,
  deleteStore,
} = require("../controllers/storeController");
const {
  verifyToken,
  authorizeRole,
  authorizeStoreAccess,
} = require("../middleware/auth");
const router = express.Router();

// Membuat toko (hanya admin)
router.post("/", verifyToken, authorizeRole(["admin"]), createStore);

// Mendapatkan semua toko (admin dapat melihat semua, karyawan hanya yang terkait)
router.get(
  "/",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getAllStores
);

// Mendapatkan toko berdasarkan ID (admin dapat melihat semua, karyawan hanya yang terkait)
router.get(
  "/:id",
  verifyToken,
  authorizeRole(["admin", "karyawan"]),
  getStoreById
);

// Update toko (hanya admin)
router.put("/:id", verifyToken, authorizeRole(["admin"]), updateStore);

// Delete toko (hanya admin)
router.delete("/:id", verifyToken, authorizeRole(["admin"]), deleteStore);

module.exports = router;
