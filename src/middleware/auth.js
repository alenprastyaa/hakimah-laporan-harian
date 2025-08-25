// src/middleware/auth.js
const jwt = require("jsonwebtoken");
require("dotenv").config();

const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ message: "Akses ditolak. Token tidak disediakan." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res
      .status(403)
      .json({ message: "Token tidak valid atau kedaluwarsa." });
  }
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Akses ditolak. Peran tidak diizinkan." });
    }
    next();
  };
};

const authorizeStoreAccess = async (req, res, next) => {
  const { user_id, role } = req.user;
  const storeId =
    req.params.store_id || req.body.store_id || req.query.store_id;

  if (role === "admin") {
    next();
  } else if (role === "karyawan") {
    if (!storeId) {
      return res
        .status(400)
        .json({ message: "ID Toko diperlukan untuk karyawan." });
    }
    try {
      const { pool } = require("../config/db");
      const [rows] = await pool.query(
        "SELECT * FROM store_employees WHERE store_id = ? AND user_id = ?",
        [storeId, user_id]
      );
      if (rows.length === 0) {
        return res.status(403).json({
          message: "Akses ditolak. Karyawan tidak terhubung dengan toko ini.",
        });
      }
      next();
    } catch (error) {
      console.error("Error checking store access:", error);
      res.status(500).json({ message: "Gagal memverifikasi akses toko." });
    }
  } else {
    return res
      .status(403)
      .json({ message: "Akses ditolak. Peran tidak dikenali." });
  }
};

module.exports = { verifyToken, authorizeRole, authorizeStoreAccess };
