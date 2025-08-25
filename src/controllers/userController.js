// src/controllers/userController.js
const { pool } = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require('uuid');
require("dotenv").config();

const isValidRole = (role) => ["admin", "karyawan"].includes(role);

const registerUser = async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res
      .status(400)
      .json({ message: "Username, password, dan role harus diisi." });
  }
  if (!isValidRole(role)) {
    return res.status(400).json({
      message: 'Role tidak valid. Pilih antara "admin" atau "karyawan".',
    });
  }

  try {
    const [existingUser] = await pool.query(
      "SELECT user_id FROM users WHERE username = ?",
      [username]
    );
    if (existingUser.length > 0) {
      return res.status(409).json({ message: "Username sudah digunakan." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user_id = uuidv4();
    await pool.query(
      "INSERT INTO users (user_id, username, password, role) VALUES (?, ?, ?, ?)",
      [user_id, username, hashedPassword, role]
    );
    res.status(201).json({
      message: "Pengguna berhasil dibuat.",
      user_id,
      username,
      role,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res
      .status(500)
      .json({ message: "Gagal membuat pengguna.", error: error.message });
  }
};
const loginUser = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username dan password harus diisi." });
  }
  try {
    const [users] = await pool.query(
      "SELECT user_id, username, password, role FROM users WHERE username = ?",
      [username]
    );
    if (users.length === 0) {
      return res.status(401).json({ message: "Username atau password salah." });
    }
    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Username atau password salah." });
    }
    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(200).json({
      message: "Login berhasil.",
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(500).json({ message: "Gagal login.", error: error.message });
  }
};
const getAllUsers = async (req, res) => {
  try {
    const [users] = await pool.query(
      "SELECT user_id, username, role, created_at FROM users"
    );
    res.status(200).json({ users });
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data pengguna.",
      error: error.message,
    });
  }
};
const getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [users] = await pool.query(
      "SELECT user_id, username, role, created_at FROM users WHERE user_id = ?",
      [id]
    );
    if (users.length === 0) {
      return res.status(404).json({ message: "Pengguna tidak ditemukan." });
    }
    res.status(200).json(users[0]);
  } catch (error) {
    console.error("Error fetching user by ID:", error);
    res.status(500).json({
      message: "Gagal mendapatkan data pengguna.",
      error: error.message,
    });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, password, role } = req.body;

  if (!username && !password && !role) {
    return res.status(400).json({
      message:
        "Setidaknya satu field (username, password, atau role) harus diisi untuk update.",
    });
  }

  if (role && !isValidRole(role)) {
    return res.status(400).json({
      message: 'Role tidak valid. Pilih antara "admin" atau "karyawan".',
    });
  }

  try {
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updateFields = [];
    const updateValues = [];

    if (username) {
      const [existingUser] = await pool.query(
        "SELECT user_id FROM users WHERE username = ? AND user_id != ?",
        [username, id]
      );
      if (existingUser.length > 0) {
        return res
          .status(409)
          .json({ message: "Username sudah digunakan oleh pengguna lain." });
      }
      updateFields.push("username = ?");
      updateValues.push(username);
    }
    if (hashedPassword) {
      updateFields.push("password = ?");
      updateValues.push(hashedPassword);
    }
    if (role) {
      updateFields.push("role = ?");
      updateValues.push(role);
    }
    if (updateFields.length === 0) {
      return res
        .status(200)
        .json({ message: "Tidak ada field yang perlu diupdate." });
    }

    const query = `UPDATE users SET ${updateFields.join(
      ", "
    )} WHERE user_id = ?`;
    updateValues.push(id);

    const [result] = await pool.query(query, updateValues);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message:
          "Pengguna tidak ditemukan atau tidak ada perubahan yang dilakukan.",
      });
    }
    const [updatedUser] = await pool.query(
      "SELECT user_id, username, role, created_at FROM users WHERE user_id = ?",
      [id]
    );

    res.status(200).json({
      message: "Pengguna berhasil diperbarui.",
      user: updatedUser[0],
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res
      .status(500)
      .json({ message: "Gagal memperbarui pengguna.", error: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query("DELETE FROM users WHERE user_id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Pengguna tidak ditemukan." });
    }

    res.status(200).json({ message: "Pengguna berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting user:", error);
    res
      .status(500)
      .json({ message: "Gagal menghapus pengguna.", error: error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
};
