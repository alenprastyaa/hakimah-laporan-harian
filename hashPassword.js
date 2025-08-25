// hashPassword.js
const bcrypt = require("bcryptjs");

async function hash(password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  console.log(hashedPassword);
}

hash("adminpassword123"); // Ganti dengan password yang Anda inginkan
// Contoh output: $2a$10$abcdefghijklmnopqrstuvwxyz... (string panjang)
