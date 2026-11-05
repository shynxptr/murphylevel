// Pure JavaScript JSON database (no native dependencies needed)
// API compatible dengan quick.db untuk fungsi yang dipakai di bot ini

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', '..', 'database.json');
const TMP_FILE = `${DB_FILE}.tmp`;
let data = {};
let isDirty = false;
let isSaving = false;
let saveQueued = false;

// Load database dari file
function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw.trim()) {
        data = JSON.parse(raw);
      }
    } else if (fs.existsSync(TMP_FILE)) {
      // Fallback recovery jika proses sebelumnya mati saat atomic rename
      const raw = fs.readFileSync(TMP_FILE, 'utf8');
      if (raw.trim()) {
        data = JSON.parse(raw);
        fs.copyFileSync(TMP_FILE, DB_FILE);
      }
    }
  } catch (err) {
    console.error('Error loading database, starting fresh:', err.message);
    data = {};
  }
}

async function flushAsync() {
  if (isSaving) {
    saveQueued = true;
    return;
  }
  if (!isDirty) return;

  isSaving = true;
  isDirty = false;

  try {
    const serialized = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(TMP_FILE, serialized, 'utf8');
    try {
      await fs.promises.rename(TMP_FILE, DB_FILE);
    } catch {
      // Fallback untuk Windows jika rename gagal karena file lock sementara
      await fs.promises.writeFile(DB_FILE, serialized, 'utf8');
      await fs.promises.unlink(TMP_FILE).catch(() => {});
    }
  } catch (err) {
    console.error('Error saving database:', err.message);
    isDirty = true;
  } finally {
    isSaving = false;
    if (saveQueued) {
      saveQueued = false;
      flushAsync();
    }
  }
}

// Save database ke file (debounced & async atomic write agar tidak mem-block main thread)
let saveTimeout = null;
function save() {
  isDirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    flushAsync();
  }, 500);
}

// Save sync (untuk critical operations / saat proses exit)
function saveSync() {
  if (!isDirty) return;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  try {
    const serialized = JSON.stringify(data, null, 2);
    fs.writeFileSync(TMP_FILE, serialized, 'utf8');
    try {
      fs.renameSync(TMP_FILE, DB_FILE);
    } catch {
      fs.writeFileSync(DB_FILE, serialized, 'utf8');
      try { fs.unlinkSync(TMP_FILE); } catch {}
    }
    isDirty = false;
  } catch (err) {
    console.error('Error saving database:', err.message);
  }
}

// Load saat startup
load();

// Save on exit
process.on('exit', () => saveSync());
process.on('SIGINT', () => { saveSync(); process.exit(); });
process.on('SIGTERM', () => { saveSync(); process.exit(); });

/**
 * Get value by key
 */
function get(key) {
  return data[key] !== undefined ? data[key] : null;
}

/**
 * Set value by key
 */
function set(key, value) {
  if (data[key] === value) return value;
  data[key] = value;
  save();
  return value;
}

/**
 * Add amount to a numeric value
 */
function add(key, amount) {
  const current = get(key) || 0;
  const newVal = current + amount;
  data[key] = newVal;
  save();
  return newVal;
}

/**
 * Delete a key
 */
function _delete(key) {
  if (data[key] === undefined) return;
  delete data[key];
  save();
}

/**
 * Get all entries as array of { ID, data }
 */
function all() {
  const result = [];
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      result.push({ ID: key, data: data[key] });
    }
  }
  return result;
}

/**
 * Iterate over entries matching a prefix without allocating full array
 */
function forEachPrefix(prefix, callback) {
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key) && key.startsWith(prefix)) {
      callback(key, data[key]);
    }
  }
}

module.exports = {
  get,
  set,
  add,
  delete: _delete,
  all,
  forEachPrefix,
  save,
  saveSync,
  load,
};
