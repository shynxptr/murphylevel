const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top 10 user dengan level tertinggi')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Pilih tipe leaderboard')
        .setRequired(true)
        .addChoices(
          { name: 'Chat Level', value: 'chat' },
          { name: 'Voice Level', value: 'voice' },
          { name: 'Overall Level (gabungan)', value: 'overall' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const type = interaction.options.getString('type');
    const guildId = interaction.guild.id;

    const leaderboard = type === 'overall'
      ? db.getOverallLeaderboard(guildId, 10)
      : db.getLeaderboard(guildId, type, 10);

    if (leaderboard.length === 0) {
      return interaction.editReply('Belum ada data leaderboard untuk server ini. Mulai chat/voice dulu!');
    }

    const typeLabel = type === 'chat' ? '💬 Chat' : type === 'voice' ? '🎙️ Voice' : '🌟 Overall';
    const color = type === 'chat' ? 0x00b4d8 : type === 'voice' ? 0xe94560 : 0x9b59b6;
    const medalEmojis = ['🥇', '🥈', '🥉'];

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard ${typeLabel} Level`)
      .setColor(color)
      .setThumbnail(interaction.guild.iconURL())
      .setTimestamp();

    // Fetch semua user secara paralel (cek cache terlebih dahulu)
    const users = await Promise.all(
      leaderboard.map((entry) =>
        interaction.client.users.cache.get(entry.userId)
        || interaction.client.users.fetch(entry.userId).catch(() => null)
      )
    );

    let description = '';
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const user = users[i];
      const username = user ? user.username : 'Unknown User';
      const medal = i < 3 ? medalEmojis[i] : `**${i + 1}.**`;

      description += `${medal} **${username}** — Level ${entry.level} • ${entry.xp.toLocaleString()} XP\n`;
    }

    embed.setDescription(description);

    await interaction.editReply({ embeds: [embed] });
  },
};
