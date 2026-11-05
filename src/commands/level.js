const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Lihat level & XP kamu dalam bentuk text (tanpa gambar)')
    .addUserOption((option) =>
      option.setName('user').setDescription('Lihat level user lain').setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guild.id;

    const chatData = db.getChatData(guildId, targetUser.id);
    const voiceData = db.getVoiceData(guildId, targetUser.id);
    const overallData = db.getOverallData(guildId, targetUser.id);
    const overallRank = db.getOverallRankPosition(guildId, targetUser.id);
    const pointsData = db.getPointsData(guildId, targetUser.id);
    const chatStreak = db.getStreak(guildId, targetUser.id, 'chat');
    const voiceStreak = db.getStreak(guildId, targetUser.id, 'voice');

    const chatXpNeeded = db.getXPNeeded(chatData.level);
    const voiceXpNeeded = db.getXPNeeded(voiceData.level);

    const chatStreakText = chatStreak.streak > 0
      ? `${chatStreak.streak} hari 🔥 (${chatStreak.bonusMultiplier}x bonus)`
      : 'Belum ada 🔥';
    const voiceStreakText = voiceStreak.streak > 0
      ? `${voiceStreak.streak} hari 🔥 (${voiceStreak.bonusMultiplier}x bonus)`
      : 'Belum ada 🔥';

    const chatXpLine = `${chatData.xp} / ${chatXpNeeded}`;
    const voiceXpLine = `${voiceData.xp} / ${voiceXpNeeded}`;
    const overallXpLine = `${overallData.xp} / ${overallData.xpNeeded}`;

    const embed = new EmbedBuilder()
      .setTitle(`📊 Level ${targetUser.username}`)
      .setColor(0x0f3460)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: '💬 Chat Level',
          value: `**Level:** ${chatData.level}\n**XP:** ${chatXpLine}\n**Messages:** ${chatData.messages}\n**Streak:** ${chatStreakText}`,
          inline: true,
        },
        {
          name: '🎙️ Voice Level',
          value: `**Level:** ${voiceData.level}\n**XP:** ${voiceXpLine}\n**Voice Minutes:** ${voiceData.minutes}\n**Streak:** ${voiceStreakText}`,
          inline: true,
        },
        {
          name: '🌟 Overall Level',
          value: `**Level:** ${overallData.level}\n**XP:** ${overallXpLine}\n**Total XP:** ${overallData.totalXp}\n**Rank:** #${overallRank.rank || '-'}/${overallRank.total}`,
          inline: false,
        },
        {
          name: '🪙 Level Points',
          value: `**Dompet:** ${pointsData.balance} / ${pointsData.walletCap} Poin${pointsData.isWalletFull ? ' ⚠️ *(PENUH)*' : ''} *(Terpakai: ${pointsData.spentPoints} Poin)*\nTukarkan poin dengan Custom Role di \`/roleshop view\` atau \`!role\``,
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
