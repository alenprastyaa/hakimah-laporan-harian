const { createWorker } = require("tesseract.js");

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL?.replace(/\/+$/, "");
const OCR_SERVICE_TIMEOUT_MS = Number(process.env.OCR_SERVICE_TIMEOUT_MS || 60000);

const normalizeText = (text = "") =>
  String(text)
    .replace(/\r/g, "\n")
    .replace(/[|]/g, "I")
    .replace(/[ \t]+/g, " ")
    .trim();

const getLines = (text) =>
  normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const findValueAfterLabel = (lines, labels) => {
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`(?:${labelPattern})\\s*[:\\-]?\\s*(.+)`, "i");

  for (const line of lines) {
    const match = line.match(regex);
    if (match?.[1]) return match[1].trim();
  }

  return null;
};

const cleanupValue = (value) => {
  const cleaned = String(value || "")
    .replace(/[~_—]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:.-]+|[\s:.-]+$/g, "")
    .trim();

  return cleaned || null;
};

const cleanupName = (value) => {
  const cleaned = cleanupValue(value)
    ?.replace(/(?:\s+[A-Z0-9]){1,3}$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
};

const normalizeNikCandidate = (value) => {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[ILOQS]/g, (char) => {
      const map = {
        I: "1",
        L: "1",
        O: "0",
        Q: "0",
        S: "5",
      };
      return map[char] || char;
    })
    .replace(/\D/g, "");

  return normalized.length >= 16 ? normalized.slice(0, 16) : null;
};

const parseNik = (text) => {
  const compactText = normalizeText(text).replace(/\s+/g, " ");
  const nikMatch = compactText.match(/(?:NIK|N1K)\D{0,12}([0-9ILOQS\s]{16,28})/i);
  const nikFromLabel = normalizeNikCandidate(nikMatch?.[1]);
  if (nikFromLabel) return nikFromLabel;

  const fallbackMatch = compactText.match(/[0-9ILOQS]{16,22}/i);
  return normalizeNikCandidate(fallbackMatch?.[0]);
};

const parseBirthData = (value) => {
  if (!value) return { birthPlace: null, birthDate: null };

  const cleaned = cleanupValue(value);
  const dateMatch = cleaned.match(/(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{2,4})/);
  if (!dateMatch) {
    return { birthPlace: cleaned || null, birthDate: null };
  }

  const day = dateMatch[1].padStart(2, "0");
  const month = dateMatch[2].padStart(2, "0");
  const year =
    dateMatch[3].length === 2 ? `19${dateMatch[3]}` : dateMatch[3];
  const birthPlace = cleaned.slice(0, dateMatch.index).replace(/[,.\- ]+$/g, "").trim();

  return {
    birthPlace: birthPlace || null,
    birthDate: `${year}-${month}-${day}`,
  };
};

const parseKtpText = (text) => {
  const lines = getLines(text);
  const birthValue = findValueAfterLabel(lines, [
    "Tempat/Tgl Lahir",
    "Tempat Tgl Lahir",
    "Tempat/Tgl. Lahir",
    "Tempat Lahir",
    "Tempal/Tgl Lahir",
    "Tempal Tgl Lahir",
    "Tempai/Tgl Lahir",
    "Tempai Tgl Lahir",
  ]);
  const { birthPlace, birthDate } = parseBirthData(birthValue);
  const genderRaw = findValueAfterLabel(lines, ["Jenis Kelamin", "Jenis Keiamin", "denis Kelamin", "Kelamin"]);
  const genderMatch =
    genderRaw?.match(/LAKI[\s-]*LAKI|PEREMPUAN/i) ||
    normalizeText(text).match(/LAKI[\s-]*LAKI|PEREMPUAN/i);

  return {
    nik: parseNik(text),
    name: cleanupName(findValueAfterLabel(lines, ["Nama"])),
    birth_place: birthPlace,
    birth_date: birthDate,
    gender: genderMatch ? genderMatch[0].toUpperCase().replace(/\s+/g, " ") : null,
    address: cleanupValue(findValueAfterLabel(lines, ["Alamat"])),
  };
};

const recognizeWithFlaskService = async (buffer) => {
  if (!OCR_SERVICE_URL) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_SERVICE_TIMEOUT_MS);

  try {
    const response = await fetch(`${OCR_SERVICE_URL}/ocr/ktp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_base64: buffer.toString("base64"),
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === "failed") {
      throw new Error(data.error || data.message || "OCR service gagal memproses KTP.");
    }

    return {
      rawText: normalizeText(data.raw_text || ""),
      parsed: {
        nik: data.parsed?.nik || null,
        name: data.parsed?.name || null,
        birth_place: data.parsed?.birth_place || null,
        birth_date: data.parsed?.birth_date || null,
        gender: data.parsed?.gender || null,
        address: data.parsed?.address || null,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

const recognizeWithTesseract = async (buffer) => {
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    const result = await worker.recognize(buffer);
    const text = normalizeText(result.data?.text || "");
    return {
      rawText: text,
      parsed: parseKtpText(text),
    };
  } finally {
    await worker.terminate();
  }
};

const recognizeKtp = async (buffer) => {
  if (OCR_SERVICE_URL) {
    return recognizeWithFlaskService(buffer);
  }

  try {
    return await recognizeWithTesseract(buffer);
  } catch (error) {
    console.error("Tesseract OCR failed:", error.message);
    throw error;
  }
};

module.exports = {
  recognizeKtp,
  parseKtpText,
};
