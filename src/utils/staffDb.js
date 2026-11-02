// Staff Directory Database — disimpan di database.json (bareng leveling)
// Struktur key:
//   staff_divisions_{guildId}                       → array nama divisi (urutan)
//   staff_{guildId}_{userId}_divisions              → array nama divisi yang dipegang staff (merangkap)
//   staff_{guildId}_{userId}_{division}_title       → title/custom label per divisi (optional)
//   staff_directory_msg_{guildId}                   → ID pesan embed directory (untuk auto-update)
//   staff_directory_channel_{guildId}               → ID channel directory

const db = require('./jsonDb');

// ============= MIGRATION (old format → new format) =============

/**
 * Migrate data lama (format _division single string) ke format baru (_divisions array).
 * Dipanggil sekali saat module load. Aman kalau data sudah format baru (no-op).
 */
function migrateOldFormat() {
  const allData = db.all();
  const migrated = [];

  for (const entry of allData) {
    // Cari key dengan suffix _division (bukan _divisions, bukan _divisions_xxx_title)
    if (!entry.ID.endsWith('_division')) continue;
    if (entry.ID.endsWith('_divisions')) continue;

    // Extract: staff_{guildId}_{userId}_division
    const match = entry.ID.match(/^staff_(\d+)_(\d+)_division$/);
    if (!match) continue;

    const [, guildId, userId] = match;
    const division = entry.data;
    if (typeof division !== 'string') continue;

    // Cek apakah user sudah punya key _divisions (format baru)
    const existingDivs = db.get(`staff_${guildId}_${userId}_divisions`);
    if (existingDivs && Array.isArray(existingDivs)) {
      // Sudah format baru, tapi cek apakah divisi lama belum ada di array
      if (!existingDivs.some((d) => d.toLowerCase() === division.toLowerCase())) {
        existingDivs.push(division);
        db.set(`staff_${guildId}_${userId}_divisions`, existingDivs);
      }
    } else {
      // Belum ada format baru → buat array baru
      db.set(`staff_${guildId}_${userId}_divisions`, [division]);
    }

    // Migrate title lama (staff_{guildId}_{userId}_title) ke format per-divisi
    const oldTitle = db.get(`staff_${guildId}_${userId}_title`);
    if (oldTitle) {
      db.set(`staff_${guildId}_${userId}_${division}_title`, oldTitle);
      db.delete(`staff_${guildId}_${userId}_title`);
    }

    // Hapus key lama
    db.delete(entry.ID);
    migrated.push(entry.ID);
  }

  if (migrated.length > 0) {
    console.log(`📦 Staff directory: migrated ${migrated.length} old format entries to new format.`);
  }
}

// Run migration on load
migrateOldFormat();

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
 * Hapus divisi. Staff di divisi ini juga dihapus dari divisi tersebut.
 * Return { success, error?, removedStaff: number }
 */
function deleteDivision(guildId, name) {
  const divisions = getDivisions(guildId);
  const idx = divisions.findIndex((d) => (typeof d === 'string' ? d : d.name).toLowerCase() === name.toLowerCase());
  if (idx === -1) {
    return { success: false, error: 'Divisi tidak ditemukan' };
  }
  const exactName = typeof divisions[idx] === 'string' ? divisions[idx] : divisions[idx].name;
  divisions.splice(idx, 1);
  db.set(`staff_divisions_${guildId}`, divisions);

  // Hapus divisi ini dari semua staff yang merangkap
  const allData = db.all();
  const prefix = `staff_${guildId}_`;
  let removedStaff = 0;
  for (const entry of allData) {
    if (!entry.ID.startsWith(prefix)) continue;
    if (!entry.ID.endsWith('_divisions')) continue;
    if (!Array.isArray(entry.data)) continue;

    const userId = entry.ID.replace(prefix, '').replace('_divisions', '');
    const divs = entry.data;
    if (divs.some((d) => d.toLowerCase() === exactName.toLowerCase())) {
      const newDivs = divs.filter((d) => d.toLowerCase() !== exactName.toLowerCase());
      if (newDivs.length === 0) {
        // Staff tidak punya divisi lagi → hapus semua data staff
        removeStaff(guildId, userId);
      } else {
        db.set(`staff_${guildId}_${userId}_divisions`, newDivs);
      }
      // Hapus title untuk divisi ini
      db.delete(`staff_${guildId}_${userId}_${exactName}_title`);
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
 * Tambah staff ke divisi (merangkap — bisa punya multiple divisi).
 * Return { success, error?, alreadyInDivision? }
 */
function addStaff(guildId, userId, division, title = null) {
  const divNames = getDivisionNames(guildId);
  if (!divNames.some((d) => d.toLowerCase() === division.toLowerCase())) {
    return { success: false, error: 'Divisi tidak ditemukan. Buat dulu dengan /staff-division create' };
  }

  // Cari nama divisi yang exact (case-insensitive match tapi simpan original)
  const exactName = divNames.find((d) => d.toLowerCase() === division.toLowerCase());

  // Ambil divisi yang sudah dipegang user
  const currentDivs = db.get(`staff_${guildId}_${userId}_divisions`) || [];

  // Cek apakah sudah ada di divisi ini
  if (currentDivs.some((d) => d.toLowerCase() === exactName.toLowerCase())) {
    return { success: true, alreadyInDivision: true };
  }

  // Tambahkan divisi baru ke array
  currentDivs.push(exactName);
  db.set(`staff_${guildId}_${userId}_divisions`, currentDivs);

  // Set title per divisi (optional)
  if (title) {
    db.set(`staff_${guildId}_${userId}_${exactName}_title`, title);
  } else {
    db.delete(`staff_${guildId}_${userId}_${exactName}_title`);
  }
  return { success: true, alreadyInDivision: false };
}

/**
 * Hapus staff dari satu divisi tertentu (bukan hapus total).
 * Return { success, wasStaff, removedFromDivision, remainingDivisions }
 */
function removeStaffFromDivision(guildId, userId, divisionName) {
  const currentDivs = db.get(`staff_${guildId}_${userId}_divisions`) || [];
  if (currentDivs.length === 0) {
    return { success: false, wasStaff: false };
  }

  const exactName = currentDivs.find((d) => d.toLowerCase() === divisionName.toLowerCase());
  if (!exactName) {
    return { success: false, wasStaff: true, notInDivision: true };
  }

  const newDivs = currentDivs.filter((d) => d.toLowerCase() !== divisionName.toLowerCase());
  db.delete(`staff_${guildId}_${userId}_${exactName}_title`);

  if (newDivs.length === 0) {
    // Tidak ada divisi lagi → hapus semua data staff
    removeStaff(guildId, userId);
    return { success: true, wasStaff: true, removedFromDivision: exactName, remainingDivisions: [] };
  }

  db.set(`staff_${guildId}_${userId}_divisions`, newDivs);
  return { success: true, wasStaff: true, removedFromDivision: exactName, remainingDivisions: newDivs };
}

/**
 * Hapus staff sepenuhnya (semua divisi & title).
 * Return { success, wasStaff: boolean }
 */
function removeStaff(guildId, userId) {
  const currentDivs = db.get(`staff_${guildId}_${userId}_divisions`);
  if (!currentDivs || !Array.isArray(currentDivs) || currentDivs.length === 0) {
    return { success: false, wasStaff: false };
  }

  // Hapus semua title per divisi
  for (const div of currentDivs) {
    db.delete(`staff_${guildId}_${userId}_${div}_title`);
  }
  db.delete(`staff_${guildId}_${userId}_divisions`);
  return { success: true, wasStaff: true };
}

/**
 * Ambil info staff.
 * Return { divisions: string[], titles: { division: title } } atau null kalau bukan staff.
 */
function getStaff(guildId, userId) {
  const currentDivs = db.get(`staff_${guildId}_${userId}_divisions`);
  if (!currentDivs || !Array.isArray(currentDivs) || currentDivs.length === 0) return null;

  const titles = {};
  for (const div of currentDivs) {
    const title = db.get(`staff_${guildId}_${userId}_${div}_title`);
    if (title) titles[div] = title;
  }

  return { divisions: currentDivs, titles };
}

/**
 * Ambil semua staff di guild, dikelompokkan per divisi.
 * Staff yang merangkap akan muncul di tiap divisi yang dia pegang.
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
    if (!entry.ID.endsWith('_divisions')) continue;
    if (!Array.isArray(entry.data)) continue;

    const userId = entry.ID.replace(prefix, '').replace('_divisions', '');
    const userDivs = entry.data;

    for (const div of userDivs) {
      const title = db.get(`staff_${guildId}_${userId}_${div}_title`) || null;

      const divIdx = result.findIndex((d) => d.division === div);
      if (divIdx !== -1) {
        result[divIdx].members.push({ userId, title });
      } else {
        // Divisi tidak terdaftar (mungkin sudah dihapus tapi staff belum dibersihkan)
        result.push({ division: div, members: [{ userId, title }] });
      }
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
 * Hitung total staff unik di guild (bukan total entri divisi).
 */
function getStaffCount(guildId) {
  const allData = db.all();
  const prefix = `staff_${guildId}_`;
  let count = 0;
  for (const entry of allData) {
    if (!entry.ID.startsWith(prefix)) continue;
    if (!entry.ID.endsWith('_divisions')) continue;
    if (Array.isArray(entry.data) && entry.data.length > 0) count++;
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
  removeStaffFromDivision,
  getStaff,
  getAllStaff,
  getStaffByDivision,
  getStaffCount,
  setDirectoryMessage,
  getDirectoryMessage,
  clearDirectoryMessage,
};
