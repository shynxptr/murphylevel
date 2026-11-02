const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlevelchannel')
    .setDescription('Set channel untuk announce level up (hanya admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel tujuan announce level up (kosongkan untuk reset)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const channel = interaction.options.getChannel('channel');

    if (!channel) {
      // Reset / disable
      db.setLevelChannel(guildId, null);
      return interaction.reply({
        content: '🔕 Channel announce level up telah **direset**. Notif akan dikirim ke channel asal pesan.',
        ephemeral: true,
      });
    }

    // Cek permission bot bisa kirim pesan
    const botPerms = channel.permissionsFor(interaction.guild.members.me);
    if (!botPerms?.has('SendMessages') || !botPerms?.has('AttachFiles')) {
      return interaction.reply({
        content: `❌ Bot tidak punya izin **Send Messages** atau **Attach Files** di ${channel}.`,
        ephemeral: true,
      });
    }

    db.setLevelChannel(guildId, channel.id);

    await interaction.reply({
      content: `✅ Channel announce level up berhasil di-set ke ${channel}!\nSemua notifikasi level up akan dikirim ke sana.`,
      ephemeral: true,
    });
  },
};
