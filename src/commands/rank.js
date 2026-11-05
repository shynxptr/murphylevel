const { SlashCommandBuilder } = require('discord.js');
const { createRankCard, fetchImageBuffer } = require('../utils/rankCard');
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

    const member = interaction.guild.members.cache.get(targetUser.id)
      || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
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

    // Ambil semua rank position sekaligus dalam 1 pass
    const ranks = db.getAllRankPositions(guildId, targetUser.id);
    chatData.rank = ranks.chat.rank;
    chatData.totalUsers = ranks.chat.total;
    voiceData.rank = ranks.voice.rank;
    voiceData.totalUsers = ranks.voice.total;

    // Kalau type = 'both', fetch avatar 1x lalu generate 2 card secara paralel
    if (type === 'both') {
      const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
      const avatarBuffer = await fetchImageBuffer(avatarURL).catch(() => null);
      chatData.avatarBuffer = avatarBuffer;
      voiceData.avatarBuffer = avatarBuffer;

      const [chatCard, voiceCard] = await Promise.all([
        createRankCard(member, chatData, 'chat', db.getXPNeeded(chatData.level)),
        createRankCard(member, voiceData, 'voice', db.getXPNeeded(voiceData.level)),
      ]);

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
      overallData.rank = ranks.overall.rank;
      overallData.totalUsers = ranks.overall.total;
      overallData.streak = Math.max(chatData.streak, voiceData.streak);
      overallData.streakMultiplier = Math.max(chatData.streakMultiplier, voiceData.streakMultiplier);

      const cardBuffer = await createRankCard(member, overallData, 'overall', overallData.xpNeeded);
      await interaction.editReply({
        content: `🌟 **Overall Rank ${targetUser.username}** (Chat Lv.${chatData.level} + Voice Lv.${voiceData.level})`,
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
