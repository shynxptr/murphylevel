const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');

/**
 * Format angka jadi ringkas: 12.1K, 3.6K, 1.2M
 */
function formatCompact(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

/**
 * Format durasi menit ke "3 jam 20 menit"
 */
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} menit`;
  if (mins === 0) return `${hours} jam`;
  return `${hours} jam ${mins} menit`;
}

/**
 * Format waktu lalu ("2 hari lalu", "3 jam lalu")
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'belum pernah';
  const diff = Date.now() - Number(timestamp);
  if (diff < 0) return 'baru saja';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bulan lalu`;

  return `${Math.floor(months / 12)} tahun lalu`;
}

/**
 * Buat bar progress ASCII (20 karakter) seperti di gambar
 */
function progressBar(current, needed, width = 20) {
  const ratio = Math.min(current / needed, 1);
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Hitung estimasi kapan mencapai level berikutnya
 */
function estimateNextLevel(currentLevel, xpNeeded, xpPerDay) {
  if (xpPerDay <= 0) return 'tidak ada estimasi';
  const days = Math.ceil(xpNeeded / xpPerDay);
  if (days <= 0) return 'sekarang!';
  if (days === 1) return 'besok';
  if (days < 30) return `${days} hari lagi`;
  const months = Math.round(days / 30);
  return `${months} bulan lagi`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Lihat status lengkap leveling kamu (chat & voice)')
    .addUserOption((option) =>
      option.setName('user').setDescription('Lihat status user lain').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guild.id;

    const chatData = db.getChatData(guildId, targetUser.id);
    const voiceData = db.getVoiceData(guildId, targetUser.id);
    const overallData = db.getOverallData(guildId, targetUser.id);
    const overallRank = db.getOverallRankPosition(guildId, targetUser.id);
    const chatStreak = db.getStreak(guildId, targetUser.id, 'chat');
    const voiceStreak = db.getStreak(guildId, targetUser.id, 'voice');
    const chatRank = db.getRankPosition(guildId, targetUser.id, 'chat');
    const voiceRank = db.getRankPosition(guildId, targetUser.id, 'voice');

    const chatXpNeeded = db.getXPNeeded(chatData.level);
    const voiceXpNeeded = db.getXPNeeded(voiceData.level);
    const overallPct = Math.min(Math.floor((overallData.xp / overallData.xpNeeded) * 100), 100);

    const totalXp = chatData.totalXp + voiceData.totalXp;
    const chatPct = Math.min(Math.floor((chatData.xp / chatXpNeeded) * 100), 100);
    const voicePct = Math.min(Math.floor((voiceData.xp / voiceXpNeeded) * 100), 100);

    // Estimasi rate harian (asumsi 20 pesan + 3 jam voice per hari, XP sangat ketat)
    const avgChatXp = 6;
    const dailyChatXp = 20 * avgChatXp;
    const dailyVoiceXp = 180 * 4;
    const chatDays = estimateNextLevel(chatData.level, chatXpNeeded - chatData.xp, dailyChatXp);
    const voiceDays = estimateNextLevel(voiceData.level, voiceXpNeeded - voiceData.xp, dailyVoiceXp);

    const embed = new EmbedBuilder()
      .setTitle(targetUser.username)
      .setDescription(
        `🌟 Overall Rank #${overallRank.rank || '-'} • Total ${formatCompact(totalXp)} XP`
      )
      .setColor(0x0f3460)
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

    // === CHAT XP SECTION ===
    embed.addFields({
      name: '💬 Chat XP — Level ' + chatData.level,
      value: [
        `\`${progressBar(chatData.xp, chatXpNeeded)}\` **${chatPct}%**`,
        `${formatCompact(chatData.xp)} / ${formatCompact(chatXpNeeded)} XP • Need ${formatCompact(chatXpNeeded - chatData.xp)} XP`,
        '',
        '▸ Total Pesan : ' + chatData.messages.toLocaleString() + ' pesan',
        '▸ Total Chat XP : ' + formatCompact(chatData.totalXp) + ' XP',
        '▸ Streak : ' + (chatStreak.streak > 0 ? `${chatStreak.streak} hari (${chatStreak.bonusMultiplier}x)` : 'belum ada'),
        '▸ Next Level : ' + chatDays + ' • terakhir aktif ' + formatTimeAgo(chatData.lastActive),
      ].join('\n'),
      inline: false,
    });

    // === VOICE XP SECTION ===
    embed.addFields({
      name: '🎙️ Voice XP — Level ' + voiceData.level,
      value: [
        `\`${progressBar(voiceData.xp, voiceXpNeeded)}\` **${voicePct}%**`,
        `${formatCompact(voiceData.xp)} / ${formatCompact(voiceXpNeeded)} XP • Need ${formatCompact(voiceXpNeeded - voiceData.xp)} XP`,
        '',
        '▸ Total di Voice : ' + formatDuration(voiceData.minutes),
        '▸ Total Voice XP : ' + formatCompact(voiceData.totalXp) + ' XP',
        '▸ Streak : ' + (voiceStreak.streak > 0 ? `${voiceStreak.streak} hari (${voiceStreak.bonusMultiplier}x)` : 'belum ada'),
        '▸ Next Level : ' + voiceDays + ' • terakhir aktif ' + formatTimeAgo(voiceData.lastActive),
      ].join('\n'),
      inline: false,
    });

    // === OVERALL XP SECTION ===
    const cappedHint = overallData.capped
      ? ` *(stuck: naikkan ${overallData.cappedBy === 'chat' ? 'Chat' : 'Voice'} Level ke ${overallData.level + 1})*`
      : '';
    embed.addFields({
      name: '🌟 Overall XP — Level ' + overallData.level + cappedHint,
      value: [
        `\`${progressBar(overallData.xp, overallData.xpNeeded)}\` **${overallPct}%**`,
        `${formatCompact(overallData.xp)} / ${formatCompact(overallData.xpNeeded)} XP • Need ${formatCompact(overallData.xpNeeded - overallData.xp)} XP`,
        '',
        '▸ Total XP : ' + formatCompact(overallData.totalXp),
        '▸ Rank : #' + (overallRank.rank || '-') + ' / ' + (overallRank.total || 0),
        '▸ Chat Lv.' + chatData.level + ' + Voice Lv.' + voiceData.level,
      ].join('\n'),
      inline: false,
    });

    // === RINGKASAN ===
    const chatContribution = totalXp > 0 ? Math.round((chatData.totalXp / totalXp) * 100) : 0;
    const voiceContribution = totalXp > 0 ? Math.round((voiceData.totalXp / totalXp) * 100) : 0;

    embed.addFields({
      name: '📊 Ringkasan',
      value: [
        '▸ Total XP : ' + formatCompact(totalXp),
        `▸ Chat XP : ${formatCompact(chatData.totalXp)} (${chatContribution}%)`,
        `▸ Voice XP : ${formatCompact(voiceData.totalXp)} (${voiceContribution}%)`,
        '▸ Total Pesan : ' + chatData.messages.toLocaleString() + ' pesan',
        '▸ Waktu di Voice : ' + formatDuration(voiceData.minutes),
        '▸ Rank Chat : #' + (chatRank.rank || '-') + ' | Rank Voice : #' + (voiceRank.rank || '-') + ' | Rank Overall : #' + (overallRank.rank || '-'),
      ].join('\n'),
      inline: false,
    });

    embed.setFooter({ text: `Overall Lv.${overallData.level} • Chat Lv.${chatData.level} • Voice Lv.${voiceData.level}` });
    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
