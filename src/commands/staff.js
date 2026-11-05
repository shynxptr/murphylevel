const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const staffDb = require('../utils/staffDb');
const jsonDb = require('../utils/jsonDb');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Manage staff directory')
    // Subcommand: add
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambahkan staff ke divisi')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('User yang mau dijadikan staff').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('division')
            .setDescription('Pilih divisi')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName('title').setDescription('Custom title/label (optional)').setRequired(false)
        )
    )
    // Subcommand: remove
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Hapus staff dari divisi tertentu atau hapus total')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('User yang mau dihapus').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('division')
            .setDescription('Divisi yang mau dihapus dari staff (kosongkan untuk hapus total)')
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    // Subcommand: list
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Tampilkan staff directory embed')
    )
    // Subcommand: info
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Lihat info staff sendiri atau user lain')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Lihat staff info user lain').setRequired(false)
        )
    )
    // Subcommand: refresh
    .addSubcommand((sub) =>
      sub.setName('refresh').setDescription('Refresh directory embed (force update status)')
    )
    // Subcommand: clear (admin only — hapus semua data directory)
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Hapus SEMUA data staff directory di server ini (admin only)')
    ),

  // Autocomplete untuk division option
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name !== 'division') return;

    const divisions = staffDb.getDivisionNames(interaction.guild.id);
    const filtered = divisions
      .filter((d) => d.toLowerCase().includes(focusedOption.value.toLowerCase()))
      .slice(0, 25);

    await interaction.respond(
      filtered.map((d) => ({ name: d, value: d }))
    );
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // =================== ADD ===================
    if (subcommand === 'add') {
      // Admin only
      if (!interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ Kamu butuh permission **Manage Server** untuk menambah staff.', ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const division = interaction.options.getString('division');
      const title = interaction.options.getString('title');

      // Jangan biarin bot jadi staff
      if (user.bot) {
        return interaction.reply({ content: '❌ Bot tidak bisa dijadikan staff.', ephemeral: true });
      }

      const result = staffDb.addStaff(guildId, user.id, division, title);
      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }

      if (result.alreadyInDivision) {
        return interaction.reply({ content: `ℹ️ ${user} sudah terdaftar di divisi **${division}**.`, ephemeral: true });
      }

      // Ambil semua divisi user setelah add
      const staffInfo = staffDb.getStaff(guildId, user.id);
      const allDivs = staffInfo ? staffInfo.divisions.join(', ') : division;

      const embed = new EmbedBuilder()
        .setTitle('✅ Staff Ditambahkan')
        .setColor(0x2ecc71)
        .addFields(
          { name: 'User', value: `${user} (${user.tag})`, inline: true },
          { name: 'Divisi Baru', value: division, inline: true },
          { name: 'Title', value: title || '—', inline: true },
          { name: 'Semua Divisi', value: allDivs, inline: false }
        )
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== REMOVE ===================
    if (subcommand === 'remove') {
      if (!interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ Kamu butuh permission **Manage Server** untuk menghapus staff.', ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const division = interaction.options.getString('division');

      // Kalau division disebut → hapus dari divisi itu saja
      if (division) {
        const result = staffDb.removeStaffFromDivision(guildId, user.id, division);

        if (!result.wasStaff) {
          return interaction.reply({ content: `❌ ${user} bukan staff.`, ephemeral: true });
        }
        if (result.notInDivision) {
          return interaction.reply({ content: `❌ ${user} tidak terdaftar di divisi **${division}**.`, ephemeral: true });
        }

        if (result.remainingDivisions.length === 0) {
          const embed = new EmbedBuilder()
            .setTitle('🗑️ Staff Dihapus')
            .setColor(0xe74c3c)
            .setDescription(`${user} dihapus dari divisi **${result.removedFromDivision}**.\nUser tidak punya divisi lagi → dihapus total dari directory.`)
            .setTimestamp();
          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('🗑️ Dihapus dari Divisi')
          .setColor(0xe74c3c)
          .addFields(
            { name: 'User', value: `${user}`, inline: true },
            { name: 'Dihapus dari', value: result.removedFromDivision, inline: true },
            { name: 'Sisa Divisi', value: result.remainingDivisions.join(', '), inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      // Kalau division tidak disebut → hapus total
      const result = staffDb.removeStaff(guildId, user.id);

      if (!result.wasStaff) {
        return interaction.reply({ content: `❌ ${user} bukan staff.`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Staff Dihapus Total')
        .setColor(0xe74c3c)
        .setDescription(`${user} (${user.tag}) telah dihapus sepenuhnya dari staff directory (semua divisi).`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== INFO ===================
    if (subcommand === 'info') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const staff = staffDb.getStaff(guildId, targetUser.id);

      if (!staff) {
        return interaction.reply({ content: `❌ ${targetUser} bukan staff.`, ephemeral: true });
      }

      const member = interaction.guild.members.cache.get(targetUser.id)
        || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const statusEmoji = getPresenceEmoji(member?.presence?.status);

      // Format divisi dengan title masing-masing
      const divLines = staff.divisions.map((div) => {
        const title = staff.titles[div];
        return `• ${div}${title ? ` — **${title}**` : ''}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`👤 Staff Profile — ${targetUser.username}`)
        .setColor(0x9b59b6)
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Status', value: `${statusEmoji} ${member?.presence?.status || 'offline'}`, inline: true },
          { name: 'Jumlah Divisi', value: `${staff.divisions.length}`, inline: true },
          { name: 'Join Server', value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : '—', inline: true },
          { name: 'Divisi', value: divLines.join('\n'), inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== CLEAR ===================
    if (subcommand === 'clear') {
      if (!interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Hanya **Administrator** yang bisa clear semua data directory.', ephemeral: true });
      }

      // Hapus semua staff & divisi
      const prefix = `staff_${guildId}_`;
      const keysToDelete = [];
      let removed = 0;

      jsonDb.forEachPrefix(prefix, (key, value) => {
        keysToDelete.push(key);
        if (key.endsWith('_divisions') && Array.isArray(value)) removed++;
      });

      for (const k of keysToDelete) {
        jsonDb.delete(k);
      }
      jsonDb.delete(`staff_divisions_${guildId}`);
      staffDb.clearDirectoryMessage(guildId);

      await interaction.reply({ content: `✅ Dihapus **${removed}** staff dan semua divisi. Directory reset.`, ephemeral: true });
      return;
    }

    // =================== REFRESH ===================
    if (subcommand === 'refresh') {
      await interaction.deferReply({ ephemeral: true });
      const dirMsg = staffDb.getDirectoryMessage(guildId);
      if (!dirMsg) {
        return interaction.editReply('❌ Belum ada directory embed yang aktif. Gunakan `/staff list` dulu untuk membuat embed.');
      }

      const channel = interaction.guild.channels.cache.get(dirMsg.channelId);
      if (!channel) {
        staffDb.clearDirectoryMessage(guildId);
        return interaction.editReply('❌ Channel directory tidak ditemukan. Data tracking dihapus. Gunakan `/staff list` untuk buat baru.');
      }

      try {
        const msg = await channel.messages.fetch(dirMsg.messageId);
        const { embed, components } = await buildDirectoryEmbed(interaction.guild);
        await msg.edit({ embeds: [embed], components });
        await interaction.editReply('✅ Directory embed berhasil di-refresh!');
      } catch (err) {
        staffDb.clearDirectoryMessage(guildId);
        await interaction.editReply(`❌ Gagal refresh directory embed: ${err.message}. Tracking dihapus, gunakan \`/staff list\` untuk buat baru.`);
      }
      return;
    }

    // =================== LIST ===================
    if (subcommand === 'list') {
      await interaction.deferReply();

      const { embed, components } = await buildDirectoryEmbed(interaction.guild);

      const sent = await interaction.editReply({ embeds: [embed], components, fetchReply: true });

      // Simpan ID pesan untuk auto-update
      if (sent?.id) {
        staffDb.setDirectoryMessage(guildId, sent.id, interaction.channel.id);
      }

      return;
    }
  },
};

// ============= HELPER: PRESENCE EMOJI =============

// Custom emoji IDs untuk indikator status staff directory
// Format <a:name:id> untuk animated emoji, <:name:id> untuk non-animated
const EMOJI_ONLINE = '<a:open:1559450037631721483>';
const EMOJI_OFFLINE = '<a:off:1566868467376988350>';

/**
 * Ambil emoji indikator status kehadiran.
 * Pakai custom emoji: open (aktif) / off (offline)
 */
function getPresenceEmoji(status) {
  if (status === 'online' || status === 'idle' || status === 'dnd') return EMOJI_ONLINE;
  return EMOJI_OFFLINE; // offline / invisible
}

// ============= HELPER: BUILD DIRECTORY EMBED =============

/**
 * Build embed directory + components (dropdown, button).
 */
async function buildDirectoryEmbed(guild) {
  const guildId = guild.id;
  const allStaff = staffDb.getAllStaff(guildId);
  const divNames = staffDb.getDivisionNames(guildId);
  const totalStaff = staffDb.getStaffCount(guildId);
  const activeDivisions = allStaff.filter((d) => d.members.length > 0).length;

  // Hitung staff aktif berdasarkan user unik (supaya staff yang merangkap divisi tidak dihitung ganda)
  const uniqueStaffIds = new Set();
  for (const div of allStaff) {
    for (const member of div.members) {
      uniqueStaffIds.add(member.userId);
    }
  }

  let activeStaff = 0;
  for (const userId of uniqueStaffIds) {
    const m = guild.members.cache.get(userId);
    if (m?.presence?.status && m.presence.status !== 'offline') {
      activeStaff++;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('. MURPHY DIRECTORY')
    .setColor(0x9b59b6)
    .setDescription('Real-time monitoring of staff availability and server presence.')
    .addFields({
      name: 'METRICS',
      value: [
        `**Staff:** ${activeStaff}/${totalStaff} active`,
        `**Divisions:** ${activeDivisions}/${divNames.length} active`,
      ].join('\n'),
    })
    .setThumbnail(guild.iconURL({ size: 128 }))
    .setTimestamp();

  // Field per divisi (urut)
  for (const div of allStaff) {
    if (div.members.length === 0) {
      embed.addFields({
        name: `${div.division}`,
        value: '```\n — No staff assigned —\n```',
        inline: false,
      });
      continue;
    }

    const lines = [];
    for (const member of div.members) {
      const m = guild.members.cache.get(member.userId);
      const emoji = getPresenceEmoji(m?.presence?.status);
      const displayName = m?.displayName || `<@${member.userId}>`;
      const titleSuffix = member.title ? ` — ${member.title}` : '';
      lines.push(`${emoji}  **${displayName}**${titleSuffix}`);
    }

    embed.addFields({
      name: `${div.division}  (${div.members.length})`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: `MURPHY DIRECTORY • Updated` });

  // Dropdown: Tampilkan Semua Divisi
  const selectOptions = [
    { label: '📋 Semua Divisi', value: 'all', description: 'Tampilkan semua staff' },
    ...divNames.map((d) => ({ label: d, value: `div_${d}` })),
  ];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('staff_directory_select')
    .setPlaceholder('Tampilkan Semua Divisi')
    .addOptions(selectOptions.slice(0, 25));

  const row1 = new ActionRowBuilder().addComponents(selectMenu);

  // Button: My Staff Profile
  const profileButton = new ButtonBuilder()
    .setCustomId('staff_profile_btn')
    .setLabel('My Staff Profile')
    .setStyle(ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(profileButton);

  return { embed, components: [row1, row2] };
}

// Export helper untuk dipakai di index.js (auto-update)
module.exports.buildDirectoryEmbed = buildDirectoryEmbed;
module.exports.getPresenceEmoji = getPresenceEmoji;
