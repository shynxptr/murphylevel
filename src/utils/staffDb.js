// Staff Directory Database — disimpan di database.json (bareng leveling)
// Struktur key:
//   staff_divisions_{guildId}              → array nama divisi (urutan)
//   staff_{guildId}_{userId}_division      → nama divisi staff
//   staff_{guildId}_{userId}_title         → title/custom label (optional)
//   staff_directory_msg_{guildId}          → ID pesan embed directory (untuk auto-update)

const db = require('./jsonDb');

// ============= DIVISIONS =============

/**
 * Ambil semua divisi di guild tertentu.
 * Return array of { name, order }
 */
function getDivisions(guildId) {
  const divisions = db.get(`staff_divisions_${guildId}`);
  if (!divisions || !Array.isArray(divisions)) return [];
  return divisions;
}

/**
 * Ambil daftar nama divisi saja (urut).
 */
function getDivisionNames(guildId) {
  return getDivisions(guildId).map((d) => (typeof d === 'string' ? d : d.name));
}

/**
 * Buat divisi baru. Return { success, error? }
 */
function createDivision(guildId, name) {
  const divisions = getDivisions(guildId);
  const names = divisions.map((d) => (typeof d === 'string' ? d : d.name).toLowerCase());
  if (names.includes(name.toLowerCase())) {
    return { success: false, error: 'Divisi sudah ada' };
  }
  divisions.push({ name, order: divisions.length });
  db.set(`staff_divisions_${guildId}`, divisions);
  return { success: true };
}

/**
 * Hapus divisi. Staff di divisi ini juga dihapus.
 * Return { success, error?, removedStaff: number }
 */
function deleteDivision(guildId, name) {
  const divisions = getDivisions(guildId);
  const idx = divisions.findIndex((d) => (typeof d === 'string' ? d : d.name).toLowerCase() === name.toLowerCase());
  if (idx === -1) {
    return { success: false, error: 'Divisi tidak ditemukan' };
  }
  divisions.splice(idx, 1);
  db.set(`staff_divisions_${guildId}`, divisions);

  // Hapus semua staff di divisi ini
  const allData = db.all();
  const prefix = `staff_${guildId}_`;
  let removedStaff = 0;
  for (const entry of allData) {
    if (!entry.ID.startsWith(prefix)) continue;
    if (!entry.ID.endsWith('_division')) continue;
    if (typeof entry.data === 'string' && entry.data.toLowerCase() === name.toLowerCase()) {
      const userId = entry.ID.replace(prefix, '').replace('_division', '');
      removeStaff(guildId, userId);
      removedStaff++;
    }
  }

  return { success: true, removedStaff };
}

/**
 * Reorder divisi (untuk urutan tampilan).
 * divisions = array of nama divisi urut baru.
 */
function reorderDivisions(guildId, divisionNames) {
  const divisions = divisionNames.map((name, i) => ({ name, order: i }));
  db.set(`staff_divisions_${guildId}`, divisions);
  return { success: true };
}

// ============= STAFF =============

/**
 * Tambah / update staff. Set divisi & optional title.
 * Return { success, error? }
 */
function addStaff(guildId, userId, division, title = null) {
  const divNames = getDivisionNames(guildId);
  if (!divNames.some((d) => d.toLowerCase() === division.toLowerCase())) {
    return { success: false, error: 'Divisi tidak ditemukan. Buat dulu dengan /staff division create' };
  }

  // Cari nama divisi yang exact (case-insensitive match tapi simpan original)
  const exactName = divNames.find((d) => d.toLowerCase() === division.toLowerCase());

  db.set(`staff_${guildId}_${userId}_division`, exactName);
  if (title) {
    db.set(`staff_${guildId}_${userId}_title`, title);
  } else {
    db.delete(`staff_${guildId}_${userId}_title`);
  }
  return { success: true };
}

/**
 * Hapus staff.
 * Return { success, wasStaff: boolean }
 */
function removeStaff(guildId, userId) {
  const division = db.get(`staff_${guildId}_${userId}_division`);
  if (!division) {
    return { success: false, wasStaff: false };
  }
  db.delete(`staff_${guildId}_${userId}_division`);
  db.delete(`staff_${guildId}_${userId}_title`);
  return { success: true, wasStaff: true };
}

/**
 * Ambil info staff.
 * Return { division, title } atau null kalau bukan staff.
 */
function getStaff(guildId, userId) {
  const division = db.get(`staff_${guildId}_${userId}_division`);
  if (!division) return null;
  const title = db.get(`staff_${guildId}_${userId}_title`) || null;
  return { division, title };
}

/**
 * Ambil semua staff di guild, dikelompokkan per divisi.
 * Return array of { division, members: [{ userId, title }] }
 */
function getAllStaff(guildId) {
  const allData = db.all();
  const prefix = `staff_${guildId}_`;
  const divNames = getDivisionNames(guildId);

  // Init struktur per divisi (urut sesuai divisi)
  const result = divNames.map((name) => ({ division: name, members: [] }));

  for (const entry of allData) {
    if (!entry.ID.startsWith(prefix)) continue;
    if (!entry.ID.endsWith('_division')) continue;

    const userId = entry.ID.replace(prefix, '').replace('_division', '');
    const division = entry.data;
    const title = db.get(`staff_${guildId}_${userId}_title`) || null;

    // Cari divisi di result
    const divIdx = result.findIndex((d) => d.division === division);
    if (divIdx !== -1) {
      result[divIdx].members.push({ userId, title });
    } else {
      // Divisi tidak terdaftar (mungkin sudah dihapus tapi staff belum dibersihkan)
      result.push({ division, members: [{ userId, title }] });
    }
  }

  return result;
}

/**
 * Ambil semua staff dalam satu divisi.
 */
function getStaffByDivision(guildId, divisionName) {
  const all = getAllStaff(guildId);
  const found = all.find((d) => d.division.toLowerCase() === divisionName.toLowerCase());
  return found ? found.members : [];
}

/**
 * Hitung total staff di guild.
 */
function getStaffCount(guildId) {
  const allData = db.all();
  const prefix = `staff_${guildId}_`;
  let count = 0;
  for (const entry of allData) {
    if (!entry.ID.startsWith(prefix)) continue;
    if (!entry.ID.endsWith('_division')) continue;
    count++;
  }
  return count;
}

// ============= DIRECTORY MESSAGE =============

/**
 * Simpan ID pesan embed directory (untuk auto-update).
 */
function setDirectoryMessage(guildId, messageId, channelId) {
  db.set(`staff_directory_msg_${guildId}`, messageId);
  db.set(`staff_directory_channel_${guildId}`, channelId);
}

/**
 * Ambil ID pesan embed directory.
 * Return { messageId, channelId } atau null.
 */
function getDirectoryMessage(guildId) {
  const messageId = db.get(`staff_directory_msg_${guildId}`);
  const channelId = db.get(`staff_directory_channel_${guildId}`);
  if (!messageId || !channelId) return null;
  return { messageId, channelId };
}

/**
 * Hapus tracking pesan directory.
 */
function clearDirectoryMessage(guildId) {
  db.delete(`staff_directory_msg_${guildId}`);
  db.delete(`staff_directory_channel_${guildId}`);
}

module.exports = {
  getDivisions,
  getDivisionNames,
  createDivision,
  deleteDivision,
  reorderDivisions,
  addStaff,
  removeStaff,
  getStaff,
  getAllStaff,
  getStaffByDivision,
  getStaffCount,
  setDirectoryMessage,
  getDirectoryMessage,
  clearDirectoryMessage,
};
