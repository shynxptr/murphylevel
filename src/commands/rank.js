const { SlashCommandBuilder } = require('discord.js');
const { createRankCard } = require('../utils/rankCard');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Lihat level & XP kamu (chat & voice)')
    .addUserOption((option) =>
      option.setName('user').setDescription('Lihat rank user lain').setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Pilih tipe level yang mau dilihat')
        .setRequired(false)
        .addChoices(
          { name: 'Chat Level', value: 'chat' },
          { name: 'Voice Level', value: 'voice' },
          { name: 'Overall Level (gabungan)', value: 'overall' },
          { name: 'Both (default)', value: 'both' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const type = interaction.options.getString('type') || 'both';
    const guildId = interaction.guild.id;

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.editReply('User tidak ditemukan di server ini.');
    }

    const chatData = db.getChatData(guildId, targetUser.id);
    const voiceData = db.getVoiceData(guildId, targetUser.id);

    // Ambil streak info untuk ditampilkan di rank card
    const chatStreak = db.getStreak(guildId, targetUser.id, 'chat');
    const voiceStreak = db.getStreak(guildId, targetUser.id, 'voice');
    chatData.streak = chatStreak.streak;
    chatData.streakMultiplier = chatStreak.bonusMultiplier;
    voiceData.streak = voiceStreak.streak;
    voiceData.streakMultiplier = voiceStreak.bonusMultiplier;

    // Ambil rank position untuk ditampilkan di rank card
    const chatRank = db.getRankPosition(guildId, targetUser.id, 'chat');
    const voiceRank = db.getRankPosition(guildId, targetUser.id, 'voice');
    chatData.rank = chatRank.rank;
    chatData.totalUsers = chatRank.total;
    voiceData.rank = voiceRank.rank;
    voiceData.totalUsers = voiceRank.total;

    // Kalau type = 'both', kirim 2 card (chat + voice)
    if (type === 'both') {
      const chatCard = await createRankCard(member, chatData, 'chat', db.getXPNeeded(chatData.level));
      const voiceCard = await createRankCard(member, voiceData, 'voice', db.getXPNeeded(voiceData.level));

      await interaction.editReply({
        content: `📊 **Rank ${targetUser.username}**`,
        files: [
          { attachment: chatCard, name: 'chat-rank.png' },
          { attachment: voiceCard, name: 'voice-rank.png' },
        ],
      });
      return;
    }

    // Kalau type = 'overall', kirim overall card
    if (type === 'overall') {
      const overallData = db.getOverallData(guildId, targetUser.id);
      const overallRank = db.getOverallRankPosition(guildId, targetUser.id);
      overallData.rank = overallRank.rank;
      overallData.totalUsers = overallRank.total;
      overallData.streak = chatData.streak;
      overallData.streakMultiplier = chatData.streakMultiplier;

      const cardBuffer = await createRankCard(member, overallData, 'overall', overallData.xpNeeded);
      const cappedNote = overallData.capped
        ? ` ⚠️ Stuck! Naikkan ${overallData.cappedBy === 'chat' ? 'Chat' : 'Voice'} Level ke ${overallData.level + 1} untuk unlock Overall Level ${overallData.level + 1}`
        : '';
      await interaction.editReply({
        content: `🌟 **Overall Rank ${targetUser.username}** (Chat Lv.${chatData.level} + Voice Lv.${voiceData.level})${cappedNote}`,
        files: [{ attachment: cardBuffer, name: 'overall-rank.png' }],
      });
      return;
    }

    // Single card
    const data = type === 'chat' ? chatData : voiceData;
    const xpNeeded = db.getXPNeeded(data.level);
    const cardBuffer = await createRankCard(member, data, type, xpNeeded);

    await interaction.editReply({
      files: [{ attachment: cardBuffer, name: `${type}-rank.png` }],
    });
  },
};
