const db = require('./jsonDb');

// ============= CONFIG =============
// Unlimited Level: tidak ada batas maksimal level (Infinity)
const MAX_LEVEL = Infinity;
const TABLE_MAX_LEVEL = 2000; // Precompute lookup table s/d level 2000 untuk performa O(1), di atas itu dihitung dinamis

// Level-level milestone dasar (dan berlanjut setiap kelipatan 10 tanpa batas: 40, 50, ..., 200, 210, dst.)
const MILESTONE_LEVELS = [
  5, 10, 15, 20, 25, 30, 40, 50,
  60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
  160, 170, 180, 190, 200,
];

function isMilestoneLevel(level) {
  if (!level || level < 5) return false;
  if (level <= 30) return level % 5 === 0;
  return level % 10 === 0;
}

// ============= XP NEEDED HELPER & LOOKUP TABLE =============

// Formula kurva XP yang lebih ringan & seimbang (eksponen 1.42) agar cocok dengan sistem poin berkelanjutan:
//   Lvl 1   -> 112 XP
//   Lvl 10  -> 441 XP
//   Lvl 20  -> 987 XP
//   Lvl 50  -> 3.268 XP
//   Lvl 100 -> 8.485 XP
//   Lvl 200 -> 22.250 XP
function calcRawXPNeeded(level) {
  return Math.floor(12 * Math.pow(Math.max(0, level) + 1, 1.42) + 80);
}

const XP_NEEDED_TABLE = new Array(TABLE_MAX_LEVEL + 1);
const CUMULATIVE_XP_TABLE = new Array(TABLE_MAX_LEVEL + 1);
CUMULATIVE_XP_TABLE[0] = 0;

for (let lvl = 0; lvl <= TABLE_MAX_LEVEL; lvl++) {
  XP_NEEDED_TABLE[lvl] = calcRawXPNeeded(lvl);
  if (lvl < TABLE_MAX_LEVEL) {
    CUMULATIVE_XP_TABLE[lvl + 1] = CUMULATIVE_XP_TABLE[lvl] + XP_NEEDED_TABLE[lvl];
  }
}

/**
 * XP yang dibutuhkan untuk naik dari level L ke L+1
 */
function getXPNeeded(level) {
  if (level >= 0 && level <= TABLE_MAX_LEVEL) {
    return XP_NEEDED_TABLE[level];
  }
  return calcRawXPNeeded(level);
}

/**
 * Total XP kumulatif yang dibutuhkan untuk mencapai `level` dari level 0
 */
function getCumulativeXPForLevel(level) {
  if (level <= 0) return 0;
  if (level <= TABLE_MAX_LEVEL) {
    return CUMULATIVE_XP_TABLE[level];
  }
  let total = CUMULATIVE_XP_TABLE[TABLE_MAX_LEVEL];
  for (let l = TABLE_MAX_LEVEL; l < level; l++) {
    total += calcRawXPNeeded(l);
  }
  return total;
}

// ============= CHAT LEVEL =============

/**
 * Ambil data chat level user di guild tertentu
 */
function getChatData(guildId, userId) {
  const xp = db.get(`chat_${guildId}_${userId}_xp`) || 0;
  const level = db.get(`chat_${guildId}_${userId}_level`) || 0;
  const messages = db.get(`chat_${guildId}_${userId}_messages`) || 0;
  const totalXp = db.get(`chat_${guildId}_${userId}_totalXp`) || 0;
  const lastActive = db.get(`chat_${guildId}_${userId}_lastActive`) || null;
  return { xp, level, messages, totalXp, lastActive };
}

/**
 * Tambah chat XP ke user, auto level up (Unlimited Level), return info level up kalau naik
 */
function addChatXP(guildId, userId, amount) {
  const data = getChatData(guildId, userId);
  const oldLevel = data.level;

  db.add(`chat_${guildId}_${userId}_messages`, 1);
  db.set(`chat_${guildId}_${userId}_lastActive`, Date.now());

  let newXP = data.xp + amount;
  let newLevel = data.level;
  let leveledUp = false;

  let xpNeeded = getXPNeeded(newLevel);

  while (newXP >= xpNeeded) {
    newXP -= xpNeeded;
    newLevel++;
    leveledUp = true;
    xpNeeded = getXPNeeded(newLevel);
  }

  db.set(`chat_${guildId}_${userId}_xp`, newXP);
  db.set(`chat_${guildId}_${userId}_level`, newLevel);
  db.add(`chat_${guildId}_${userId}_totalXp`, amount);

  return {
    leveledUp,
    oldLevel,
    newLevel,
    xp: newXP,
    xpNeeded,
  };
}

// ============= VOICE LEVEL =============

/**
 * Ambil data voice level user di guild tertentu
 */
function getVoiceData(guildId, userId) {
  const xp = db.get(`voice_${guildId}_${userId}_xp`) || 0;
  const level = db.get(`voice_${guildId}_${userId}_level`) || 0;
  const minutes = db.get(`voice_${guildId}_${userId}_minutes`) || 0;
  const totalXp = db.get(`voice_${guildId}_${userId}_totalXp`) || 0;
  const lastActive = db.get(`voice_${guildId}_${userId}_lastActive`) || null;
  return { xp, level, minutes, totalXp, lastActive };
}

/**
 * Tambah voice XP ke user, auto level up (Unlimited Level), return info level up kalau naik
 */
function addVoiceXP(guildId, userId, amount) {
  const data = getVoiceData(guildId, userId);
  const oldLevel = data.level;

  db.set(`voice_${guildId}_${userId}_lastActive`, Date.now());

  let newXP = data.xp + amount;
  let newLevel = data.level;
  let leveledUp = false;

  let xpNeeded = getXPNeeded(newLevel);

  while (newXP >= xpNeeded) {
    newXP -= xpNeeded;
    newLevel++;
    leveledUp = true;
    xpNeeded = getXPNeeded(newLevel);
  }

  db.set(`voice_${guildId}_${userId}_xp`, newXP);
  db.set(`voice_${guildId}_${userId}_level`, newLevel);
  db.add(`voice_${guildId}_${userId}_totalXp`, amount);

  return {
    leveledUp,
    oldLevel,
    newLevel,
    xp: newXP,
    xpNeeded,
  };
}

/**
 * Tambah menit voice user
 */
function addVoiceMinutes(guildId, userId, minutes) {
  db.add(`voice_${guildId}_${userId}_minutes`, minutes);
}

// ============= RECALIBRATION =============

/**
 * Normalkan progress XP user agar konsisten dengan formula saat ini.
 * Dipakai saat startup untuk migrasi data lama jika ada.
 *
 * @param {string} guildId
 * @param {string} userId
 * @param {'chat'|'voice'} type
 * @returns {{ fromLevel: number, toLevel: number, recalibrated: boolean }}
 */
function recalibrateProgress(guildId, userId, type) {
  const totalKey = `${type}_${guildId}_${userId}_totalXp`;
  const levelKey = `${type}_${guildId}_${userId}_level`;
  const xpKeyReal = `${type}_${guildId}_${userId}_xp`;

  const currentLevel = db.get(levelKey) || 0;
  const currentXp = db.get(xpKeyReal) || 0;
  let totalXp = db.get(totalKey) || 0;

  // Kalau belum ada data sama sekali, tidak perlu recalibrate
  if (currentLevel === 0 && currentXp === 0 && totalXp === 0) {
    return { fromLevel: 0, toLevel: 0, recalibrated: false };
  }

  // Jika data lama punya level/xp tapi belum punya totalXp, rekonstruksi totalXp
  if (totalXp === 0 && (currentLevel > 0 || currentXp > 0)) {
    totalXp = getCumulativeXPForLevel(currentLevel) + currentXp;
    db.set(totalKey, totalXp);
  }

  // Hitung level dari total XP dengan formula saat ini
  const newLevel = computeLevel(totalXp);
  const remaining = Math.max(0, totalXp - getCumulativeXPForLevel(newLevel));

  // Kalau level sama & XP masih valid, tidak perlu ubah
  if (newLevel === currentLevel && currentXp === remaining) {
    return { fromLevel: currentLevel, toLevel: newLevel, recalibrated: false };
  }

  db.set(levelKey, newLevel);
  db.set(xpKeyReal, remaining);

  return { fromLevel: currentLevel, toLevel: newLevel, recalibrated: true };
}

/**
 * Jalankan recalibrate sekali saat startup untuk semua user yang ada di DB
 */
function recalibrateAllUsersOnStartup() {
  const seen = new Set();
  let recalibratedCount = 0;

  for (const type of ['chat', 'voice']) {
    db.forEachPrefix(`${type}_`, (key) => {
      const match = key.match(/^(chat|voice)_(\d+)_(\d+)_(xp|level|totalXp)$/);
      if (!match) return;
      const [, t, guildId, userId] = match;
      const idKey = `${t}_${guildId}_${userId}`;
      if (seen.has(idKey)) return;
      seen.add(idKey);

      const res = recalibrateProgress(guildId, userId, t);
      if (res.recalibrated) recalibratedCount++;
    });
  }

  if (recalibratedCount > 0) {
    console.log(`🔧 Recalibrated XP progress for ${recalibratedCount} user entries on startup.`);
  }
}

// ============= ROLE REWARD =============

/**
 * Set role reward untuk level tertentu (type: 'chat', 'voice', atau 'overall')
 */
function setReward(guildId, type, level, roleId) {
  db.set(`reward_${guildId}_${type}_${level}`, roleId);
}

/**
 * Ambil role reward untuk level tertentu
 */
function getReward(guildId, type, level) {
  return db.get(`reward_${guildId}_${type}_${level}`) || null;
}

/**
 * Ambil semua reward yang sudah diset untuk guild tertentu
 */
function getAllRewards(guildId, type) {
  const prefix = `reward_${guildId}_${type}_`;
  const rewards = [];

  db.forEachPrefix(prefix, (key, value) => {
    const level = parseInt(key.slice(prefix.length), 10);
    if (!Number.isNaN(level)) {
      rewards.push({ level, roleId: value });
    }
  });

  return rewards.sort((a, b) => a.level - b.level);
}

// ============= LEADERBOARD & RANKING =============

/**
 * Helper internal: kumpulkan daftar user & totalXP untuk tipe 'chat' atau 'voice' di suatu guild.
 * Menggunakan totalXp (atau fallback kumulatif level + xp) agar urutan rank akurat.
 */
function collectTypeUsers(guildId, type) {
  const prefix = `${type}_${guildId}_`;
  const userIds = new Set();

  db.forEachPrefix(prefix, (key) => {
    if (key.endsWith('_totalXp')) {
      userIds.add(key.slice(prefix.length, -'_totalXp'.length));
    } else if (key.endsWith('_xp')) {
      userIds.add(key.slice(prefix.length, -'_xp'.length));
    }
  });

  const users = [];
  for (const userId of userIds) {
    const level = db.get(`${prefix}${userId}_level`) || 0;
    const currentXp = db.get(`${prefix}${userId}_xp`) || 0;
    let totalXp = db.get(`${prefix}${userId}_totalXp`);
    if (totalXp === null || totalXp === undefined) {
      totalXp = getCumulativeXPForLevel(level) + currentXp;
    }
    if (totalXp > 0 || level > 0 || currentXp > 0) {
      users.push({ userId, xp: totalXp, currentXp, level });
    }
  }

  users.sort((a, b) => b.xp - a.xp || b.level - a.level || b.currentXp - a.currentXp);
  return users;
}

/**
 * Ambil leaderboard untuk guild tertentu (type: 'chat' atau 'voice')
 * Return array of { userId, xp (totalXp), currentXp, level }
 */
function getLeaderboard(guildId, type, limit = 10) {
  return collectTypeUsers(guildId, type).slice(0, limit);
}

/**
 * Ambil rank position user di guild (type: 'chat' atau 'voice')
 * Return { rank, total } — rank dimulai dari 1
 */
function getRankPosition(guildId, userId, type) {
  const users = collectTypeUsers(guildId, type);
  const rank = users.findIndex((u) => u.userId === userId) + 1;
  return { rank: rank > 0 ? rank : null, total: users.length };
}

/**
 * Ambil rank position chat, voice, dan overall sekaligus dalam satu kali baca (optimasi untuk /status & /rank)
 */
function getAllRankPositions(guildId, userId) {
  const chatUsers = collectTypeUsers(guildId, 'chat');
  const voiceUsers = collectTypeUsers(guildId, 'voice');

  const userTotalXp = new Map();
  for (const u of chatUsers) {
    userTotalXp.set(u.userId, (userTotalXp.get(u.userId) || 0) + u.xp);
  }
  for (const u of voiceUsers) {
    userTotalXp.set(u.userId, (userTotalXp.get(u.userId) || 0) + u.xp);
  }

  const overallUsers = Array.from(userTotalXp.entries())
    .map(([id, xp]) => ({ userId: id, xp }))
    .sort((a, b) => b.xp - a.xp);

  const chatRankIdx = chatUsers.findIndex((u) => u.userId === userId) + 1;
  const voiceRankIdx = voiceUsers.findIndex((u) => u.userId === userId) + 1;
  const overallRankIdx = overallUsers.findIndex((u) => u.userId === userId) + 1;

  return {
    chat: { rank: chatRankIdx > 0 ? chatRankIdx : null, total: chatUsers.length },
    voice: { rank: voiceRankIdx > 0 ? voiceRankIdx : null, total: voiceUsers.length },
    overall: { rank: overallRankIdx > 0 ? overallRankIdx : null, total: overallUsers.length },
  };
}

// ============= LEVEL CHANNEL =============

/**
 * Set channel announce level up untuk guild
 * @param {string} guildId
 * @param {string|null} channelId - null untuk reset
 */
function setLevelChannel(guildId, channelId) {
  if (channelId === null) {
    db.delete(`levelChannel_${guildId}`);
  } else {
    db.set(`levelChannel_${guildId}`, channelId);
  }
}

/**
 * Ambil channel announce level up untuk guild
 * @param {string} guildId
 * @returns {string|null} channelId atau null kalau belum di-set
 */
function getLevelChannel(guildId) {
  return db.get(`levelChannel_${guildId}`) || null;
}

// ============= XP MULTIPLIER EVENT =============

/**
 * Set XP multiplier untuk guild (event double XP dll)
 * @param {string} guildId
 * @param {number} multiplier - 2 = double XP, 3 = triple, 1 = normal
 * @param {string|null} reason - deskripsi event (e.g. "Double XP Weekend")
 * @param {number|null} expiresAt - timestamp berakhir (null = permanent)
 */
function setMultiplier(guildId, multiplier, reason = null, expiresAt = null) {
  db.set(`multiplier_${guildId}`, { multiplier, reason, expiresAt });
}

/**
 * Ambil multiplier yang aktif untuk guild
 * @returns {{ multiplier: number, reason: string|null, expiresAt: number|null }}
 */
function getMultiplier(guildId) {
  const data = db.get(`multiplier_${guildId}`);
  if (!data) return { multiplier: 1, reason: null, expiresAt: null };

  // Cek expired
  if (data.expiresAt && Date.now() > data.expiresAt) {
    db.delete(`multiplier_${guildId}`);
    return { multiplier: 1, reason: null, expiresAt: null };
  }

  return {
    multiplier: data.multiplier || 1,
    reason: data.reason || null,
    expiresAt: data.expiresAt || null,
  };
}

/**
 * Hapus multiplier (reset ke normal)
 */
function clearMultiplier(guildId) {
  db.delete(`multiplier_${guildId}`);
}

// ============= SCHEDULED EVENTS =============

/**
 * Buat scheduled event (recurring weekly)
 * @param {string} guildId
 * @param {object} event - { name, multiplier, dayOfWeek (0-6, 0=Sunday), startHour, endHour }
 */
function addScheduledEvent(guildId, event) {
  const events = db.get(`scheduledEvents_${guildId}`) || [];
  const id = `evt_${Date.now()}`;
  events.push({
    id,
    name: event.name,
    multiplier: event.multiplier,
    dayOfWeek: event.dayOfWeek,       // 0=Sunday, 6=Saturday
    startHour: event.startHour,       // 0-23
    endHour: event.endHour,           // 0-23 (kalau < startHour = next day)
    enabled: true,
  });
  db.set(`scheduledEvents_${guildId}`, events);
  return id;
}

/**
 * Ambil semua scheduled events untuk guild
 */
function getScheduledEvents(guildId) {
  return db.get(`scheduledEvents_${guildId}`) || [];
}

/**
 * Update scheduled event by id
 */
function updateScheduledEvent(guildId, eventId, updates) {
  const events = db.get(`scheduledEvents_${guildId}`) || [];
  const idx = events.findIndex((e) => e.id === eventId);
  if (idx === -1) return false;
  events[idx] = { ...events[idx], ...updates };
  db.set(`scheduledEvents_${guildId}`, events);
  return true;
}

/**
 * Hapus scheduled event by id
 */
function removeScheduledEvent(guildId, eventId) {
  const events = db.get(`scheduledEvents_${guildId}`) || [];
  const filtered = events.filter((e) => e.id !== eventId);
  db.set(`scheduledEvents_${guildId}`, filtered);
  return filtered.length < events.length;
}

/**
 * Cek scheduled event yang sedang aktif untuk guild
 * Bandingkan dengan waktu sekarang, return multiplier dari event yang aktif
 * Prioritas: multiplier tertinggi menang kalau ada multiple events
 */
function getActiveScheduledMultiplier(guildId) {
  const events = db.get(`scheduledEvents_${guildId}`) || [];
  if (events.length === 0) return null;

  const now = new Date();
  const day = now.getDay();        // 0=Sunday .. 6=Saturday
  const hour = now.getHours();

  let bestEvent = null;

  for (const evt of events) {
    if (!evt.enabled) continue;

    let isActive = false;
    if (evt.startHour < evt.endHour) {
      // Rentang di hari yang sama: misal 10:00 - 22:00
      isActive = day === evt.dayOfWeek && hour >= evt.startHour && hour < evt.endHour;
    } else if (evt.startHour === evt.endHour) {
      // Full 24 jam di hari tersebut (misal 0:00 - 0:00)
      isActive = day === evt.dayOfWeek;
    } else {
      // Lintas tengah malam (overnight): misal Sabtu 22:00 s/d Minggu 06:00
      const nextDay = (evt.dayOfWeek + 1) % 7;
      isActive =
        (day === evt.dayOfWeek && hour >= evt.startHour) ||
        (day === nextDay && hour < evt.endHour);
    }

    if (isActive) {
      if (!bestEvent || evt.multiplier > bestEvent.multiplier) {
        bestEvent = evt;
      }
    }
  }

  if (!bestEvent) return null;

  return {
    multiplier: bestEvent.multiplier,
    reason: bestEvent.name,
  };
}

/**
 * Sync scheduled events: kalau ada event aktif, set multiplier otomatis
 * Kalau tidak ada event aktif tapi multiplier sebelumnya dari scheduled, hapus
 * Return info perubahan untuk announce (opsional)
 */
function syncScheduledEvents(guildId) {
  const active = getActiveScheduledMultiplier(guildId);
  const current = getMultiplier(guildId);
  const events = getScheduledEvents(guildId);

  // Tandai apakah multiplier saat ini berasal dari scheduler
  const isFromScheduler = current.reason && events.some(
    (e) => e.name === current.reason
  );

  if (active) {
    // Ada event aktif: set/update multiplier
    if (current.multiplier !== active.multiplier || current.reason !== active.reason) {
      // Set multiplier dari scheduler (permanent sampai event selesai)
      setMultiplier(guildId, active.multiplier, active.reason, null);
      return { changed: true, action: 'start', multiplier: active.multiplier, reason: active.reason };
    }
    return { changed: false };
  }

  // Tidak ada event aktif: kalau multiplier sebelumnya dari scheduler, hapus
  if (isFromScheduler && current.multiplier > 1) {
    clearMultiplier(guildId);
    return { changed: true, action: 'end', multiplier: 1, reason: current.reason };
  }

  // Manual multiplier tetap dipertahankan
  return { changed: false };
}

// ============= DAILY STREAK BONUS =============

/**
 * Update daily streak untuk user, return info streak, bonus XP, & bonus Level Points!
 * Streak naik kalau user aktif di hari yang berbeda dari terakhir kali.
 * Streak reset kalau gap > 1 hari (skip sehari = reset).
 * Bonus Poin Streak:
 *   - Setiap hari streak bertambah = +1 Poin
 *   - Setiap kelipatan 5 hari streak (5, 10, 15, 20, ...) = ekstra +3 Poin (total +4 Poin hari itu)
 * @param {string} guildId
 * @param {string} userId
 * @param {'chat'|'voice'} type
 * @returns {{ streak: number, bonusMultiplier: number, bonusXP: number, pointsEarned: number }}
 */
function updateDailyStreak(guildId, userId, type) {
  const today = new Date().toDateString();
  const lastActiveKey = `streak_${guildId}_${userId}_${type}_lastDate`;
  const streakKey = `streak_${guildId}_${userId}_${type}_count`;

  const lastDate = db.get(lastActiveKey);
  let streak = db.get(streakKey) || 0;

  if (lastDate === today) {
    // Sudah active hari ini, tidak ada perubahan streak
    const bonusMultiplier = getStreakMultiplier(streak);
    return { streak, bonusMultiplier, bonusXP: 0, pointsEarned: 0 };
  }

  // Cek apakah hari terakhir adalah kemarin (streak berlanjut)
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (lastDate === yesterday) {
    streak += 1;
  } else {
    // Reset streak (skip sehari atau lebih)
    streak = 1;
  }

  db.set(lastActiveKey, today);
  db.set(streakKey, streak);

  const bonusMultiplier = getStreakMultiplier(streak);

  // Bonus XP sekali per hari saat streak naik
  // Chat: 15 XP, Voice: 10 XP
  const baseBonus = type === 'chat' ? 15 : 10;
  const bonusXP = Math.floor(baseBonus * bonusMultiplier);

  return { streak, bonusMultiplier, bonusXP };
}

/**
 * Hitung streak multiplier dari streak count (tanpa batas cap 1.5x, naik +0.1x tiap 5 hari streak).
 */
function getStreakMultiplier(streak) {
  return Number((1 + Math.floor((streak || 0) / 5) * 0.1).toFixed(1));
}

/**
 * Ambil info streak user (tanpa update)
 */
function getStreak(guildId, userId, type) {
  const streak = db.get(`streak_${guildId}_${userId}_${type}_count`) || 0;
  const lastDate = db.get(`streak_${guildId}_${userId}_${type}_lastDate`);
  const bonusMultiplier = getStreakMultiplier(streak);
  return { streak, lastDate, bonusMultiplier };
}

// ============= OVERALL LEVEL =============

/**
 * Hitung level dari total XP (Unlimited Level) menggunakan binary search O(log TABLE_MAX_LEVEL)
 * dan fallback dinamis jika melampaui TABLE_MAX_LEVEL.
 */
function computeLevel(totalXp) {
  const xp = totalXp || 0;
  if (xp <= 0) return 0;

  if (xp <= CUMULATIVE_XP_TABLE[TABLE_MAX_LEVEL]) {
    let low = 0;
    let high = TABLE_MAX_LEVEL;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (CUMULATIVE_XP_TABLE[mid] <= xp) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }

  let lvl = TABLE_MAX_LEVEL;
  let cumXp = CUMULATIVE_XP_TABLE[TABLE_MAX_LEVEL];
  while (true) {
    const needed = calcRawXPNeeded(lvl);
    if (cumXp + needed > xp) break;
    cumXp += needed;
    lvl++;
  }
  return lvl;
}

/**
 * Hitung overall level murni dari total XP gabungan (chat + voice) TANPA aturan Capped!
 * Return { level, xp (sisa di level saat ini), xpNeeded, totalXp, capped: false, cappedBy: null }
 */
function computeOverallLevel(chatTotalXp, voiceTotalXp) {
  const combinedXp = (chatTotalXp || 0) + (voiceTotalXp || 0);
  const finalLevel = computeLevel(combinedXp);
  const remaining = Math.max(0, combinedXp - getCumulativeXPForLevel(finalLevel));
  const xpNeeded = getXPNeeded(finalLevel);

  return {
    level: finalLevel,
    xp: remaining,
    xpNeeded,
    totalXp: combinedXp,
    capped: false,
    cappedBy: null,
  };
}

/**
 * Ambil data overall level user (gabungan chat + voice)
 */
function getOverallData(guildId, userId) {
  const chatData = getChatData(guildId, userId);
  const voiceData = getVoiceData(guildId, userId);
  return computeOverallLevel(chatData.totalXp, voiceData.totalXp, chatData.level, voiceData.level);
}

/**
 * Ambil rank position overall user di guild.
 * Return { rank, total }
 */
function getOverallRankPosition(guildId, userId) {
  return getAllRankPositions(guildId, userId).overall;
}

/**
 * Ambil leaderboard overall untuk guild tertentu.
 * Return array of { userId, xp (totalXp gabungan), level }
 */
function getOverallLeaderboard(guildId, limit = 10) {
  const chatUsers = collectTypeUsers(guildId, 'chat');
  const voiceUsers = collectTypeUsers(guildId, 'voice');

  const userTotalXp = new Map();
  for (const u of chatUsers) {
    userTotalXp.set(u.userId, (userTotalXp.get(u.userId) || 0) + u.xp);
  }
  for (const u of voiceUsers) {
    userTotalXp.set(u.userId, (userTotalXp.get(u.userId) || 0) + u.xp);
  }

  // Sort dan slice ke top `limit` TERLEBIH DAHULU sebelum menghitung level
  const topEntries = Array.from(userTotalXp.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  return topEntries.map(([id, xp]) => {
    const { level } = computeOverallLevel(xp, 0);
    return { userId: id, xp, level };
  });
}

// ============= LEVEL POINTS & ROLE SHOP =============

const DEFAULT_CUSTOM_ROLE_PRICE_7D = 20;    // Harga paket 7 Hari (20 Poin)
const DEFAULT_CUSTOM_ROLE_PRICE_14D = 40;   // Harga paket 14 Hari (40 Poin)
const DEFAULT_CUSTOM_ROLE_PRICE_28D = 70;   // Harga paket 28 Hari (70 Poin — hemat 10 Poin)
const DEFAULT_CUSTOM_ROLE_PRICE_PERM = 0;   // Paket Permanen dinonaktifkan (0) agar slot role server aman
const DEFAULT_CUSTOM_ROLE_EDIT_PRICE = 0;   // Edit nama/warna/icon gratis setelah beli
const DEFAULT_HOIST_UNLOCK_PRICE = 15;      // Harga unlock fitur Hoist (tampil terpisah)
const DEFAULT_SHARE_SLOT_PRICE = 10;        // Harga beli +1 slot Share ke teman
const DEFAULT_MAX_SHARE_SLOTS = Infinity;   // Tanpa batas maksimal slot Share selama poin mencukupi
const DEFAULT_WALLET_CAP = 75;              // Limit maksimal saldo dompet poin (75 Poin) agar poin tidak menumpuk
const DEFAULT_MAX_SERVER_CUSTOM_ROLES = 75; // Maksimal 75 Custom Role aktif di server (dari ~100 sisa slot role)
const DEFAULT_MIN_OVERALL_LEVEL = 10;       // Wajib minimal Overall Level 10 untuk membuat Custom Role baru
const DEFAULT_MAX_DURATION_DAYS = 60;       // Batas maksimal tumpuk durasi perpanjangan (60 Hari)
const XP_PER_ACTIVITY_POINT = 1500;         // Setiap 1.500 Total XP gabungan dapat +1 Poin grinding berkelanjutan

// Daftar User ID yang diberikan akses khusus Tester Custom Role & Shop (Bypass syarat level, kuota, & auto-saldo poin)
const TEST_ROLE_USER_IDS = new Set([
  '856414742942973962',
]);

/**
 * Cek apakah user memiliki izin khusus Tester Role & Shop
 */
function isRoleTester(userId) {
  return Boolean(userId && TEST_ROLE_USER_IDS.has(String(userId)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hitung poin dasar dari kenaikan level (+1 Poin per level)
 */
function computeTieredLevelPoints(level) {
  return Math.max(0, Math.floor(level || 0));
}

/**
 * Hitung bonus ekstra poin untuk satu level jika level tersebut merupakan Milestone (+2 Poin)
 */
function getSingleMilestoneBonus(level) {
  if (!isMilestoneLevel(level)) return 0;
  return 2;
}

/**
 * Hitung total akumulasi bonus poin dari seluruh Milestone yang sudah ditembus s/d `level`
 */
function computeMilestoneBonusPoints(level) {
  const lv = Math.max(0, Math.floor(level || 0));
  if (lv < 5) return 0;

  let bonus = 0;
  for (let m = 5; m <= Math.min(lv, 30); m += 5) {
    bonus += getSingleMilestoneBonus(m);
  }
  for (let m = 40; m <= lv; m += 10) {
    bonus += getSingleMilestoneBonus(m);
  }
  return bonus;
}

/**
 * Hitung jumlah poin yang didapat saat naik dari `oldLevel` ke `newLevel`
 */
function computePointsGainedInRange(type, oldLevel, newLevel) {
  const fromLv = Math.max(0, Math.floor(oldLevel || 0));
  const toLv = Math.max(fromLv, Math.floor(newLevel || 0));
  if (toLv <= fromLv) return 0;

  if (type === 'overall') {
    return 0; // Overall Level tidak menduplikasi poin agar rasio XP-ke-Poin tetap proporsional
  }

  const tierDiff = computeTieredLevelPoints(toLv) - computeTieredLevelPoints(fromLv);
  const milestoneDiff = computeMilestoneBonusPoints(toLv) - computeMilestoneBonusPoints(fromLv);
  return tierDiff + milestoneDiff;
}

/**
 * Ambil data poin level user di guild tertentu (Proporsional terhadap XP & Dilengkapi Wallet Cap 75 Poin):
 *   1. Chat Level (+1 Poin per level)
 *   2. Voice Level (+1 Poin per level)
 *   3. Bonus Milestone Level (+2 Poin setiap tembus milestone)
 *   4. Bonus Grinding XP (+1 Poin tiap 1.500 Total XP gabungan agar di level atas tetap mengalir)
 *   5. Sistem Wallet Cap (Default Maks 75 Poin):
 *      - Poin di dompet tidak bisa menumpuk melebihi `walletCap` (75 Poin).
 *      - Saat poin dibelanjakan, isi dompet berkurang dan bisa diisi kembali lewat grinding XP/Level berikutnya!
 */
function getPointsData(guildId, userId) {
  const cfg = getCustomRoleConfig(guildId);
  const walletCap = cfg.walletCap || DEFAULT_WALLET_CAP;

  const chatLevel = db.get(`chat_${guildId}_${userId}_level`) || 0;
  const voiceLevel = db.get(`voice_${guildId}_${userId}_level`) || 0;
  const chatTotalXp = db.get(`chat_${guildId}_${userId}_totalXp`) || 0;
  const voiceTotalXp = db.get(`voice_${guildId}_${userId}_totalXp`) || 0;
  const combinedXp = chatTotalXp + voiceTotalXp;
  const overallLevel = computeLevel(combinedXp);

  const chatTierPoints = computeTieredLevelPoints(chatLevel);
  const voiceTierPoints = computeTieredLevelPoints(voiceLevel);
  const milestonePoints = computeMilestoneBonusPoints(chatLevel) + computeMilestoneBonusPoints(voiceLevel);
  const xpActivityPoints = Math.floor(combinedXp / XP_PER_ACTIVITY_POINT);

  const rawGrindPoints = chatTierPoints + voiceTierPoints + milestonePoints + xpActivityPoints;
  const bonusPoints = db.get(`points_${guildId}_${userId}_bonus`) || 0;
  const spentPoints = db.get(`points_${guildId}_${userId}_spent`) || 0;

  const walletKey = `points_${guildId}_${userId}_wallet`;
  const lastRawKey = `points_${guildId}_${userId}_lastRaw`;

  let wallet = db.get(walletKey);
  let lastRaw = db.get(lastRawKey);

  if (typeof wallet !== 'number' || typeof lastRaw !== 'number') {
    // Semua member mulai dari saldo 0 Poin (tidak mengambil poin retroaktif dari level lama;
    // poin baru hanya masuk saat user naik level / grinding XP mulai dari sekarang)
    wallet = 0;
    lastRaw = rawGrindPoints;
    db.set(walletKey, 0);
    db.set(lastRawKey, lastRaw);
  } else if (rawGrindPoints > lastRaw) {
    // User baru saja mendapat poin baru dari grinding XP / naik level → masukkan ke dompet s/d batas walletCap
    const gained = rawGrindPoints - lastRaw;
    wallet = Math.min(walletCap, Math.max(0, wallet + gained));
    lastRaw = rawGrindPoints;
    db.set(walletKey, wallet);
    db.set(lastRawKey, lastRaw);
  } else if (rawGrindPoints < lastRaw) {
    lastRaw = rawGrindPoints;
    db.set(lastRawKey, lastRaw);
  }

  // Pastikan tidak pernah melebihi walletCap saat ini
  if (wallet > walletCap) {
    wallet = walletCap;
    db.set(walletKey, wallet);
  }

  const totalEarned = Math.max(0, wallet + spentPoints);

  return {
    balance: wallet,
    walletCap,
    isWalletFull: wallet >= walletCap,
    totalEarned,
    levelPoints: rawGrindPoints,
    chatLevel,
    voiceLevel,
    overallLevel,
    chatTierPoints,
    voiceTierPoints,
    overallPoints: 0,
    milestonePoints,
    xpActivityPoints,
    streakPoints: 0,
    bonusPoints,
    spentPoints,
  };
}

/**
 * Kurangi saldo poin user dari dompet aktif (saat membeli/extend Custom Role, Slot Share, Hoist, atau Role di Shop)
 */
function spendPoints(guildId, userId, amount) {
  const cost = Math.max(0, Math.floor(amount));
  const current = getPointsData(guildId, userId);

  // Akun Tester diizinkan menguji pembelian role/fitur meskipun saldo dompet 0 Poin
  if (isRoleTester(userId) && current.balance < cost) {
    return {
      success: true,
      balance: current.balance,
      spent: 0,
    };
  }

  if (current.balance < cost) {
    return {
      success: false,
      balance: current.balance,
      needed: cost - current.balance,
    };
  }

  const nextBalance = Math.max(0, current.balance - cost);
  if (cost > 0) {
    db.set(`points_${guildId}_${userId}_wallet`, nextBalance);
    db.add(`points_${guildId}_${userId}_spent`, cost);
  }

  return {
    success: true,
    balance: nextBalance,
    spent: cost,
  };
}

/**
 * Reset saldo dompet poin menjadi 0 untuk satu user
 */
function resetUserPoints(guildId, userId) {
  const chatLevel = db.get(`chat_${guildId}_${userId}_level`) || 0;
  const voiceLevel = db.get(`voice_${guildId}_${userId}_level`) || 0;
  const chatTotalXp = db.get(`chat_${guildId}_${userId}_totalXp`) || 0;
  const voiceTotalXp = db.get(`voice_${guildId}_${userId}_totalXp`) || 0;
  const combinedXp = chatTotalXp + voiceTotalXp;

  const rawGrindPoints =
    computeTieredLevelPoints(chatLevel) +
    computeTieredLevelPoints(voiceLevel) +
    computeMilestoneBonusPoints(chatLevel) +
    computeMilestoneBonusPoints(voiceLevel) +
    Math.floor(combinedXp / XP_PER_ACTIVITY_POINT);

  db.set(`points_${guildId}_${userId}_wallet`, 0);
  db.set(`points_${guildId}_${userId}_lastRaw`, rawGrindPoints);
  db.set(`points_${guildId}_${userId}_bonus`, 0);
  db.set(`points_${guildId}_${userId}_spent`, 0);
  return getPointsData(guildId, userId);
}

/**
 * Reset saldo dompet poin seluruh member di satu guild (atau semua guild jika guildId = null) ke 0 Poin
 */
function resetAllMemberPoints(guildId = null) {
  const pairs = new Set();
  const prefixes = guildId
    ? [`chat_${guildId}_`, `voice_${guildId}_`, `points_${guildId}_`]
    : ['chat_', 'voice_', 'points_'];

  for (const prefix of prefixes) {
    db.forEachPrefix(prefix, (key) => {
      const m = key.match(/^(?:chat|voice|points)_([^_]+)_([^_]+)_/);
      if (m) {
        pairs.add(`${m[1]}_${m[2]}`);
      }
    });
  }

  let resetCount = 0;
  for (const pair of pairs) {
    const [gId, uId] = pair.split('_');
    resetUserPoints(gId, uId);
    resetCount++;
  }
  return resetCount;
}

/**
 * Tambah atau kurangi poin bonus user oleh admin (tetap menghormati batas 0..walletCap)
 */
function adjustBonusPoints(guildId, userId, delta) {
  const cleanDelta = Math.trunc(delta);
  const current = getPointsData(guildId, userId);
  const nextWallet = Math.min(current.walletCap, Math.max(0, current.balance + cleanDelta));
  db.add(`points_${guildId}_${userId}_bonus`, cleanDelta);
  db.set(`points_${guildId}_${userId}_wallet`, nextWallet);
  return getPointsData(guildId, userId);
}

/**
 * Ambil konfigurasi Custom Role Shop di guild
 * Default:
 *   - 7 Hari = 20 Poin
 *   - 14 Hari = 40 Poin
 *   - 28 Hari = 70 Poin (hemat 10 Poin)
 *   - Limit Dompet = 75 Poin
 *   - Max Custom Role Server = 75 Role
 *   - Min Overall Level = 10
 *   - Max Tumpuk Durasi = 60 Hari
 */
function getCustomRoleConfig(guildId) {
  const cfg = db.get(`shopConfig_${guildId}`) || {};
  const price7d = typeof cfg.price7d === 'number' && cfg.price7d >= 1
    ? cfg.price7d
    : DEFAULT_CUSTOM_ROLE_PRICE_7D;
  const price14d = typeof cfg.price14d === 'number' && cfg.price14d >= 1
    ? cfg.price14d
    : DEFAULT_CUSTOM_ROLE_PRICE_14D;
  const price28d = typeof cfg.price28d === 'number' && cfg.price28d >= 1
    ? cfg.price28d
    : (typeof cfg.price30d === 'number' && cfg.price30d >= 1
        ? cfg.price30d
        : DEFAULT_CUSTOM_ROLE_PRICE_28D);
  const pricePermanent = typeof cfg.pricePermanent === 'number' && cfg.pricePermanent >= 0
    ? cfg.pricePermanent
    : DEFAULT_CUSTOM_ROLE_PRICE_PERM;

  const walletCap = typeof cfg.walletCap === 'number' && cfg.walletCap >= 10
    ? cfg.walletCap
    : DEFAULT_WALLET_CAP;
  const maxServerRoles = typeof cfg.maxServerRoles === 'number' && cfg.maxServerRoles >= 1
    ? cfg.maxServerRoles
    : DEFAULT_MAX_SERVER_CUSTOM_ROLES;
  const minOverallLevel = typeof cfg.minOverallLevel === 'number' && cfg.minOverallLevel >= 0
    ? cfg.minOverallLevel
    : DEFAULT_MIN_OVERALL_LEVEL;
  const maxDurationDays = typeof cfg.maxDurationDays === 'number' && cfg.maxDurationDays >= 7
    ? cfg.maxDurationDays
    : DEFAULT_MAX_DURATION_DAYS;

  return {
    enabled: cfg.enabled !== undefined ? Boolean(cfg.enabled) : true,
    price: price7d, // Harga mulai dari Paket 7 Hari (20 Poin)
    price7d,
    price14d,
    price28d,
    price30d: price28d, // Alias kompatibilitas
    pricePermanent,
    walletCap,
    maxServerRoles,
    minOverallLevel,
    maxDurationDays,
    editPrice: typeof cfg.editPrice === 'number' && cfg.editPrice >= 0 ? cfg.editPrice : DEFAULT_CUSTOM_ROLE_EDIT_PRICE,
    hoistPrice: typeof cfg.hoistPrice === 'number' && cfg.hoistPrice >= 0 ? cfg.hoistPrice : DEFAULT_HOIST_UNLOCK_PRICE,
    shareSlotPrice: typeof cfg.shareSlotPrice === 'number' && cfg.shareSlotPrice >= 1 ? cfg.shareSlotPrice : DEFAULT_SHARE_SLOT_PRICE,
    maxShareSlots: typeof cfg.maxShareSlots === 'number' && cfg.maxShareSlots >= 1 ? cfg.maxShareSlots : DEFAULT_MAX_SHARE_SLOTS,
    anchorRoleId: cfg.anchorRoleId || null,
  };
}

/**
 * Ambil detail paket durasi Custom Role berdasarkan key ('7d' | '14d' | '28d' / '30d' | 'perm')
 */
function getCustomRolePlanInfo(guildId, planKey = '7d') {
  const cfg = getCustomRoleConfig(guildId);
  const normalizedKey = String(planKey || '7d').toLowerCase();

  if (normalizedKey === '7d' || normalizedKey === '7') {
    return {
      key: '7d',
      label: '7 Hari',
      days: 7,
      durationMs: 7 * DAY_MS,
      price: cfg.price7d,
      enabled: true,
    };
  }

  if (normalizedKey === '14d' || normalizedKey === '14') {
    return {
      key: '14d',
      label: '14 Hari',
      days: 14,
      durationMs: 14 * DAY_MS,
      price: cfg.price14d,
      enabled: true,
    };
  }

  if (normalizedKey === 'perm' || normalizedKey === 'permanent' || normalizedKey === 'lifetime') {
    return {
      key: 'perm',
      label: 'Permanen',
      days: null,
      durationMs: null,
      price: cfg.pricePermanent,
      enabled: cfg.pricePermanent > 0,
    };
  }

  return {
    key: '28d',
    label: '28 Hari',
    days: 28,
    durationMs: 28 * DAY_MS,
    price: cfg.price28d,
    enabled: true,
  };
}

/**
 * Hitung jumlah Custom Role yang sedang aktif di sebuah guild (untuk menjaga batas 75 slot role server)
 */
function getActiveCustomRoleCount(guildId, now = Date.now()) {
  let count = 0;
  db.forEachPrefix(`customRole_${guildId}_`, (_key, val) => {
    if (!val || !val.roleId) return;
    if (typeof val.expiresAt === 'number' && val.expiresAt <= now) return;
    count++;
  });
  return count;
}

/**
 * Update konfigurasi Custom Role Shop di guild
 */
function setCustomRoleConfig(guildId, updates) {
  const current = getCustomRoleConfig(guildId);
  const next = { ...current, ...updates };
  db.set(`shopConfig_${guildId}`, next);
  return getCustomRoleConfig(guildId);
}

/**
 * Ambil data Custom Role pribadi milik user (jika sudah punya), dinormalisasi ke schema lengkap
 */
function getUserCustomRole(guildId, userId) {
  const raw = db.get(`customRole_${guildId}_${userId}`);
  if (!raw) return null;

  const expiresAt = typeof raw.expiresAt === 'number' ? raw.expiresAt : null;

  return {
    roleId: raw.roleId,
    ownerId: raw.ownerId || userId,
    name: raw.name || 'Custom Role',
    color: (raw.color || '#CECECE').toUpperCase(),
    sideColor: raw.sideColor ? raw.sideColor.toUpperCase() : null,
    description: raw.description || "This custom role's duration follows your active Level Points plan.",
    iconURL: raw.iconURL || null,
    bannerURL: raw.bannerURL || null,
    hoisted: Boolean(raw.hoisted),
    hoistUnlocked: Boolean(raw.hoistUnlocked),
    maxShares: typeof raw.maxShares === 'number' ? raw.maxShares : 0, // Mulai dari 0 slot Share
    sharedWith: Array.isArray(raw.sharedWith) ? raw.sharedWith : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    durationPlan: raw.durationPlan || (expiresAt ? '30d' : 'perm'),
    expiresAt, // Timestamp ms kapan role berakhir, atau null jika Permanen
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

/**
 * Simpan atau hapus data Custom Role pribadi milik user
 */
function setUserCustomRole(guildId, userId, roleData) {
  const key = `customRole_${guildId}_${userId}`;
  if (!roleData) {
    db.delete(key);
    return null;
  }
  const expiresAt = typeof roleData.expiresAt === 'number' ? roleData.expiresAt : null;
  const normalized = {
    ...roleData,
    ownerId: userId,
    color: (roleData.color || '#CECECE').toUpperCase(),
    sideColor: roleData.sideColor ? roleData.sideColor.toUpperCase() : null,
    maxShares: typeof roleData.maxShares === 'number' ? roleData.maxShares : 0,
    sharedWith: Array.isArray(roleData.sharedWith) ? roleData.sharedWith : [],
    history: Array.isArray(roleData.history) ? roleData.history.slice(-15) : [],
    durationPlan: roleData.durationPlan || (expiresAt ? '30d' : 'perm'),
    expiresAt,
    updatedAt: Date.now(),
  };
  db.set(key, normalized);
  return normalized;
}

/**
 * Perpanjang masa aktif Custom Role user (atau upgrade ke Permanen)
 */
function extendUserCustomRole(guildId, userId, planKey) {
  const current = getUserCustomRole(guildId, userId);
  if (!current) return null;

  const plan = getCustomRolePlanInfo(guildId, planKey);
  let nextExpiresAt = null;
  let nextPlan = current.durationPlan;

  if (plan.key === 'perm') {
    nextExpiresAt = null;
    nextPlan = 'perm';
  } else {
    const baseTime = current.expiresAt && current.expiresAt > Date.now()
      ? current.expiresAt
      : Date.now();
    nextExpiresAt = baseTime + plan.durationMs;
    nextPlan = plan.key;
  }

  return setUserCustomRole(guildId, userId, {
    ...current,
    durationPlan: nextPlan,
    expiresAt: nextExpiresAt,
  });
}

/**
 * Ambil daftar semua Custom Role yang sudah melewati batas waktu aktif (expired)
 * Return array of { guildId, userId, customData }
 */
function getExpiredCustomRoles(now = Date.now()) {
  const expired = [];
  db.forEachPrefix('customRole_', (key, val) => {
    if (!val || typeof val.expiresAt !== 'number') return;
    if (val.expiresAt <= now) {
      const match = key.match(/^customRole_(\d+)_(\d+)$/);
      if (match) {
        const [, guildId, userId] = match;
        expired.push({ guildId, userId, customData: val });
      }
    }
  });
  return expired;
}

/**
 * Catat riwayat perubahan pada Custom Role milik user (maksimal 15 entri terakhir)
 */
function appendCustomRoleHistory(guildId, userId, action) {
  const current = getUserCustomRole(guildId, userId);
  if (!current) return null;

  const history = [...(current.history || []), { action, timestamp: Date.now() }].slice(-15);
  return setUserCustomRole(guildId, userId, { ...current, history });
}

/**
 * Pindahkan kepemilikan Custom Role dari satu user ke user lain
 */
function transferUserCustomRole(guildId, fromUserId, toUserId) {
  const current = getUserCustomRole(guildId, fromUserId);
  if (!current) return { success: false, error: 'Custom role tidak ditemukan.' };

  const targetExisting = getUserCustomRole(guildId, toUserId);
  if (targetExisting) {
    return { success: false, error: 'User tujuan sudah memiliki Custom Role sendiri.' };
  }

  const updatedHistory = [
    ...(current.history || []),
    { action: `Transferred from <@${fromUserId}> to <@${toUserId}>`, timestamp: Date.now() },
  ].slice(-15);

  const transferred = setUserCustomRole(guildId, toUserId, {
    ...current,
    ownerId: toUserId,
    sharedWith: (current.sharedWith || []).filter((id) => id !== toUserId),
    history: updatedHistory,
  });

  db.delete(`customRole_${guildId}_${fromUserId}`);
  return { success: true, data: transferred };
}

/**
 * Ambil daftar role di katalog Role Shop untuk guild tertentu
 * Return array of { roleId, price, description, addedAt }
 */
function getShopCatalog(guildId) {
  const items = db.get(`shopCatalog_${guildId}`);
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => a.price - b.price);
}

/**
 * Tambah atau update role di katalog Role Shop
 */
function upsertShopCatalogRole(guildId, { roleId, price, description = null }) {
  const items = db.get(`shopCatalog_${guildId}`) || [];
  const cleanPrice = Math.max(1, Math.floor(price));
  const idx = items.findIndex((i) => i.roleId === roleId);

  const entry = {
    roleId,
    price: cleanPrice,
    description: description || null,
    addedAt: Date.now(),
  };

  if (idx !== -1) {
    items[idx] = entry;
  } else {
    items.push(entry);
  }

  db.set(`shopCatalog_${guildId}`, items);
  return entry;
}

/**
 * Hapus role dari katalog Role Shop
 */
function removeShopCatalogRole(guildId, roleId) {
  const items = db.get(`shopCatalog_${guildId}`) || [];
  const filtered = items.filter((i) => i.roleId !== roleId);
  db.set(`shopCatalog_${guildId}`, filtered);
  return filtered.length < items.length;
}

// ============= AUTO-RESET OVERALL LEVEL CACHE =============

/**
 * Reset semua cached overall level (key: overall_{guildId}_{userId}_level) jika belum di-migrasi.
 */
function resetOverallLevelCache() {
  let reset = 0;
  db.forEachPrefix('overall_', (key) => {
    if (key.endsWith('_level')) {
      const match = key.match(/^overall_(\d+)_(\d+)_level$/);
      if (match) {
        const [, guildId, userId] = match;
        const overall = getOverallData(guildId, userId);
        const cached = db.get(key) || 0;
        if (cached !== overall.level) {
          db.set(key, overall.level);
          reset++;
        }
      }
    }
  });
  if (reset > 0) {
    console.log(`🔄 Overall level: synced ${reset} cached entries with capped rule.`);
  }
}

const POINTS_ZERO_RESET_VERSION = 1;

function resetAllPointsOnStartupOnce() {
  if (db.get('migration_points_zero_reset_version') === POINTS_ZERO_RESET_VERSION) return;
  const count = resetAllMemberPoints(null);
  db.set('migration_points_zero_reset_version', POINTS_ZERO_RESET_VERSION);
  console.log(`🔄 Points Reset Migration: Reset saldo poin ${count} member ke 0 Poin.`);
}

// Run startup migrations once on load
recalibrateAllUsersOnStartup();
resetOverallLevelCache();
resetAllPointsOnStartupOnce();

module.exports = {
  MAX_LEVEL,
  MILESTONE_LEVELS,
  isMilestoneLevel,
  getChatData,
  addChatXP,
  getVoiceData,
  addVoiceXP,
  addVoiceMinutes,
  getXPNeeded,
  getCumulativeXPForLevel,
  setReward,
  getReward,
  getAllRewards,
  getLeaderboard,
  getRankPosition,
  getAllRankPositions,
  recalibrateProgress,
  setLevelChannel,
  getLevelChannel,
  setMultiplier,
  getMultiplier,
  clearMultiplier,
  addScheduledEvent,
  getScheduledEvents,
  updateScheduledEvent,
  removeScheduledEvent,
  getActiveScheduledMultiplier,
  syncScheduledEvents,
  updateDailyStreak,
  getStreak,
  computeOverallLevel,
  computeLevel,
  getOverallData,
  getOverallRankPosition,
  getOverallLeaderboard,
  isRoleTester,
  getPointsData,
  computePointsGainedInRange,
  computeTieredLevelPoints,
  computeMilestoneBonusPoints,
  getSingleMilestoneBonus,
  spendPoints,
  resetUserPoints,
  resetAllMemberPoints,
  adjustBonusPoints,
  getCustomRoleConfig,
  getCustomRolePlanInfo,
  getActiveCustomRoleCount,
  setCustomRoleConfig,
  getUserCustomRole,
  setUserCustomRole,
  extendUserCustomRole,
  getExpiredCustomRoles,
  appendCustomRoleHistory,
  transferUserCustomRole,
  getShopCatalog,
  upsertShopCatalogRole,
  removeShopCatalogRole,
};
