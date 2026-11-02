const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setmultiplier')
    .setDescription('Atur XP multiplier event (double/triple XP) — hanya admin')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set multiplier event')
        .addIntegerOption((opt) =>
          opt
            .setName('multiplier')
            .setDescription('Multiplier: 2 = double XP, 3 = triple, 1 = normal')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Nama event, misal "Double XP Weekend"')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('duration')
            .setDescription('Durasi dalam jam (kosongkan untuk permanent)')
            .setMinValue(1)
            .setMaxValue(720)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Cek multiplier yang sedang aktif')
    )
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Matikan multiplier event (reset ke normal)')
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const multiplier = interaction.options.getInteger('multiplier');
      const reason = interaction.options.getString('reason') || `Event ${multiplier}x XP`;
      const durationHours = interaction.options.getInteger('duration');

      let expiresAt = null;
      let durationText = 'permanent';
      if (durationHours) {
        expiresAt = Date.now() + durationHours * 60 * 60 * 1000;
        durationText = `${durationHours} jam`;
      }

      db.setMultiplier(guildId, multiplier, reason, expiresAt);

      const expiryText = expiresAt
        ? `\n⏰ Berakhir: <t:${Math.floor(expiresAt / 1000)}:R>`
        : '\n⏰ Status: **Permanent** (matikan manual dengan `/setmultiplier off`)';

      await interaction.reply({
        content: `⚡ **XP Multiplier Event Aktif!**\n\n📊 Multiplier: **${multiplier}x XP**\n📝 Event: **${reason}**\n⏱️ Durasi: ${durationText}${expiryText}`,
        ephemeral: true,
      });
    }

    else if (sub === 'status') {
      const { multiplier, reason, expiresAt } = db.getMultiplier(guildId);

      if (multiplier === 1) {
        return interaction.reply({
          content: '📊 **XP Multiplier Status**\n\nSaat ini: **Normal (1x XP)**\nTidak ada event aktif.',
          ephemeral: true,
        });
      }

      const expiryText = expiresAt
        ? `\n⏰ Berakhir: <t:${Math.floor(expiresAt / 1000)}:R>`
        : '\n⏰ Status: **Permanent**';

      await interaction.reply({
        content: `📊 **XP Multiplier Status**\n\n⚡ Multiplier: **${multiplier}x XP**\n📝 Event: **${reason}**${expiryText}`,
        ephemeral: true,
      });
    }

    else if (sub === 'off') {
      const { multiplier } = db.getMultiplier(guildId);

      if (multiplier === 1) {
        return interaction.reply({
          content: 'ℹ️ Tidak ada multiplier event yang aktif saat ini.',
          ephemeral: true,
        });
      }

      db.clearMultiplier(guildId);
      await interaction.reply({
        content: '✅ XP multiplier event telah **dimatikan**. XP kembali normal (1x).',
        ephemeral: true,
      });
    }
  },
};
