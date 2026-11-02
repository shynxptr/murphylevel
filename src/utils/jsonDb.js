// Pure JavaScript JSON database (no native dependencies needed)
// API compatible dengan quick.db untuk fungsi yang dipakai di bot ini

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', '..', 'database.json');
let data = {};

// Load database dari file
function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      data = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading database, starting fresh:', err.message);
    data = {};
  }
}

// Save database ke file (debounced untuk efisiensi)
let saveTimeout = null;
function save() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error saving database:', err.message);
    }
  }, 500);
}

// Save sync (untuk critical operations)
function saveSync() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
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
  delete data[key];
  save();
}

/**
 * Get all entries as array of { ID, data }
 */
function all() {
  const result = [];
  for (const key in data) {
    result.push({ ID: key, data: data[key] });
  }
  return result;
}

module.exports = {
  get,
  set,
  add,
  delete: _delete,
  all,
  save,
  saveSync,
  load,
};
