const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const staffDb = require('../utils/staffDb');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff-division')
    .setDescription('Manage divisi staff directory')
    // Subcommand: create
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Buat divisi baru')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Nama divisi').setRequired(true)
        )
    )
    // Subcommand: delete
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Hapus divisi (staff di divisi ini juga dihapus)')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Nama divisi yang mau dihapus')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // Subcommand: list
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lihat semua divisi')
    )
    // Subcommand: reorder
    .addSubcommand((sub) =>
      sub
        .setName('reorder')
        .setDescription('Atur ulang urutan divisi (pisahkan dengan koma)')
        .addStringOption((opt) =>
          opt
            .setName('order')
            .setDescription('Urutan divisi baru, dipisah koma. Contoh: Owner, Admin, Moderator')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const focusedOption = interaction.options.getFocused(true);

    const divNames = staffDb.getDivisionNames(interaction.guild.id);

    if (subcommand === 'delete') {
      const filtered = divNames
        .filter((d) => d.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 25);
      await interaction.respond(filtered.map((d) => ({ name: d, value: d })));
    } else if (subcommand === 'reorder') {
      // Tampilkan urutan saat ini sebagai saran
      const current = divNames.join(', ');
      await interaction.respond([{ name: current.slice(0, 100), value: current }]);
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // Semua subcommand butuh Manage Guild
    if (!interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Kamu butuh permission **Manage Server** untuk manage divisi.', ephemeral: true });
    }

    // =================== CREATE ===================
    if (subcommand === 'create') {
      const name = interaction.options.getString('name').trim();
      if (name.length > 50) {
        return interaction.reply({ content: '❌ Nama divisi maksimal 50 karakter.', ephemeral: true });
      }

      const result = staffDb.createDivision(guildId, name);
      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Divisi Dibuat')
        .setColor(0x2ecc71)
        .addFields({ name: 'Divisi', value: name, inline: true })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== DELETE ===================
    if (subcommand === 'delete') {
      const name = interaction.options.getString('name');
      const result = staffDb.deleteDivision(guildId, name);

      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Divisi Dihapus')
        .setColor(0xe74c3c)
        .setDescription(`Divisi **${name}** telah dihapus.${result.removedStaff > 0 ? `\nStaff di divisi ini juga dihapus: **${result.removedStaff}** orang.` : ''}`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== LIST ===================
    if (subcommand === 'list') {
      const divNames = staffDb.getDivisionNames(guildId);
      const allStaff = staffDb.getAllStaff(guildId);

      if (divNames.length === 0) {
        return interaction.reply({ content: 'Belum ada divisi. Buat dulu dengan `/staff-division create`.', ephemeral: true });
      }

      const lines = divNames.map((name, i) => {
        const div = allStaff.find((d) => d.division === name);
        const count = div ? div.members.length : 0;
        return `\`${i + 1}.\` **${name}** — ${count} staff`;
      });

      const embed = new EmbedBuilder()
        .setTitle('📋 Daftar Divisi')
        .setColor(0x9b59b6)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${divNames.length} divisi total` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== REORDER ===================
    if (subcommand === 'reorder') {
      const orderStr = interaction.options.getString('order');
      const names = orderStr.split(',').map((s) => s.trim()).filter(Boolean);

      const existingNames = staffDb.getDivisionNames(guildId);

      // Validasi: semua nama di input harus ada di existing
      const missing = names.filter((n) => !existingNames.some((e) => e.toLowerCase() === n.toLowerCase()));
      if (missing.length > 0) {
        return interaction.reply({ content: `❌ Divisi tidak ditemukan: ${missing.join(', ')}`, ephemeral: true });
      }

      // Validasi: tidak boleh ada duplikat
      const lowerNames = names.map((n) => n.toLowerCase());
      if (new Set(lowerNames).size !== lowerNames.length) {
        return interaction.reply({ content: '❌ Ada nama divisi duplikat di input.', ephemeral: true });
      }

      // Validasi: jumlah harus sama
      if (names.length !== existingNames.length) {
        return interaction.reply({ content: `❌ Jumlah divisi harus sama (${existingNames.length}). Divisi saat ini: ${existingNames.join(', ')}`, ephemeral: true });
      }

      // Normalisasi nama (pakai nama existing yang exact case)
      const normalized = names.map((n) => existingNames.find((e) => e.toLowerCase() === n.toLowerCase()));

      staffDb.reorderDivisions(guildId, normalized);

      const embed = new EmbedBuilder()
        .setTitle('✅ Urutan Divisi Diperbarui')
        .setColor(0x2ecc71)
        .setDescription(normalized.map((n, i) => `\`${i + 1}.\` ${n}`).join('\n'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  },
};
