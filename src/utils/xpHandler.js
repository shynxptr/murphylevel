const { ChannelType } = require('discord.js');
const db = require('./database');
const jsonDb = require('./jsonDb');
const {
  addChatXP,
  addVoiceXP,
  addVoiceMinutes,
  getReward,
  getLevelChannel,
  getMultiplier,
  updateDailyStreak,
  isMilestoneLevel,
  getChatData,
  getVoiceData,
  computeOverallLevel,
  getPointsData,
  computePointsGainedInRange,
} = db;
const { createLevelUpGIF } = require('./levelUpCard');

// Track user yang sedang di voice channel
const voiceTracker = new Map(); // key: `${guildId}_${userId}` => joinTimestamp

// Chat XP config — seimbang tanpa limitasi ketat (8-15 XP/pesan, cooldown 1 menit)
const CHAT_XP_MIN = 8;
const CHAT_XP_MAX = 15;
const CHAT_COOLDOWN_MS = 60 * 1000; // 1 menit cooldown per user (mencegah spam)
const chatCooldown = new Map(); // key: `${guildId}_${userId}` => lastMessageTimestamp

// Voice XP config — 6 XP/menit
const VOICE_XP_PER_MINUTE = 6;

/**
 * Cari channel tujuan untuk announce level up di guild
 */
function resolveAnnounceChannel(guild, fallbackChannel = null) {
  const savedChannelId = getLevelChannel(guild.id);
  if (savedChannelId) {
    const saved = guild.channels.cache.get(savedChannelId);
    if (saved) return saved;
  }
  if (fallbackChannel) return fallbackChannel;
  if (guild.systemChannel) return guild.systemChannel;
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('SendMessages')
  ) || null;
}

/**
 * Cek apakah ada level milestone di rentang (oldLevel, newLevel]
 */
function hasMilestoneInRange(oldLevel, newLevel) {
  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    if (isMilestoneLevel(lvl)) return true;
  }
  return false;
}

/**
 * Berikan semua role reward yang dicapai di rentang (oldLevel, newLevel]
 */
async function grantRoleRewardsInRange(guild, member, type, oldLevel, newLevel) {
  const grantedRoles = [];
  if (!member) return grantedRoles;

  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    const rewardRoleId = getReward(guild.id, type, lvl);
    if (!rewardRoleId) continue;

    try {
      const role = guild.roles.cache.get(rewardRoleId);
      if (role && !member.roles.cache.has(rewardRoleId)) {
        await member.roles.add(role);
        grantedRoles.push(role);
      }
    } catch (err) {
      console.error(`Gagal kasih ${type} role reward (level ${lvl}): ${err.message}`);
    }
  }

  return grantedRoles;
}

/**
 * Handle message untuk chat XP
 */
async function handleMessageCreate(message) {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  const userId = message.author.id;
  const trackKey = `${guildId}_${userId}`;

  // Cooldown: 1 pesan per 3 menit dapat XP
  const now = Date.now();
  const lastMsgTime = chatCooldown.get(trackKey);
  if (lastMsgTime && now - lastMsgTime < CHAT_COOLDOWN_MS) return;
  chatCooldown.set(trackKey, now);

  // Random XP antara 3-8 (avg 6)
  const baseXP = Math.floor(Math.random() * (CHAT_XP_MAX - CHAT_XP_MIN + 1)) + CHAT_XP_MIN;

  // Event multiplier
  const { multiplier, reason } = getMultiplier(guildId);

  // Daily streak bonus (sekali per hari, bonus XP langsung ditambahkan)
  const streakInfo = updateDailyStreak(guildId, userId, 'chat');

  const xpGain = Math.floor(baseXP * multiplier) + (streakInfo.bonusXP || 0);
  const result = addChatXP(guildId, userId, xpGain);

  if (result.leveledUp) {
    await handleLevelUp(message, userId, result.oldLevel, result.newLevel, 'chat', reason);
  }

  // Cek overall level up (gabungan chat + voice)
  await checkOverallLevelUp(message.guild, message.member, message.author, message.channel);
}

/**
 * Cek apakah user di voice channel layak dapat XP
 * Rule: tidak server deafen, tidak self deafen, bukan di AFK channel, dan tidak sendirian
 */
function isEligibleForVoiceXP(voiceState) {
  if (!voiceState || !voiceState.channelId) return false;
  if (voiceState.member?.user?.bot) return false;

  // Server deafen → tidak dapat XP
  if (voiceState.serverDeaf) return false;

  // Self deafen → tidak dapat XP
  if (voiceState.selfDeaf) return false;

  // Di AFK channel → tidak dapat XP
  if (voiceState.guild.afkChannelId === voiceState.channelId) return false;

  // Sendirian di channel (hanya 1 human) → tidak dapat XP
  if (voiceState.channel) {
    const humanMembers = voiceState.channel.members.filter((m) => !m.user.bot);
    if (humanMembers.size < 2) return false;
  }

  return true;
}

/**
 * Sinkronkan status tracking seluruh member human di sebuah voice channel
 * (Mulai track jika sekarang ada >=2 human & eligible, atau stop track jika tersisa <2 human)
 */
function syncChannelVoiceTracking(voiceChannel, excludeUserId = null) {
  if (!voiceChannel) return;
  const guild = voiceChannel.guild;
  const humanMembers = voiceChannel.members.filter((m) => !m.user.bot);

  if (humanMembers.size >= 2) {
    for (const member of humanMembers.values()) {
      if (member.id === excludeUserId) continue;
      const key = `${guild.id}_${member.id}`;
      if (!voiceTracker.has(key) && member.voice && isEligibleForVoiceXP(member.voice)) {
        voiceTracker.set(key, Date.now());
      }
    }
  } else {
    for (const member of humanMembers.values()) {
      if (member.id === excludeUserId) continue;
      const key = `${guild.id}_${member.id}`;
      if (voiceTracker.has(key)) {
        processVoiceLeave(guild, member.id, key);
      }
    }
  }
}

/**
 * Handle voice state update (join/leave/move/mute/deafen/AFK)
 */
function handleVoiceStateUpdate(oldState, newState) {
  // Jangan pernah track bot di voice channel
  if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

  const guildId = newState.guild.id;
  const userId = newState.id;
  const trackKey = `${guildId}_${userId}`;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;

  // User JOIN voice channel
  if (!oldChannel && newChannel) {
    if (isEligibleForVoiceXP(newState)) {
      voiceTracker.set(trackKey, Date.now());
    }
    syncChannelVoiceTracking(newState.channel, userId);
    return;
  }

  // User LEAVE voice channel
  if (oldChannel && !newChannel) {
    processVoiceLeave(newState.guild, userId, trackKey);
    syncChannelVoiceTracking(oldState.channel, userId);
    return;
  }

  // User MOVE antar voice channel
  if (oldChannel && newChannel && oldChannel !== newChannel) {
    processVoiceLeave(newState.guild, userId, trackKey);
    syncChannelVoiceTracking(oldState.channel, userId);

    if (isEligibleForVoiceXP(newState)) {
      voiceTracker.set(trackKey, Date.now());
    }
    syncChannelVoiceTracking(newState.channel, userId);
    return;
  }

  // State berubah tanpa pindah channel (mute/unmute/deafen/undeafen/AFK)
  if (oldChannel && newChannel && oldChannel === newChannel) {
    const isNowEligible = isEligibleForVoiceXP(newState);

    if (voiceTracker.has(trackKey) && !isNowEligible) {
      // Dari eligible → tidak eligible: proses XP untuk waktu yang sudah berlalu, stop tracking
      processVoiceLeave(newState.guild, userId, trackKey);
    } else if (!voiceTracker.has(trackKey) && isNowEligible) {
      // Dari tidak eligible → eligible: mulai tracking dari sekarang
      voiceTracker.set(trackKey, Date.now());
    }
  }
}

/**
 * Berikan Voice XP untuk `minutesElapsed` menit dan proses level up / role reward / overall level up
 */
async function awardVoiceXPForMinutes(guild, userId, minutesElapsed) {
  if (minutesElapsed < 1) return;

  const guildId = guild.id;

  // Simpan menit voice
  addVoiceMinutes(guildId, userId, minutesElapsed);

  // XP per menit: 4 XP, dikali multiplier event
  const { multiplier, reason: voiceReason } = getMultiplier(guildId);
  const baseVoiceXP = minutesElapsed * VOICE_XP_PER_MINUTE;

  // Daily streak bonus (sekali per hari, bonus XP langsung ditambahkan)
  const streakInfo = updateDailyStreak(guildId, userId, 'voice');

  const xpGain = Math.floor(baseVoiceXP * multiplier) + (streakInfo.bonusXP || 0);
  const result = addVoiceXP(guildId, userId, xpGain);

  const member = guild.members.cache.get(userId)
    || await guild.members.fetch(userId).catch(() => null);

  if (result.leveledUp) {
    const oldLevel = result.oldLevel ?? (result.newLevel - 1);
    const isMilestone = hasMilestoneInRange(oldLevel, result.newLevel);

    // Selalu berikan semua role reward di level yang dicapai
    const grantedRoles = await grantRoleRewardsInRange(guild, member, 'voice', oldLevel, result.newLevel);
    const channel = resolveAnnounceChannel(guild);

    if (channel && member) {
      for (const role of grantedRoles) {
        channel.send(`🎁 ${member} dapat role baru: **${role.name}**!`).catch(() => {});
      }

      const pointsGained = Math.max(1, computePointsGainedInRange('voice', oldLevel, result.newLevel));
      const pointsBalance = getPointsData(guildId, userId).balance;
      const milestoneTag = isMilestone ? ' 🏆 **MILESTONE BONUS!**' : '';
      const pointsTag = ` • 🪙 **+${pointsGained} Poin** *(Saldo: ${pointsBalance} Poin)*${milestoneTag}`;

      try {
        const gifBuffer = await createLevelUpGIF({
          username: member.displayName,
          avatarURL: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
          oldLevel,
          newLevel: result.newLevel,
          type: 'voice',
        });
        await channel.send({
          content: `🎉 ${member} naik ke **🎙️ Voice Level ${result.newLevel}**!${pointsTag}${voiceReason ? ` ⚡ **${voiceReason}**` : ''}`,
          files: gifBuffer ? [{ attachment: gifBuffer, name: 'levelup-voice.gif' }] : [],
        });
      } catch (err) {
        console.error('Gagal generate voice level up GIF:', err.message);
        channel.send(`🎙️ **${member.displayName}** naik ke **Voice Level ${result.newLevel}**!${pointsTag} Mantap bos!`)
          .catch(() => {});
      }
    }
  }

  // Cek overall level up (gabungan chat + voice)
  if (member) {
    await checkOverallLevelUp(guild, member, member.user);
  }
}

/**
 * Proses ketika user keluar dari voice channel: hitung menit & kasih XP
 */
async function processVoiceLeave(guild, userId, trackKey) {
  if (!voiceTracker.has(trackKey)) return;

  const joinTime = voiceTracker.get(trackKey);
  const leaveTime = Date.now();
  const minutesElapsed = Math.floor((leaveTime - joinTime) / 60000);

  voiceTracker.delete(trackKey);

  if (minutesElapsed < 1) return; // Minimal 1 menit untuk dapat XP
  await awardVoiceXPForMinutes(guild, userId, minutesElapsed);
}

/**
 * Checkpoint berkala untuk semua sesi voice yang sedang aktif.
 * Menyimpan XP voice tiap beberapa menit tanpa harus menunggu user keluar dari voice channel,
 * sehingga XP tetap aman walau bot restart dan realtime saat dicek di /rank atau /status.
 */
async function flushActiveVoiceSessions(client, stopTracking = false) {
  const now = Date.now();
  for (const [trackKey, joinTime] of Array.from(voiceTracker.entries())) {
    const [guildId, userId] = trackKey.split('_');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      voiceTracker.delete(trackKey);
      continue;
    }

    const voiceState = guild.voiceStates.cache.get(userId);
    if (!stopTracking && (!voiceState?.channelId || !isEligibleForVoiceXP(voiceState))) {
      await processVoiceLeave(guild, userId, trackKey);
      continue;
    }

    const minutesElapsed = Math.floor((now - joinTime) / 60000);
    if (minutesElapsed < 1) {
      if (stopTracking) voiceTracker.delete(trackKey);
      continue;
    }

    if (stopTracking) {
      voiceTracker.delete(trackKey);
    } else {
      // Geser joinTime sebesar menit yang sudah diklaim agar sisa detik tidak hilang
      voiceTracker.set(trackKey, joinTime + minutesElapsed * 60000);
    }

    await awardVoiceXPForMinutes(guild, userId, minutesElapsed);
  }
}

/**
 * Cek apakah overall level (gabungan chat + voice) naik.
 * Kalau naik, kasih role reward 'overall' dan kirim notif GIF saat milestone.
 */
async function checkOverallLevelUp(guild, member, user, fallbackChannel = null) {
  const guildId = guild.id;
  const userId = user.id;

  const chatData = getChatData(guildId, userId);
  const voiceData = getVoiceData(guildId, userId);
  const overall = computeOverallLevel(chatData.totalXp, voiceData.totalXp, chatData.level, voiceData.level);

  const prevOverallLevelKey = `overall_${guildId}_${userId}_level`;
  const prevLevel = jsonDb.get(prevOverallLevelKey) || 0;

  if (overall.level > prevLevel) {
    jsonDb.set(prevOverallLevelKey, overall.level);
    const newOverallLevel = overall.level;

    // Berikan semua role reward overall yang dicapai di rentang (prevLevel, newOverallLevel]
    const grantedRoles = await grantRoleRewardsInRange(guild, member, 'overall', prevLevel, newOverallLevel);

    if (hasMilestoneInRange(prevLevel, newOverallLevel) || grantedRoles.length > 0) {
      const channel = resolveAnnounceChannel(guild, fallbackChannel);
      if (channel) {
        for (const role of grantedRoles) {
          channel.send(`🎁 ${member || user} dapat role baru: **${role.name}**!`).catch(() => {});
        }

        const pointsGained = Math.max(1, computePointsGainedInRange('overall', prevLevel, newOverallLevel));
        const pointsBalance = getPointsData(guildId, userId).balance;
        const pointsTag = ` • 🪙 **+${pointsGained} Poin** *(Saldo: ${pointsBalance} Poin)*`;

        const displayName = member ? member.displayName : user.username;
        try {
          const gifBuffer = await createLevelUpGIF({
            username: displayName,
            avatarURL: user.displayAvatarURL({ extension: 'png', size: 256 }),
            oldLevel: prevLevel,
            newLevel: newOverallLevel,
            type: 'overall',
          });
          await channel.send({
            content: `🌟 ${member || user} naik ke **Overall Level ${newOverallLevel}**! (Chat Lv.${chatData.level} + Voice Lv.${voiceData.level})${pointsTag}`,
            files: gifBuffer ? [{ attachment: gifBuffer, name: 'levelup-overall.gif' }] : [],
          });
        } catch (err) {
          console.error('Gagal generate overall level up GIF:', err.message);
          channel.send(`🌟 ${member || user} naik ke **Overall Level ${newOverallLevel}**! (Chat Lv.${chatData.level} + Voice Lv.${voiceData.level})${pointsTag}`)
            .catch(() => {});
        }
      }
    }
  } else if (overall.level < prevLevel) {
    jsonDb.set(prevOverallLevelKey, overall.level);
  }
}

/**
 * Handle level up: kirim GIF animasi & kasih role reward di setiap kenaikan level!
 */
async function handleLevelUp(message, userId, oldLevel, newLevel, type, eventReason = null) {
  const guild = message.guild;
  const member = message.member;
  const fromLevel = oldLevel ?? (newLevel - 1);

  // Berikan semua role reward di rentang (fromLevel, newLevel]
  const grantedRoles = await grantRoleRewardsInRange(guild, member, type, fromLevel, newLevel);
  const isMilestone = hasMilestoneInRange(fromLevel, newLevel);

  const announceChannel = resolveAnnounceChannel(guild, message.channel);
  if (!announceChannel) return;

  for (const role of grantedRoles) {
    announceChannel.send(`🎁 ${message.author} dapat role baru: **${role.name}**!`).catch(() => {});
  }

  const pointsGained = Math.max(1, computePointsGainedInRange(type, fromLevel, newLevel));
  const pointsBalance = getPointsData(guild.id, userId).balance;
  const milestoneTag = isMilestone ? ' 🏆 **MILESTONE BONUS!**' : '';
  const pointsTag = ` • 🪙 **+${pointsGained} Poin** *(Saldo: ${pointsBalance} Poin)*${milestoneTag}`;
  const eventTag = eventReason ? ` ⚡ **${eventReason}**` : '';

  try {
    const gifBuffer = await createLevelUpGIF({
      username: member ? member.displayName : message.author.username,
      avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 256 }),
      oldLevel: fromLevel,
      newLevel,
      type,
    });

    await announceChannel.send({
      content: `🎉 ${message.author} naik ke **${type === 'chat' ? '💬 Chat' : '🎙️ Voice'} Level ${newLevel}**!${pointsTag}${eventTag}`,
      files: gifBuffer ? [{ attachment: gifBuffer, name: `levelup-${type}.gif` }] : [],
    });
  } catch (err) {
    console.error('Gagal generate level up GIF:', err.message);
    announceChannel.send(`🎉 ${message.author} naik ke **${type === 'chat' ? '💬 Chat' : '🎙️ Voice'} Level ${newLevel}**! Selamat!${pointsTag}${eventTag}`)
      .catch(() => {});
  }
}

/**
 * Proses voice tracking saat bot startup untuk user yang sudah di voice channel
 */
function initVoiceTracking(client) {
  client.guilds.cache.forEach((guild) => {
    guild.voiceStates.cache.forEach((voiceState) => {
      if (voiceState.channelId && !voiceState.member?.user?.bot) {
        if (isEligibleForVoiceXP(voiceState)) {
          const trackKey = `${guild.id}_${voiceState.id}`;
          voiceTracker.set(trackKey, Date.now());
        }
      }
    });
  });
}

module.exports = {
  handleMessageCreate,
  handleVoiceStateUpdate,
  initVoiceTracking,
  flushActiveVoiceSessions,
};
