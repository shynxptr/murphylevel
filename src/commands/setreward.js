const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setreward')
    .setDescription('Atur role reward untuk level tertentu (admin only)')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Tipe level untuk reward')
        .setRequired(true)
        .addChoices(
          { name: 'Chat Level', value: 'chat' },
          { name: 'Voice Level', value: 'voice' },
          { name: 'Overall Level (gabungan chat+voice)', value: 'overall' }
        )
    )
    .addIntegerOption((option) =>
      option.setName('level').setDescription('Level yang mau dikasih reward').setRequired(true).setMinValue(1)
    )
    .addRoleOption((option) =>
      option.setName('role').setDescription('Role yang akan diberikan').setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Kamu butuh permission **Manage Roles** untuk pake command ini.', ephemeral: true });
    }

    const type = interaction.options.getString('type');
    const level = interaction.options.getInteger('level');
    const role = interaction.options.getRole('role');
    const guildId = interaction.guild.id;

    // Cek bot punya permission manage roles
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ content: '❌ Role ini terlalu tinggi. Pindahkan role bot di atas role yang mau dikasih.', ephemeral: true });
    }

    db.setReward(guildId, type, level, role.id);

    const typeLabel = type === 'chat' ? '💬 Chat' : type === 'voice' ? '🎙️ Voice' : '🌟 Overall';
    const color = type === 'chat' ? 0x00b4d8 : type === 'voice' ? 0xe94560 : 0x9b59b6;

    const embed = new EmbedBuilder()
      .setTitle('✅ Role Reward Diset!')
      .setColor(color)
      .addFields(
        { name: 'Tipe', value: typeLabel, inline: true },
        { name: 'Level', value: `${level}`, inline: true },
        { name: 'Role', value: `${role}`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
