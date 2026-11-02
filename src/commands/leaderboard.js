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
          { name: 'Voice Level', value: 'voice' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const type = interaction.options.getString('type');
    const guildId = interaction.guild.id;
    const leaderboard = db.getLeaderboard(guildId, type, 10);

    if (leaderboard.length === 0) {
      return interaction.editReply('Belum ada data leaderboard untuk server ini. Mulai chat/voice dulu!');
    }

    const typeLabel = type === 'chat' ? '💬 Chat' : '🎙️ Voice';
    const medalEmojis = ['🥇', '🥈', '🥉'];

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard ${typeLabel} Level`)
      .setColor(type === 'chat' ? 0x00b4d8 : 0xe94560)
      .setThumbnail(interaction.guild.iconURL())
      .setTimestamp();

    let description = '';

    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
      const username = user ? user.username : 'Unknown User';
      const medal = i < 3 ? medalEmojis[i] : `**${i + 1}.**`;

      description += `${medal} **${username}** — Level ${entry.level} • ${entry.xp.toLocaleString()} XP\n`;
    }

    embed.setDescription(description);

    await interaction.editReply({ embeds: [embed] });
  },
};
