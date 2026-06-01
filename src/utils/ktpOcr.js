const { createWorker } = require("tesseract.js");

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

const parseBirthData = (value) => {
  if (!value) return { birthPlace: null, birthDate: null };

  const cleaned = value.replace(/\s+/g, " ").trim();
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
  const compactText = normalizeText(text).replace(/\s+/g, " ");
  const nikMatch = compactText.match(/(?:NIK|N1K|NIK\s*)\D{0,8}(\d[\d\s]{14,20}\d)/i);
  const fallbackNikMatch = compactText.match(/\b\d{16}\b/);
  const birthValue = findValueAfterLabel(lines, [
    "Tempat/Tgl Lahir",
    "Tempat Tgl Lahir",
    "Tempat/Tgl. Lahir",
    "Tempat Lahir",
  ]);
  const { birthPlace, birthDate } = parseBirthData(birthValue);
  const genderRaw = findValueAfterLabel(lines, ["Jenis Kelamin", "Kelamin"]);
  const genderMatch = genderRaw?.match(/LAKI[\s-]*LAKI|PEREMPUAN/i);

  return {
    nik: (nikMatch?.[1] || fallbackNikMatch?.[0] || null)?.replace(/\D/g, "") || null,
    name: findValueAfterLabel(lines, ["Nama"]),
    birth_place: birthPlace,
    birth_date: birthDate,
    gender: genderMatch ? genderMatch[0].toUpperCase().replace(/\s+/g, " ") : null,
    address: findValueAfterLabel(lines, ["Alamat"]),
  };
};

const recognizeKtp = async (buffer) => {
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

module.exports = {
  recognizeKtp,
  parseKtpText,
};
