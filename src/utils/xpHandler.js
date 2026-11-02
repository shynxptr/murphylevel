const { ChannelType } = require('discord.js');
const db = require('./database');
const { addChatXP, addVoiceXP, addVoiceMinutes, getReward, getLevelChannel, getMultiplier, updateDailyStreak, isMilestoneLevel, getChatData, getVoiceData, computeOverallLevel } = db;
const { createLevelUpGIF } = require('./levelUpCard');

// Track user yang sedang di voice channel
const voiceTracker = new Map(); // key: `${guildId}_${userId}` => joinTimestamp

// Chat XP config — XP sangat kecil supaya leveling benar-benar challenging.
// Rata-rata 6 XP/pesan, cooldown 3 menit -> max ~120 XP/hari dari chat (20 pesan)
const CHAT_XP_MIN = 3;
const CHAT_XP_MAX = 8;
const CHAT_COOLDOWN_MS = 3 * 60 * 1000; // 3 menit cooldown per user
const chatCooldown = new Map(); // key: `${guildId}_${userId}` => lastMessageTimestamp

// Voice XP config — 4 XP/menit, sangat ketat.
// 3 jam/hari = 720 XP/hari dari voice
const VOICE_XP_PER_MINUTE = 4;

/**
 * Handle message untuk chat XP
 */
function handleMessageCreate(message) {
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
    handleLevelUp(message, userId, result.newLevel, 'chat', reason);
  }

  // Cek overall level up (gabungan chat + voice)
  checkOverallLevelUp(message.guild, message.member, message.author);
}

/**
 * Cek apakah user di voice channel layak dapat XP
 * Rule: tidak server deafen, tidak self deafen, bukan di AFK channel, dan tidak sendirian
 */
function isEligibleForVoiceXP(voiceState) {
  // Server deafen → tidak dapat XP
  if (voiceState.serverDeaf) return false;

  // Self deafen → tidak dapat XP
  if (voiceState.selfDeaf) return false;

  // Di AFK channel → tidak dapat XP
  if (voiceState.channelId && voiceState.guild.afkChannelId === voiceState.channelId) return false;

  // Sendirian di channel (hanya 1 human) → tidak dapat XP
  if (voiceState.channel) {
    const humanMembers = voiceState.channel.members.filter((m) => !m.user.bot);
    if (humanMembers.size < 2) return false;
  }

  return true;
}

/**
 * Handle voice state update (join/leave/move/mute/deafen/AFK)
 */
function handleVoiceStateUpdate(oldState, newState) {
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

    // Cek user lain yang sudah ada di channel — mungkin sebelumnya sendirian (tidak ter-track)
    // Sekarang ada 2+ human, user lain mulai dapat XP juga
    const newVoiceChannel = newState.channel;
    if (newVoiceChannel) {
      const humanMembers = newVoiceChannel.members.filter((m) => !m.user.bot);
      if (humanMembers.size >= 2) {
        for (const member of humanMembers.values()) {
          if (member.id === userId) continue; // skip user yang baru join (sudah di-track di atas)
          const existingKey = `${guildId}_${member.id}`;
          if (!voiceTracker.has(existingKey)) {
            // Cek eligible untuk member yang sudah ada
            const memberVoiceState = member.voice;
            if (memberVoiceState && isEligibleForVoiceXP(memberVoiceState)) {
              voiceTracker.set(existingKey, Date.now());
            }
          }
        }
      }
    }
    return;
  }

  // User LEAVE voice channel
  if (oldChannel && !newChannel) {
    processVoiceLeave(newState.guild, userId, trackKey);

    // Cek user lain yang tersisa di channel lama — kalau tersisa 1 human, dia jadi sendirian
    const oldVoiceChannel = oldState.channel;
    if (oldVoiceChannel) {
      const remainingHumans = oldVoiceChannel.members.filter((m) => !m.user.bot);
      if (remainingHumans.size < 2) {
        // User yang tersisa sekarang sendirian — proses XP & stop tracking
        for (const member of remainingHumans.values()) {
          const remainingKey = `${guildId}_${member.id}`;
          if (voiceTracker.has(remainingKey)) {
            processVoiceLeave(newState.guild, member.id, remainingKey);
          }
        }
      }
    }
    return;
  }

  // User MOVE antar voice channel
  if (oldChannel && newChannel && oldChannel !== newChannel) {
    processVoiceLeave(newState.guild, userId, trackKey);

    // Cek user lain yang tersisa di channel lama (mungkin jadi sendirian)
    const oldVoiceChannel = oldState.channel;
    if (oldVoiceChannel) {
      const remainingHumans = oldVoiceChannel.members.filter((m) => !m.user.bot);
      if (remainingHumans.size < 2) {
        for (const member of remainingHumans.values()) {
          const remainingKey = `${guildId}_${member.id}`;
          if (voiceTracker.has(remainingKey)) {
            processVoiceLeave(newState.guild, member.id, remainingKey);
          }
        }
      }
    }

    if (isEligibleForVoiceXP(newState)) {
      voiceTracker.set(trackKey, Date.now());
    }
    return;
  }

  // State berubah tanpa pindah channel (mute/unmute/deafen/undeafen/AFK)
  if (oldChannel && newChannel && oldChannel === newChannel) {
    const wasEligible = isEligibleForVoiceXP(oldState);
    const isEligible = isEligibleForVoiceXP(newState);

    if (wasEligible && !isEligible) {
      // Dari eligible → tidak eligible: proses XP untuk waktu yang sudah berlalu, stop tracking
      processVoiceLeave(newState.guild, userId, trackKey);
    } else if (!wasEligible && isEligible) {
      // Dari tidak eligible → eligible: mulai tracking dari sekarang
      voiceTracker.set(trackKey, Date.now());
    }
    // Kalau wasEligible && isEligible → tidak ada perubahan, tetap tracking
    // Kalau !wasEligible && !isEligible → tetap tidak tracking
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

  // Cek overall level up (gabungan chat + voice)
  const member = guild.members.cache.get(userId);
  if (member) {
    checkOverallLevelUp(guild, member, member.user);
  }

  if (result.leveledUp && isMilestoneLevel(result.newLevel)) {
    const savedChannelId = getLevelChannel(guildId);
    const channel = (savedChannelId && guild.channels.cache.get(savedChannelId))
      || guild.systemChannel
      || guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('SendMessages')
        );
    if (channel && member) {
      try {
        const { createLevelUpGIF } = require('./levelUpCard');
        const gifBuffer = await createLevelUpGIF({
          username: member.displayName,
          avatarURL: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
          oldLevel: result.newLevel - 1,
          newLevel: result.newLevel,
          type: 'voice',
        });
        await channel.send({
          content: `🎉 ${member} naik ke **🎙️ Voice Level ${result.newLevel}**!${voiceReason ? ` ⚡ **${voiceReason}**` : ''}`,
          files: [{ attachment: gifBuffer, name: 'levelup-voice.gif' }],
        });
      } catch (err) {
        console.error('Gagal generate voice level up GIF:', err.message);
        channel.send(`🎙️ **${member.displayName}** naik ke **Voice Level ${result.newLevel}**! Mantap bos!`)
          .catch(() => {});
      }
    }
  } else if (result.leveledUp) {
    // Level naik tapi bukan milestone — tetap kasih role reward kalau ada (tanpa notif)
    const rewardRoleId = getReward(guildId, 'voice', result.newLevel);
    if (rewardRoleId && member) {
      try {
        const role = guild.roles.cache.get(rewardRoleId);
        if (role && !member.roles.cache.has(rewardRoleId)) {
          await member.roles.add(role);
        }
      } catch (err) {
        console.error(`Gagal kasih voice role reward: ${err.message}`);
      }
    }
  }
}

/**
 * Cek apakah overall level (gabungan chat + voice) naik.
 * Kalau naik dan milestone, kirim notif + kasih role reward 'overall'.
 * Overall level tidak disimpan — dihitung on-the-fly dari totalXp chat + voice.
 */
async function checkOverallLevelUp(guild, member, user) {
  const guildId = guild.id;
  const userId = user.id;

  const chatData = getChatData(guildId, userId);
  const voiceData = getVoiceData(guildId, userId);
  const overall = computeOverallLevel(chatData.totalXp, voiceData.totalXp);

  // Cek overall level sebelumnya yang disimpan
  const prevOverallLevelKey = `overall_${guildId}_${userId}_level`;
  const dbRaw = require('./jsonDb');
  const prevLevel = dbRaw.get(prevOverallLevelKey) || 0;

  if (overall.level > prevLevel) {
    // Simpan level overall baru
    dbRaw.set(prevOverallLevelKey, overall.level);

    const newOverallLevel = overall.level;

    // Cek role reward overall
    const rewardRoleId = getReward(guildId, 'overall', newOverallLevel);
    if (rewardRoleId && member) {
      try {
        const role = guild.roles.cache.get(rewardRoleId);
        if (role && !member.roles.cache.has(rewardRoleId)) {
          await member.roles.add(role);
        }
      } catch (err) {
        console.error(`Gagal kasih overall role reward: ${err.message}`);
      }
    }

    // Notif hanya kalau milestone
    if (isMilestoneLevel(newOverallLevel)) {
      const savedChannelId = getLevelChannel(guildId);
      const channel = (savedChannelId && guild.channels.cache.get(savedChannelId))
        || guild.systemChannel
        || guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has('SendMessages')
          );
      if (channel) {
        channel.send(`🌟 ${member} naik ke **Overall Level ${newOverallLevel}**! (Chat Lv.${chatData.level} + Voice Lv.${voiceData.level})`)
          .catch(() => {});
      }
    }
  }
}

/**
 * Handle level up: kirim GIF animasi & kasih role reward.
 * Notif channel HANYA dikirim kalau level adalah milestone (5, 10, 20, 30, ...).
 * Role reward tetap dikasih di setiap level yang punya reward, tanpa notif.
 */
async function handleLevelUp(message, userId, newLevel, type, eventReason = null) {
  const guildId = message.guild.id;
  const member = message.member;
  const oldLevel = newLevel - 1;

  // Cek role reward (tetap dikasih di semua level, tidak peduli milestone)
  const rewardRoleId = getReward(guildId, type, newLevel);
  if (rewardRoleId && member) {
    try {
      const role = message.guild.roles.cache.get(rewardRoleId);
      if (role && !member.roles.cache.has(rewardRoleId)) {
        await member.roles.add(role);
        // Hanya announce role kalau milestone level
        if (isMilestoneLevel(newLevel)) {
          const savedChannelId = getLevelChannel(guildId);
          const announceChannel = (savedChannelId && message.guild.channels.cache.get(savedChannelId))
            || message.channel;
          announceChannel.send(`🎁 ${message.author} dapat role baru: **${role.name}**!`)
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error(`Gagal kasih role reward: ${err.message}`);
    }
  }

  // Hanya kirim GIF/announce kalau level adalah milestone
  if (!isMilestoneLevel(newLevel)) return;

  const eventTag = eventReason ? ` ⚡ **${eventReason}**` : '';

  // Tentukan channel tujuan announce
  const savedChannelId = getLevelChannel(guildId);
  const announceChannel = (savedChannelId && message.guild.channels.cache.get(savedChannelId))
    || message.channel;

  try {
    // Generate animated GIF level up card
    const gifBuffer = await createLevelUpGIF({
      username: member.displayName,
      avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 256 }),
      oldLevel,
      newLevel,
      type,
    });

    // Kirim GIF dengan mention
    await announceChannel.send({
      content: `🎉 ${message.author} naik ke **${type === 'chat' ? '💬 Chat' : '🎙️ Voice'} Level ${newLevel}**!${eventTag}`,
      files: [{ attachment: gifBuffer, name: `levelup-${type}.gif` }],
    });
  } catch (err) {
    // Fallback: text only kalau GIF gagal generate
    console.error('Gagal generate level up GIF:', err.message);
    announceChannel.send(`🎉 ${message.author} naik ke **${type === 'chat' ? '💬 Chat' : '🎙️ Voice'} Level ${newLevel}**! Selamat!${eventTag}`)
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
        // Hanya track jika eligible (tidak deafen, tidak AFK, tidak sendirian)
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
};
