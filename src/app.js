// src/app.js
const express = require("express");
const cors = require("cors");
const { testConnection } = require("./config/db");
require("dotenv").config();

const { format, subDays, startOfMonth, endOfMonth } = require("date-fns");

// Impor rute
const userRoutes = require("./routes/userRoutes");
const storeRoutes = require("./routes/storeRoutes");
const bankRoutes = require("./routes/bankRoutes");
const reportRoutes = require("./routes/reportRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // Body parser untuk JSON
app.use(express.urlencoded({ extended: true })); // Body parser untuk URL-encoded

// Konfigurasi CORS yang lebih komprehensif
const corsOptions = {
  origin: function (origin, callback) {
    // Izinkan request tanpa origin (mobile apps, postman, dll)
    if (!origin) return callback(null, true);

    // Daftar domain yang diizinkan
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173", // Vite default port
      "http://localhost:8080", // Vue CLI default port
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:8080",
      // Tambahkan domain produksi Anda di sini
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Untuk development, izinkan semua
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
  credentials: true, // Jika Anda menggunakan cookies/auth
  optionsSuccessStatus: 200, // Untuk legacy browser support
  preflightContinue: false,
};

app.use(cors(corsOptions));

// Tambahkan middleware khusus untuk menangani preflight requests
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS,PATCH"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  next();
});

// Uji koneksi database saat aplikasi dimulai
testConnection();

// Definisikan rute API
app.use("/api/users", userRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/reports", reportRoutes);

// Rute dasar
app.get("/", (req, res) => {
  res.send("Welcome to the SKEMA API!");
});

// Penanganan error global (opsional, untuk error yang tidak tertangani)
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
