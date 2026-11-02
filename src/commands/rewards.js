const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rewards')
    .setDescription('Lihat semua role reward yang sudah diset di server')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Filter berdasarkan tipe (kosongkan untuk lihat semua)')
        .setRequired(false)
        .addChoices(
          { name: 'Chat Level', value: 'chat' },
          { name: 'Voice Level', value: 'voice' },
          { name: 'Overall Level', value: 'overall' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const typeFilter = interaction.options.getString('type');
    const guildId = interaction.guild.id;

    let chatRewards = [];
    let voiceRewards = [];
    let overallRewards = [];

    if (!typeFilter || typeFilter === 'chat') {
      chatRewards = db.getAllRewards(guildId, 'chat');
    }
    if (!typeFilter || typeFilter === 'voice') {
      voiceRewards = db.getAllRewards(guildId, 'voice');
    }
    if (!typeFilter || typeFilter === 'overall') {
      overallRewards = db.getAllRewards(guildId, 'overall');
    }

    if (chatRewards.length === 0 && voiceRewards.length === 0 && overallRewards.length === 0) {
      return interaction.editReply('Belum ada role reward yang diset di server ini. Pake `/setreward` untuk menambahkan.');
    }

    const embed = new EmbedBuilder()
      .setTitle('🎁 Role Rewards')
      .setColor(0x0f3460)
      .setTimestamp();

    if (chatRewards.length > 0) {
      let chatList = '';
      for (const r of chatRewards) {
        const role = interaction.guild.roles.cache.get(r.roleId);
        chatList += `Level **${r.level}** → ${role ? role : 'Role tidak ditemukan'}\n`;
      }
      embed.addFields({ name: '💬 Chat Level Rewards', value: chatList });
    }

    if (voiceRewards.length > 0) {
      let voiceList = '';
      for (const r of voiceRewards) {
        const role = interaction.guild.roles.cache.get(r.roleId);
        voiceList += `Level **${r.level}** → ${role ? role : 'Role tidak ditemukan'}\n`;
      }
      embed.addFields({ name: '🎙️ Voice Level Rewards', value: voiceList });
    }

    if (overallRewards.length > 0) {
      let overallList = '';
      for (const r of overallRewards) {
        const role = interaction.guild.roles.cache.get(r.roleId);
        overallList += `Level **${r.level}** → ${role ? role : 'Role tidak ditemukan'}\n`;
      }
      embed.addFields({ name: '🌟 Overall Level Rewards', value: overallList });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
