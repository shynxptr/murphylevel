const db = require('./jsonDb');

// ============= CONFIG =============
const MAX_LEVEL = 200;

// Level-level milestone: HANYA di level ini notif level-up dikirim ke channel.
// Tujuan: mengurangi spam notifikasi. Level lain naik diam-diam (XP tetap jalan, role tetap dikasih).
const MILESTONE_LEVELS = [
  5, 10, 15, 20, 25, 30, 40, 50,
  60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
  160, 170, 180, 190, 200,
];

function isMilestoneLevel(level) {
  return MILESTONE_LEVELS.includes(level);
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
 * Tambah chat XP ke user, auto level up, return info level up kalau naik
 */
function addChatXP(guildId, userId, amount) {
  // Normalkan progress lama ke formula saat ini (migration)
  recalibrateProgress(guildId, userId, 'chat');

  const data = getChatData(guildId, userId);

  // Level cap: kalau sudah MAX_LEVEL, XP tidak bertambah
  if (data.level >= MAX_LEVEL) {
    return {
      leveledUp: false,
      newLevel: MAX_LEVEL,
      xp: 0,
      xpNeeded: getXPNeeded(MAX_LEVEL),
      maxLevel: true,
    };
  }

  let newXP = data.xp + amount;
  let newLevel = data.level;
  let leveledUp = false;

  // XP yang dibutuhkan untuk level berikutnya: 50 * (level^2) + 100 * level + 200
  let xpNeeded = getXPNeeded(newLevel);

  while (newXP >= xpNeeded && newLevel < MAX_LEVEL) {
    newXP -= xpNeeded;
    newLevel++;
    leveledUp = true;
    xpNeeded = getXPNeeded(newLevel);
  }

  // Kalau mencapai MAX_LEVEL, reset XP ke 0
  if (newLevel >= MAX_LEVEL) {
    newXP = 0;
    xpNeeded = getXPNeeded(MAX_LEVEL);
  }

  db.set(`chat_${guildId}_${userId}_xp`, newXP);
  db.set(`chat_${guildId}_${userId}_level`, newLevel);
  db.add(`chat_${guildId}_${userId}_messages`, 1);
  db.add(`chat_${guildId}_${userId}_totalXp`, amount);
  db.set(`chat_${guildId}_${userId}_lastActive`, Date.now());

  return {
    leveledUp,
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
 * Tambah voice XP ke user, auto level up, return info level up kalau naik
 */
function addVoiceXP(guildId, userId, amount) {
  // Normalkan progress lama ke formula saat ini (migration)
  recalibrateProgress(guildId, userId, 'voice');

  const data = getVoiceData(guildId, userId);

  // Level cap: kalau sudah MAX_LEVEL, XP tidak bertambah
  if (data.level >= MAX_LEVEL) {
    return {
      leveledUp: false,
      newLevel: MAX_LEVEL,
      xp: 0,
      xpNeeded: getXPNeeded(MAX_LEVEL),
      maxLevel: true,
    };
  }

  let newXP = data.xp + amount;
  let newLevel = data.level;
  let leveledUp = false;

  let xpNeeded = getXPNeeded(newLevel);

  while (newXP >= xpNeeded && newLevel < MAX_LEVEL) {
    newXP -= xpNeeded;
    newLevel++;
    leveledUp = true;
    xpNeeded = getXPNeeded(newLevel);
  }

  // Kalau mencapai MAX_LEVEL, reset XP ke 0
  if (newLevel >= MAX_LEVEL) {
    newXP = 0;
    xpNeeded = getXPNeeded(MAX_LEVEL);
  }

  db.set(`voice_${guildId}_${userId}_xp`, newXP);
  db.set(`voice_${guildId}_${userId}_level`, newLevel);
  db.add(`voice_${guildId}_${userId}_totalXp`, amount);
  db.set(`voice_${guildId}_${userId}_lastActive`, Date.now());

  return {
    leveledUp,
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

// ============= XP NEEDED HELPER =============

/**
 * XP yang dibutuhkan untuk naik dari level L ke L+1
 * Power-based dengan eksponen 1.75 — curva sangat steep supaya grinding terasa berat:
 *   Lvl 1   -> 113 XP
 *   Lvl 10  -> 744 XP
 *   Lvl 20  -> 2.140 XP
 *   Lvl 50  -> 9.813 XP
 *   Lvl 100 -> ~35.000 XP
 *   Lvl 200 -> ~122.000 XP
 * Total 0->200 = ±7.9 juta XP (±3.4 tahun gabungan chat+voice untuk user sangat aktif)
 */
function getXPNeeded(level) {
  return Math.floor(10 * Math.pow(level + 1, 1.75) + 80);
}

// ============= RECALIBRATION =============

/**
 * Normalkan progress XP user agar konsisten dengan formula saat ini.
 * Dipakai setelah ada perubahan formula XP (misal migration dari linear ke power-based).
 * Menghitung ulang level dari total XP yang sudah dikumpulkan user,
 * lalu menyimpan sisa XP di level baru.
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
  const totalXp = db.get(totalKey) || 0;

  // Kalau belum ada data, tidak perlu recalibrate
  if (currentLevel === 0 && currentXp === 0 && totalXp === 0) {
    return { fromLevel: 0, toLevel: 0, recalibrated: false };
  }

  // Hitung level dari total XP dengan formula baru
  let newLevel = 0;
  let remaining = totalXp;
  while (newLevel < MAX_LEVEL) {
    const need = getXPNeeded(newLevel);
    if (remaining < need) break;
    remaining -= need;
    newLevel++;
  }

  // Kalau level sama & XP masih valid, tidak perlu ubah
  if (newLevel === currentLevel && currentXp < getXPNeeded(currentLevel)) {
    return { fromLevel: currentLevel, toLevel: newLevel, recalibrated: false };
  }

  db.set(levelKey, newLevel);
  db.set(xpKeyReal, remaining);

  return { fromLevel: currentLevel, toLevel: newLevel, recalibrated: true };
}

// ============= ROLE REWARD =============

/**
 * Set role reward untuk level tertentu (type: 'chat' atau 'voice')
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
  const allData = db.all();
  const prefix = `reward_${guildId}_${type}_`;
  const rewards = [];

  for (const entry of allData) {
    if (entry.ID.startsWith(prefix)) {
      const level = parseInt(entry.ID.replace(prefix, ''));
      rewards.push({ level, roleId: entry.data });
    }
  }

  return rewards.sort((a, b) => a.level - b.level);
}

// ============= LEADERBOARD =============

/**
 * Ambil leaderboard untuk guild tertentu (type: 'chat' atau 'voice')
 * Return array of { userId, xp, level }
 */
function getLeaderboard(guildId, type, limit = 10) {
  const allData = db.all();
  const prefix = `${type}_${guildId}_`;
  const users = [];

  for (const entry of allData) {
    if (entry.ID.startsWith(prefix) && entry.ID.endsWith('_xp')) {
      const userId = entry.ID.replace(prefix, '').replace('_xp', '');
      const level = db.get(`${type}_${guildId}_${userId}_level`) || 0;
      users.push({ userId, xp: entry.data, level });
    }
  }

  return users.sort((a, b) => b.xp - a.xp).slice(0, limit);
}

/**
 * Ambil rank position user di guild (type: 'chat' atau 'voice')
 * Return { rank, total } — rank dimulai dari 1
 */
function getRankPosition(guildId, userId, type) {
  const allData = db.all();
  const prefix = `${type}_${guildId}_`;
  const users = [];

  for (const entry of allData) {
    if (entry.ID.startsWith(prefix) && entry.ID.endsWith('_xp')) {
      const id = entry.ID.replace(prefix, '').replace('_xp', '');
      users.push({ userId: id, xp: entry.data });
    }
  }

  users.sort((a, b) => b.xp - a.xp);
  const rank = users.findIndex((u) => u.userId === userId) + 1;
  return { rank: rank > 0 ? rank : null, total: users.length };
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
  const day = now.getDay();        // 0=Sunday
  const hour = now.getHours();

  let bestEvent = null;

  for (const evt of events) {
    if (!evt.enabled) continue;

    // Cek apakah hari ini adalah dayOfWeek
    if (evt.dayOfWeek !== day) continue;

    // Cek apakah jam sekarang dalam rentang start-end
    let isActive = false;
    if (evt.startHour <= evt.endHour) {
      // Same day range: e.g. 10-22
      isActive = hour >= evt.startHour && hour < evt.endHour;
    } else {
      // Overnight range: e.g. 22-6 (start > end, berarti sampai besok)
      isActive = hour >= evt.startHour || hour < evt.endHour;
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
 * Update daily streak untuk user, return info streak & bonus XP
 * Streak naik kalau user aktif di hari yang berbeda dari terakhir kali.
 * Streak reset kalau gap > 1 hari (skip sehari = reset).
 * Bonus multiplier maksimal 1.5x (streak 15+), scaling lebih lambat.
 * @param {string} guildId
 * @param {string} userId
 * @param {'chat'|'voice'} type
 * @returns {{ streak: number, bonusMultiplier: number, bonusXP: number }}
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
    return { streak, bonusMultiplier, bonusXP: 0 };
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

  // Bonus XP sekali per hari saat streak naik (lebih kecil dari sebelumnya)
  // Chat: 15 XP, Voice: 10 XP
  const baseBonus = type === 'chat' ? 15 : 10;
  const bonusXP = Math.floor(baseBonus * bonusMultiplier);

  return { streak, bonusMultiplier, bonusXP };
}

/**
 * Hitung streak multiplier dari streak count.
 * Scaling lambat: 1x (0-4), 1.1x (5-9), 1.2x (10-14), 1.3x (15-19), 1.4x (20-24), 1.5x (25+)
 */
function getStreakMultiplier(streak) {
  return Math.min(1 + Math.floor(streak / 5) * 0.1, 1.5);
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
 * Hitung level dari total XP (tanpa capped).
 * Dipakai untuk menentukan chatLevel & voiceLevel di computeOverallLevel.
 */
function computeLevel(totalXp) {
  let level = 0;
  let remaining = totalXp || 0;
  while (level < MAX_LEVEL) {
    const need = getXPNeeded(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return level;
}

/**
 * Hitung overall level dari total XP gabungan (chat + voice).
 * Pakai formula yang sama (getXPNeeded), tapi XP pool = chat totalXp + voice totalXp.
 *
 * LIMITASI: Overall level TIDAK boleh lebih tinggi dari level terendah
 * antara chat & voice. Jadi overall level = min(computedLevel, chatLevel, voiceLevel).
 * XP berlebih tetap disimpan sebagai progress ke level berikutnya.
 *
 * Return { level, xp (sisa di level saat ini), xpNeeded, totalXp, capped }
 */
function computeOverallLevel(chatTotalXp, voiceTotalXp, chatLevel, voiceLevel) {
  const combinedXp = (chatTotalXp || 0) + (voiceTotalXp || 0);

  // Hitung level dari combined XP (seperti sebelumnya)
  let computedLevel = 0;
  let remaining = combinedXp;
  while (computedLevel < MAX_LEVEL) {
    const need = getXPNeeded(computedLevel);
    if (remaining < need) break;
    remaining -= need;
    computedLevel++;
  }
  if (computedLevel >= MAX_LEVEL) remaining = 0;

  // Capped: overall level tidak boleh lebih tinggi dari level terendah
  const chatLv = chatLevel || 0;
  const voiceLv = voiceLevel || 0;
  const minLevel = Math.min(chatLv, voiceLv);
  const capped = computedLevel > minLevel;
  const finalLevel = Math.min(computedLevel, minLevel);

  // Hitung ulang XP remaining berdasarkan finalLevel
  // (total XP - total XP yang dibutuhkan untuk mencapai finalLevel)
  if (capped) {
    remaining = combinedXp;
    for (let i = 0; i < finalLevel; i++) {
      remaining -= getXPNeeded(i);
    }
    if (remaining < 0) remaining = 0;
  }

  return {
    level: finalLevel,
    xp: remaining,
    xpNeeded: getXPNeeded(finalLevel),
    totalXp: combinedXp,
    capped, // true kalau overall level di-cap oleh level terendah
  };
}

/**
 * Ambil data overall level user (gabungan chat + voice)
 */
function getOverallData(guildId, userId) {
  const chatData = getChatData(guildId, userId);
  const voiceData = getVoiceData(guildId, userId);
  const overall = computeOverallLevel(chatData.totalXp, voiceData.totalXp, chatData.level, voiceData.level);
  return overall;
}

/**
 * Ambil rank position overall user di guild.
 * Return { rank, total }
 */
function getOverallRankPosition(guildId, userId) {
  const allData = db.all();
  const chatPrefix = `chat_${guildId}_`;
  const voicePrefix = `voice_${guildId}_`;

  // Kumpulkan total XP per user dari chat dan voice
  const userTotalXp = new Map();

  for (const entry of allData) {
    // Cari key yang berakhiran _totalXp
    if (!entry.ID.endsWith('_totalXp')) continue;

    if (entry.ID.startsWith(chatPrefix)) {
      const userId = entry.ID.replace(chatPrefix, '').replace('_totalXp', '');
      userTotalXp.set(userId, (userTotalXp.get(userId) || 0) + (entry.data || 0));
    } else if (entry.ID.startsWith(voicePrefix)) {
      const userId = entry.ID.replace(voicePrefix, '').replace('_totalXp', '');
      userTotalXp.set(userId, (userTotalXp.get(userId) || 0) + (entry.data || 0));
    }
  }

  const users = Array.from(userTotalXp.entries()).map(([id, xp]) => ({ userId: id, xp }));
  users.sort((a, b) => b.xp - a.xp);

  const rank = users.findIndex((u) => u.userId === userId) + 1;
  return { rank: rank > 0 ? rank : null, total: users.length };
}

/**
 * Ambil leaderboard overall untuk guild tertentu.
 * Return array of { userId, xp (totalXp gabungan), level }
 */
function getOverallLeaderboard(guildId, limit = 10) {
  const allData = db.all();
  const chatPrefix = `chat_${guildId}_`;
  const voicePrefix = `voice_${guildId}_`;

  const userTotalXp = new Map();

  for (const entry of allData) {
    if (!entry.ID.endsWith('_totalXp')) continue;

    if (entry.ID.startsWith(chatPrefix)) {
      const userId = entry.ID.replace(chatPrefix, '').replace('_totalXp', '');
      userTotalXp.set(userId, (userTotalXp.get(userId) || 0) + (entry.data || 0));
    } else if (entry.ID.startsWith(voicePrefix)) {
      const userId = entry.ID.replace(voicePrefix, '').replace('_totalXp', '');
      userTotalXp.set(userId, (userTotalXp.get(userId) || 0) + (entry.data || 0));
    }
  }

  const users = Array.from(userTotalXp.entries()).map(([id, xp]) => {
    // Hitung level dari total XP dengan limitasi min(chatLevel, voiceLevel)
    const chatTotalXp = db.get(`chat_${guildId}_${id}_totalXp`) || 0;
    const voiceTotalXp = db.get(`voice_${guildId}_${id}_totalXp`) || 0;
    const chatLevel = computeLevel(chatTotalXp);
    const voiceLevel = computeLevel(voiceTotalXp);
    const { level } = computeOverallLevel(chatTotalXp, voiceTotalXp, chatLevel, voiceLevel);
    return { userId: id, xp, level };
  });

  return users.sort((a, b) => b.xp - a.xp).slice(0, limit);
}

// ============= AUTO-RESET OVERALL LEVEL CACHE =============

/**
 * Reset semua cached overall level (key: overall_{guildId}_{userId}_level).
 * Dilakukan saat bot start supaya aturan capped baru (min chatLevel, voiceLevel)
 * langsung berlaku untuk semua user yang sudah ada.
 *
 * Tanpa reset, user yang overall level-nya sudah disimpan dengan aturan lama
 * (uncapped) tidak akan dikoreksi sampai mereka naik level lagi.
 */
function resetOverallLevelCache() {
  const allData = db.all();
  let reset = 0;
  for (const entry of allData) {
    if (entry.ID.startsWith('overall_') && entry.ID.endsWith('_level')) {
      db.delete(entry.ID);
      reset++;
    }
  }
  if (reset > 0) {
    console.log(`🔄 Overall level: reset ${reset} cached entries (applying new capped rule).`);
  }
}

// Run reset on load
resetOverallLevelCache();

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
  setReward,
  getReward,
  getAllRewards,
  getLeaderboard,
  getRankPosition,
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
};
