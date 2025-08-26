const express = require("express");
const cors = require("cors");
const { testConnection } = require("./config/db");
require("dotenv").config();

const userRoutes = require("./routes/userRoutes");
const storeRoutes = require("./routes/storeRoutes");
const bankRoutes = require("./routes/bankRoutes");
const reportRoutes = require("./routes/reportRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware untuk parsing body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Konfigurasi CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Untuk request tanpa origin (misalnya Postman, curl) → diizinkan
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Cache-Control",
    "Pragma",
  ],
  credentials: true,
};

// Gunakan CORS di seluruh route
app.use(cors(corsOptions));

// Tangani preflight request (OPTIONS)
app.options("*", cors(corsOptions));

// Tes koneksi DB
testConnection();

// Routes
app.use("/api/users", userRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/reports", reportRoutes);

app.get("/", (req, res) => {
  res.send("Welcome to the SKEMA API!");
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(500)
    .json({ message: "Terjadi kesalahan pada server.", error: err.message });
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = app;
