const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setshop')
    .setDescription('Atur harga Custom Role, slot Share, Hoist, katalog Role Shop, dan poin user (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    // Subcommand: custom-config
    .addSubcommand((sub) =>
      sub
        .setName('custom-config')
        .setDescription('Atur harga paket Custom Role (7d/14d/28d), Limit Dompet Poin, Kuota Role Server, & Syarat Level')
        .addIntegerOption((opt) =>
          opt
            .setName('price_7d')
            .setDescription('Harga poin Paket 7 Hari (default: 20)')
            .setMinValue(1)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('price_14d')
            .setDescription('Harga poin Paket 14 Hari (default: 40)')
            .setMinValue(1)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('price_28d')
            .setDescription('Harga poin Paket 28 Hari (default: 70)')
            .setMinValue(1)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('wallet_cap')
            .setDescription('Batas maksimal tumpukan poin di dompet user (default: 75)')
            .setMinValue(10)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_server_roles')
            .setDescription('Batas maksimal Custom Role aktif di server (default: 75 dari sisa slot Discord)')
            .setMinValue(1)
            .setMaxValue(200)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('min_overall_level')
            .setDescription('Minimal Overall Level untuk membuat Custom Role baru (default: 10)')
            .setMinValue(0)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('share_slot_price')
            .setDescription('Harga poin untuk membeli +1 slot Share ke teman (default: 10)')
            .setMinValue(1)
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('hoist_price')
            .setDescription('Harga poin untuk unlock fitur Hoist (default: 15)')
            .setMinValue(0)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('enabled')
            .setDescription('Aktifkan/matikan fitur pembuatan Custom Role pribadi')
            .setRequired(false)
        )
        .addRoleOption((opt) =>
          opt
            .setName('position_below')
            .setDescription('Tempatkan semua Custom Role baru tepat di bawah role ini (opsional)')
            .setRequired(false)
        )
    )
    // Subcommand: add-role
    .addSubcommand((sub) =>
      sub
        .setName('add-role')
        .setDescription('Tambahkan atau update role di katalog Role Shop')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role yang ingin dijual di shop').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('price')
            .setDescription('Harga role dalam Level Points')
            .setMinValue(1)
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('Deskripsi singkat role (opsional)')
            .setRequired(false)
        )
    )
    // Subcommand: remove-role
    .addSubcommand((sub) =>
      sub
        .setName('remove-role')
        .setDescription('Hapus role dari katalog Role Shop')
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role yang ingin dihapus dari katalog shop').setRequired(true)
        )
    )
    // Subcommand: give-points
    .addSubcommand((sub) =>
      sub
        .setName('give-points')
        .setDescription('Berikan poin tambahan (bonus) ke user')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Target user').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Jumlah poin yang diberikan').setMinValue(1).setRequired(true)
        )
    )
    // Subcommand: take-points
    .addSubcommand((sub) =>
      sub
        .setName('take-points')
        .setDescription('Kurangi poin dari user')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Target user').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName('amount').setDescription('Jumlah poin yang dikurangi').setMinValue(1).setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.member.permissions?.has(PermissionFlagsBits.ManageRoles) && !db.isRoleTester(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Kamu butuh permission **Manage Roles** untuk mengatur Role Shop.',
        ephemeral: true,
      });
    }

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    // =================== CUSTOM-CONFIG ===================
    if (sub === 'custom-config') {
      const price7d = interaction.options.getInteger('price_7d');
      const price14d = interaction.options.getInteger('price_14d');
      const price28d = interaction.options.getInteger('price_28d');
      const walletCap = interaction.options.getInteger('wallet_cap');
      const maxServerRoles = interaction.options.getInteger('max_server_roles');
      const minOverallLevel = interaction.options.getInteger('min_overall_level');
      const shareSlotPrice = interaction.options.getInteger('share_slot_price');
      const hoistPrice = interaction.options.getInteger('hoist_price');
      const enabled = interaction.options.getBoolean('enabled');
      const anchorRole = interaction.options.getRole('position_below');

      const updates = { editPrice: 0, pricePermanent: 0 };
      if (price7d !== null && price7d !== undefined) updates.price7d = price7d;
      if (price14d !== null && price14d !== undefined) updates.price14d = price14d;
      if (price28d !== null && price28d !== undefined) {
        updates.price28d = price28d;
        updates.price30d = price28d;
      }
      if (walletCap !== null && walletCap !== undefined) updates.walletCap = walletCap;
      if (maxServerRoles !== null && maxServerRoles !== undefined) updates.maxServerRoles = maxServerRoles;
      if (minOverallLevel !== null && minOverallLevel !== undefined) updates.minOverallLevel = minOverallLevel;
      if (shareSlotPrice !== null && shareSlotPrice !== undefined) updates.shareSlotPrice = shareSlotPrice;
      if (hoistPrice !== null && hoistPrice !== undefined) updates.hoistPrice = hoistPrice;
      if (enabled !== null && enabled !== undefined) updates.enabled = enabled;
      if (anchorRole) updates.anchorRoleId = anchorRole.id;

      const updated = db.setCustomRoleConfig(guildId, updates);
      const activeRoles = db.getActiveCustomRoleCount(guildId);
      const anchorObj = updated.anchorRoleId ? interaction.guild.roles.cache.get(updated.anchorRoleId) : null;

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Konfigurasi Custom Role & Poin Disimpan')
        .setColor(0x9b59b6)
        .addFields(
          { name: 'Status', value: updated.enabled ? '✅ Aktif' : '🔒 Nonaktif', inline: true },
          { name: '⏳ Paket 7 Hari', value: `**${updated.price7d} Poin**`, inline: true },
          { name: '🗓️ Paket 14 Hari', value: `**${updated.price14d} Poin**`, inline: true },
          { name: '🌟 Paket 28 Hari', value: `**${updated.price28d} Poin**`, inline: true },
          { name: '🪙 Limit Dompet Poin', value: `**Maks. ${updated.walletCap} Poin**`, inline: true },
          { name: '📦 Kuota Role Server', value: `**${activeRoles} / ${updated.maxServerRoles} Slot**`, inline: true },
          { name: '🔓 Syarat Level Buat Role', value: `**Min. Overall Lv.${updated.minOverallLevel}**`, inline: true },
          { name: '🤝 +1 Slot Share', value: `**${updated.shareSlotPrice} Poin**`, inline: true },
          { name: '📌 Unlock Hoist', value: `**${updated.hoistPrice} Poin**`, inline: true },
          {
            name: '📍 Posisi Role Baru',
            value: anchorObj ? `Di bawah ${anchorObj}` : 'Default (otomatis)',
            inline: true,
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== ADD-ROLE ===================
    if (sub === 'add-role') {
      const role = interaction.options.getRole('role');
      const price = interaction.options.getInteger('price');
      const description = interaction.options.getString('description');

      if (role.managed || role.id === interaction.guild.id) {
        return interaction.reply({
          content: '❌ Role sistem/integrasi atau `@everyone` tidak bisa dimasukkan ke Role Shop.',
          ephemeral: true,
        });
      }

      if (role.position >= interaction.guild.members.me.roles.highest.position) {
        return interaction.reply({
          content: `❌ Posisi role ${role} terlalu tinggi. Pindahkan role bot ke atas role tersebut terlebih dahulu.`,
          ephemeral: true,
        });
      }

      db.upsertShopCatalogRole(guildId, {
        roleId: role.id,
        price,
        description,
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Role Ditambahkan ke Katalog Shop!')
        .setColor(role.color || 0x2ecc71)
        .addFields(
          { name: 'Role', value: `${role}`, inline: true },
          { name: 'Harga', value: `**${price} Poin**`, inline: true },
          { name: 'Deskripsi', value: description || '—', inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // =================== REMOVE-ROLE ===================
    if (sub === 'remove-role') {
      const role = interaction.options.getRole('role');
      const removed = db.removeShopCatalogRole(guildId, role.id);

      if (!removed) {
        return interaction.reply({
          content: `❌ Role ${role} tidak ditemukan di katalog Role Shop.`,
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: `🗑️ Role ${role} berhasil dihapus dari katalog Role Shop.`,
        ephemeral: true,
      });
      return;
    }

    // =================== GIVE-POINTS ===================
    if (sub === 'give-points') {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      const updated = db.adjustBonusPoints(guildId, targetUser.id, amount);

      await interaction.reply({
        content: `✅ Berhasil menambahkan **+${amount} Poin** ke ${targetUser}!\n🪙 Dompet poin ${targetUser.username} sekarang: **${updated.balance} / ${updated.walletCap} Poin**.`,
        ephemeral: true,
      });
      return;
    }

    // =================== TAKE-POINTS ===================
    if (sub === 'take-points') {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      const updated = db.adjustBonusPoints(guildId, targetUser.id, -amount);

      await interaction.reply({
        content: `✅ Berhasil mengurangi **-${amount} Poin** dari ${targetUser}!\n🪙 Dompet poin ${targetUser.username} sekarang: **${updated.balance} / ${updated.walletCap} Poin**.`,
        ephemeral: true,
      });
    }
  },
};
