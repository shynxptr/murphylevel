const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createLevelUpGIF } = require('../utils/levelUpCard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testnotiflevel')
    .setDescription('Test notifikasi level up (hanya admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Tipe level: chat atau voice')
        .setRequired(true)
        .addChoices(
          { name: '💬 Chat', value: 'chat' },
          { name: '🎙️ Voice', value: 'voice' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Level baru yang mau ditest (contoh: 5)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(999)
    )
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('User yang mau ditest (default: diri sendiri)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString('type');
    const newLevel = interaction.options.getInteger('level');
    const targetUser = interaction.options.getUser('target') || interaction.user;
    const member = interaction.guild.members.cache.get(targetUser.id)
      || await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.editReply('User tidak ditemukan di server ini.');
    }

    const username = member.displayName;
    const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
    const oldLevel = newLevel - 1;

    try {
      // Generate GIF level up card
      const gifBuffer = await createLevelUpGIF({
        username,
        avatarURL,
        oldLevel,
        newLevel,
        type,
      });

      // Kirim ke channel yang sama
      await interaction.channel.send({
        content: `🎉 ${targetUser} naik ke **${type === 'chat' ? '💬 Chat' : '🎙️ Voice'} Level ${newLevel}**!`,
        files: [{ attachment: gifBuffer, name: `levelup-${type}.gif` }],
      });

      await interaction.editReply(
        `✅ Notif level up berhasil dikirim!\n> **User:** ${username}\n> **Type:** ${type === 'chat' ? '💬 Chat' : '🎙️ Voice'}\n> **Level:** ${oldLevel} → ${newLevel}`
      );
    } catch (err) {
      console.error('Gagal generate test level up GIF:', err);

      // Fallback: text only
      await interaction.channel.send(
        `🎉 ${targetUser} naik ke **${type === 'chat' ? '💬 Chat' : '🎙️ Voice'} Level ${newLevel}**! Selamat! (test)`
      );

      await interaction.editReply(
        `⚠️ GIF gagal di-generate (${err.message}), tapi notif teks sudah dikirim.`
      );
    }
  },
};
