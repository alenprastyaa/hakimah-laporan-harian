// src/routes/userRoutes.js
const express = require("express");
const {
  registerUser,
  loginUser,
  getAllUsers,
  getUserById,
  updateUser, // Import the new update function
  deleteUser, // Import the new delete function
} = require("../controllers/userController");
const { verifyToken, authorizeRole } = require("../middleware/auth");
const router = express.Router();

// Public routes (do not require authentication)
router.post("/register", registerUser);
router.post("/login", loginUser);

// Protected routes (require authentication and authorization)
// Only admin can view the list of all users
router.get("/", verifyToken, authorizeRole(["admin"]), getAllUsers);
router.get("/:id", verifyToken, authorizeRole(["admin"]), getUserById);

// Route for updating users
// Only admin can update any user
router.put("/:id", verifyToken, authorizeRole(["admin"]), updateUser);

// Route for deleting users
// Only admin can delete users
router.delete("/:id", verifyToken, authorizeRole(["admin"]), deleteUser);

module.exports = router;
