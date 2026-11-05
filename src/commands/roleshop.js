const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../utils/database');
const {
  normalizeHexColor,
  buildRoleUpdatedEmbed,
  buildCustomRoleInfoPayload,
  applyRoleColors,
  ensureActiveCustomRole,
} = require('../utils/customRoleComponents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roleshop')
    .setDescription('Toko Role & Panel Custom Role menggunakan Level Points (+1 poin tiap naik level)')
    // Subcommand: role (Panel Custom Role Information persis Gambar 1 & 3)
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('Buka panel interaktif Custom Role Information (View & Edit Mode)')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Lihat Custom Role milik member lain').setRequired(false)
        )
    )
    // Subcommand: view
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('Lihat katalog Role Shop, harga Custom Role, dan saldo poin kamu')
    )
    // Subcommand: points
    .addSubcommand((sub) =>
      sub
        .setName('points')
        .setDescription('Lihat detail saldo Level Points kamu atau user lain')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('User yang ingin dilihat poinnya').setRequired(false)
        )
    )
    // Subcommand: buy-custom
    .addSubcommand((sub) =>
      sub
        .setName('buy-custom')
        .setDescription('Beli & buat Custom Role pribadi dengan paket durasi pilihanmu')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Nama Custom Role yang diinginkan (maks 50 karakter)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Warna role dalam format Hex (contoh: #CECECE atau #FFFFF0 #AA8668)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('duration')
            .setDescription('Pilih paket durasi Custom Role (default: 28 Hari)')
            .setRequired(false)
            .addChoices(
              { name: '⏳ Paket 7 Hari (20 Poin)', value: '7d' },
              { name: '🗓️ Paket 14 Hari (40 Poin)', value: '14d' },
              { name: '🌟 Paket 28 Hari (70 Poin — Hemat 10 Poin!)', value: '28d' }
            )
        )
    )
    // Subcommand: extend
    .addSubcommand((sub) =>
      sub
        .setName('extend')
        .setDescription('Perpanjang masa aktif Custom Role kamu menggunakan Level Points (Maks tumpuk 60 Hari)')
        .addStringOption((opt) =>
          opt
            .setName('duration')
            .setDescription('Pilih paket perpanjangan durasi')
            .setRequired(true)
            .addChoices(
              { name: '⏳ Tambah +7 Hari (20 Poin)', value: '7d' },
              { name: '🗓️ Tambah +14 Hari (40 Poin)', value: '14d' },
              { name: '🌟 Tambah +28 Hari (70 Poin — Hemat 10 Poin!)', value: '28d' }
            )
        )
    )
    // Subcommand: buy-slot
    .addSubcommand((sub) =>
      sub
        .setName('buy-slot')
        .setDescription('Beli +1 slot Share untuk membagikan Custom Role kamu ke teman')
    )
    // Subcommand: buy-role
    .addSubcommand((sub) =>
      sub
        .setName('buy-role')
        .setDescription('Beli role spesial dari katalog Role Shop server')
        .addStringOption((opt) =>
          opt
            .setName('role')
            .setDescription('Pilih role dari katalog shop')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // Subcommand: help
    .addSubcommand((sub) =>
      sub
        .setName('help')
        .setDescription('Buka panduan lengkap Role Shop, Level Points, & Custom Role')
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'role') return;

    const catalog = db.getShopCatalog(interaction.guild.id);
    const query = focused.value.toLowerCase();

    const choices = [];
    for (const item of catalog) {
      const role = interaction.guild.roles.cache.get(item.roleId);
      if (!role) continue;
      const label = `${role.name} — ${item.price} Poin`;
      if (role.name.toLowerCase().includes(query) || label.toLowerCase().includes(query)) {
        choices.push({ name: label.slice(0, 100), value: item.roleId });
      }
      if (choices.length >= 25) break;
    }

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const guild = interaction.guild;
    const guildId = guild.id;
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand() || 'role';

    // =================== HELP ===================
    if (sub === 'help') {
      const embed = buildShopHelpEmbed(guild, userId);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    // =================== ROLE (INTERACTIVE PANEL) ===================
    if (sub === 'role') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const payload = buildCustomRoleInfoPayload(guild, targetUser.id, 'view');
      await interaction.reply(payload);
      return;
    }

    // =================== VIEW ===================
    if (sub === 'view') {
      await interaction.deferReply();

      const points = db.getPointsData(guildId, userId);
      const customCfg = db.getCustomRoleConfig(guildId);
      const userCustom = ensureActiveCustomRole(guild, userId);
      const activeRoles = db.getActiveCustomRoleCount(guildId);
      const catalog = db.getShopCatalog(guildId);
      const member = guild.members.cache.get(userId)
        || await guild.members.fetch(userId).catch(() => null);

      const existingCustomRole = userCustom ? guild.roles.cache.get(userCustom.roleId) : null;
      const isTester = db.isRoleTester(userId);
      const isServerSlotFull = activeRoles >= customCfg.maxServerRoles && !isTester;
      const meetsLevelReq = points.overallLevel >= customCfg.minOverallLevel || isTester;

      const embed = new EmbedBuilder()
        .setTitle('🏪 Murphy Role Shop')
        .setColor(0x9b59b6)
        .setDescription(
          [
            `🪙 **Dompet Poin Kamu:** **${points.balance} / ${points.walletCap} Poin**${points.isWalletFull ? ' ⚠️ *(DOMPET PENUH — Belanjakan poinmu agar tidak terbuang!)*' : ''} *(Terpakai: ${points.spentPoints} Poin)*`,
            `📦 **Kuota Custom Role Server:** **${activeRoles} / ${customCfg.maxServerRoles} Slot Terpakai** • 🔓 **Syarat Buat Role:** **Min. Overall Lv.${customCfg.minOverallLevel}** *(Levelmu: Lv.${points.overallLevel})*`,
            `💡 *Dapatkan Poin dari **+1 Poin/Lv Chat & Voice**, **+2 Poin/Milestone**, & **+1 Poin tiap 1.500 Total XP**!*`,
          ].join('\n')
        )
        .setThumbnail(guild.iconURL({ size: 128 }))
        .setTimestamp();

      // Section 1: Custom Role Pribadi
      if (customCfg.enabled) {
        const expText = userCustom
          ? (userCustom.expiresAt
            ? `• Berakhir <t:${Math.floor(userCustom.expiresAt / 1000)}:R>`
            : `• **Permanen ♾️**`)
          : '';
        const statusLine = existingCustomRole
          ? `✅ **Role Kamu:** ${existingCustomRole} (\`${userCustom.color}\`) ${expText} • Shared: **${(userCustom.sharedWith || []).length}/${userCustom.maxShares || 0}**\nBuka panel edit dengan \`/roleshop role\` atau ketik \`!role\`, \`!color\`, \`!icon\`, \`!share\`, \`!extend\`.`
          : `Belum punya. Klik tombol paket di bawah atau gunakan \`/roleshop buy-custom\`.`;

        embed.addFields({
          name: `🎨 Custom Role Pribadi (Berbasis Waktu / Paket)`,
          value: [
            `Buat role eksklusif lengkap dengan **Panel Interaktif**, **2-Color Gradient**, **Role Icon**, & **Share ke Teman**!`,
            `• **7 Hari:** ${customCfg.price7d} Poin | **14 Hari:** ${customCfg.price14d} Poin | **28 Hari:** ${customCfg.price28d} Poin *(Hemat 10 Poin!)*`,
            `• **Edit Nama/Warna/Icon:** Gratis | **Slot Share:** ${customCfg.shareSlotPrice} Poin/slot | **Hoist:** ${customCfg.hoistPrice} Poin`,
            `• ${statusLine}`,
          ].join('\n'),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '🎨 Custom Role Pribadi',
          value: '🔒 *Fitur pembuatan Custom Role sedang dinonaktifkan oleh admin.*',
          inline: false,
        });
      }

      // Section 2: Katalog Role Shop
      if (catalog.length === 0) {
        embed.addFields({
          name: '🛒 Katalog Role Shop',
          value: '*Belum ada role di katalog shop. Admin bisa menambahkan lewat `/setshop add-role`.*',
          inline: false,
        });
      } else {
        const lines = [];
        for (let i = 0; i < catalog.length; i++) {
          const item = catalog[i];
          const role = guild.roles.cache.get(item.roleId);
          if (!role) continue;
          const owned = member?.roles?.cache?.has(role.id);
          const desc = item.description ? ` — *${item.description}*` : '';
          lines.push(
            `\`${i + 1}.\` ${role} • **${item.price} Poin**${owned ? ' ✅ *(Sudah dimiliki)*' : ''}${desc}`
          );
        }

        embed.addFields({
          name: `🛒 Katalog Role Shop (${lines.length})`,
          value: lines.length > 0
            ? `${lines.join('\n')}\n\n👉 Beli dengan \`/roleshop buy-role\``
            : '*Semua role di katalog sudah tidak ditemukan di server.*',
          inline: false,
        });
      }

      embed.setFooter({ text: `Dompet: ${points.balance}/${points.walletCap} Poin • Overall Lv.${points.overallLevel} (Chat Lv.${points.chatLevel} + Voice Lv.${points.voiceLevel})` });

      const row = new ActionRowBuilder();
      if (existingCustomRole) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`cr_mode_edit_${userId}`)
            .setLabel('Edit Custom Role Saya')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary)
        );
        if (userCustom.expiresAt) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`cr_btn_extend_${userId}`)
              .setLabel('Extend Durasi')
              .setEmoji('⏳')
              .setStyle(ButtonStyle.Secondary)
          );
        }
      } else {
        const canCreate = customCfg.enabled && !isServerSlotFull && meetsLevelReq;
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`cr_btn_create_7d_${userId}`)
            .setLabel(`7 Hari (${customCfg.price7d}P)`)
            .setEmoji('⏳')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!canCreate),
          new ButtonBuilder()
            .setCustomId(`cr_btn_create_14d_${userId}`)
            .setLabel(`14 Hari (${customCfg.price14d}P)`)
            .setEmoji('🗓️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!canCreate),
          new ButtonBuilder()
            .setCustomId(`cr_btn_create_28d_${userId}`)
            .setLabel(`28 Hari (${customCfg.price28d}P)`)
            .setEmoji('🌟')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!canCreate)
        );
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`cr_btn_help_${userId}`)
          .setLabel('Help')
          .setEmoji('❓')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    // =================== POINTS ===================
    if (sub === 'points') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const points = db.getPointsData(guildId, targetUser.id);
      const userCustom = ensureActiveCustomRole(guild, targetUser.id);
      const customRoleObj = userCustom ? guild.roles.cache.get(userCustom.roleId) : null;

      const bonusLine = points.bonusPoints !== 0
        ? `\n**Bonus/Adjustment Admin:** ${points.bonusPoints > 0 ? `+${points.bonusPoints}` : points.bonusPoints} Poin`
        : '';

      const expInfo = userCustom
        ? (userCustom.expiresAt
          ? ` • Expires <t:${Math.floor(userCustom.expiresAt / 1000)}:R>`
          : ' • **Permanent ♾️**')
        : '';

      const embed = new EmbedBuilder()
        .setTitle(`🪙 Level Points — ${targetUser.username}`)
        .setColor(0xf1c40f)
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: '💰 Dompet Poin Aktif',
            value: `**${points.balance} / ${points.walletCap} Poin**${points.isWalletFull ? '\n⚠️ *(PENUH — Belanjakan poinmu!)*' : ''}`,
            inline: true,
          },
          {
            name: '🌟 Overall Level',
            value: `**Lv.${points.overallLevel}**`,
            inline: true,
          },
          {
            name: '🛍️ Total Poin Terpakai',
            value: `**${points.spentPoints} Poin**`,
            inline: true,
          },
          {
            name: '📊 Sumber Poin Grinding (Proporsional XP & Level)',
            value: [
              `💬 **Chat Level (${points.chatLevel}):** +${points.chatTierPoints} Poin *(+1 Poin / level)*`,
              `🎙️ **Voice Level (${points.voiceLevel}):** +${points.voiceTierPoints} Poin *(+1 Poin / level)*`,
              `🏆 **Bonus Milestone Level:** +${points.milestonePoints} Poin *(+2 Poin tiap milestone)*`,
              `⚡ **Grinding XP (tiap 1.500 Total XP):** +${points.xpActivityPoints} Poin${bonusLine}`,
            ].join('\n'),
            inline: false,
          },
          {
            name: '🎨 Custom Role Pribadi',
            value: customRoleObj
              ? `${customRoleObj} (\`${userCustom.color}\`) • Shared: ${(userCustom.sharedWith || []).length}/${userCustom.maxShares || 0}${expInfo}`
              : 'Belum punya',
            inline: false,
          }
        )
        .setFooter({ text: 'Ketik !role atau /roleshop role untuk membuka panel Custom Role!' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // =================== BUY-CUSTOM ===================
    if (sub === 'buy-custom') {
      await interaction.deferReply();

      const customCfg = db.getCustomRoleConfig(guildId);
      if (!customCfg.enabled) {
        return interaction.editReply('❌ Pembuatan Custom Role sedang dinonaktifkan oleh admin server ini.');
      }

      const rawName = interaction.options.getString('name').trim();
      const rawColorTokens = interaction.options.getString('color').trim().split(/\s+/);
      const durationOpt = interaction.options.getString('duration') || '28d';
      const plan = db.getCustomRolePlanInfo(guildId, durationOpt);

      if (!plan.enabled) {
        return interaction.editReply('❌ Paket durasi tersebut sedang dinonaktifkan oleh admin server ini.');
      }

      const primaryHex = normalizeHexColor(rawColorTokens[0]);
      const sideHex = rawColorTokens[1] ? normalizeHexColor(rawColorTokens[1]) : null;

      if (rawName.length < 1 || rawName.length > 50 || /^@(everyone|here)$/i.test(rawName)) {
        return interaction.editReply('❌ Nama role harus antara **1 sampai 50 karakter** dan bukan `@everyone`/`@here`.');
      }
      if (!primaryHex || (rawColorTokens[1] && !sideHex)) {
        return interaction.editReply('❌ Format warna Hex tidak valid! Gunakan contoh: `#CECECE` atau `#FFFFF0 #AA8668`.');
      }

      const savedCustom = ensureActiveCustomRole(guild, userId);
      if (savedCustom && guild.roles.cache.get(savedCustom.roleId)) {
        const payload = buildCustomRoleInfoPayload(guild, userId, 'view');
        return interaction.editReply({
          content: 'ℹ️ Kamu sudah memiliki Custom Role aktif! Klik tombol **✏️** atau **⏳ Extend Durasi** di bawah:',
          ...payload,
        });
      }

      const points = db.getPointsData(guildId, userId);
      const isTester = db.isRoleTester(userId);
      if (points.overallLevel < customCfg.minOverallLevel && !isTester) {
        return interaction.editReply(
          `🔒 Kamu membutuhkan minimal **Overall Level ${customCfg.minOverallLevel}** untuk membuat Custom Role sendiri (Level kamu saat ini: **Lv.${points.overallLevel}**).\n💡 *Tips: Kamu tetap bisa menerima Custom Role dari teman yang membagikan rolenya lewat fitur \`!share\`!*`
        );
      }

      const activeRoles = db.getActiveCustomRoleCount(guildId);
      if (activeRoles >= customCfg.maxServerRoles && !isTester) {
        return interaction.editReply(
          `⚠️ Kuota Custom Role di server saat ini sedang penuh (**${activeRoles} / ${customCfg.maxServerRoles} Role Aktif**) demi menjaga batas aman slot role Discord.\n💡 Silakan tunggu hingga ada Custom Role member lain yang habis masa aktifnya, atau minta temanmu membagikan rolenya menggunakan \`!share\`!`
        );
      }

      if (points.balance < plan.price && !isTester) {
        return interaction.editReply(
          `❌ Poin kamu belum cukup untuk paket **${plan.label}**! Harga: **${plan.price} Poin**, saldo dompetmu: **${points.balance} / ${points.walletCap} Poin** *(kurang ${plan.price - points.balance} Poin)*.`
        );
      }

      const botMember = guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply('❌ Bot tidak memiliki permission **Manage Roles** di server ini. Hubungi admin.');
      }

      const member = guild.members.cache.get(userId)
        || await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return interaction.editReply('❌ Data member tidak ditemukan di server ini.');
      }

      try {
        const maxSafePos = Math.max(1, botMember.roles.highest.position - 1);
        let targetPosition = undefined;
        if (customCfg.anchorRoleId) {
          const anchorRole = guild.roles.cache.get(customCfg.anchorRoleId);
          if (anchorRole) {
            targetPosition = Math.min(anchorRole.position, maxSafePos);
          }
        }

        const createdRole = await guild.roles.create({
          name: rawName,
          color: primaryHex,
          permissions: [],
          position: targetPosition,
          reason: `Custom Role (${plan.label}) dibeli oleh ${interaction.user.tag} (${plan.price} Poin)`,
        });

        if (sideHex) {
          await applyRoleColors(guild, createdRole, primaryHex, sideHex);
        }

        await member.roles.add(createdRole);

        const now = Date.now();
        const expiresAt = plan.durationMs ? now + plan.durationMs : null;

        db.spendPoints(guildId, userId, plan.price);
        db.setUserCustomRole(guildId, userId, {
          roleId: createdRole.id,
          ownerId: userId,
          name: rawName,
          color: primaryHex,
          sideColor: sideHex,
          description: "This custom role's duration follows your active Level Points plan.",
          iconURL: null,
          bannerURL: null,
          hoisted: false,
          hoistUnlocked: false,
          maxShares: 0,
          sharedWith: [],
          durationPlan: plan.key,
          expiresAt,
          history: [{ action: `Created role (${plan.label} • ${primaryHex})`, timestamp: now }],
          createdAt: now,
        });

        const payload = buildCustomRoleInfoPayload(guild, userId, 'view');
        await interaction.editReply(payload);
      } catch (err) {
        console.error('Gagal membuat custom role:', err);
        await interaction.editReply(`❌ Gagal membuat Custom Role: ${err.message}`);
      }
      return;
    }

    // =================== EXTEND ===================
    if (sub === 'extend') {
      await interaction.deferReply();

      const customCfg = db.getCustomRoleConfig(guildId);
      const customData = ensureActiveCustomRole(guild, userId);
      const role = customData ? guild.roles.cache.get(customData.roleId) : null;
      if (!customData || !role) {
        return interaction.editReply('❌ Kamu belum memiliki Custom Role aktif. Buat dulu dengan `/roleshop buy-custom` atau `!role`!');
      }

      if (!customData.expiresAt) {
        return interaction.editReply(`♾️ Custom Role ${role} milikmu sudah berstatus **Permanen**!`);
      }

      const durationKey = interaction.options.getString('duration');
      const plan = db.getCustomRolePlanInfo(guildId, durationKey);
      if (!plan.enabled) {
        return interaction.editReply('❌ Paket durasi tersebut sedang tidak tersedia.');
      }

      if (plan.durationMs && !db.isRoleTester(userId)) {
        const now = Date.now();
        const baseTime = customData.expiresAt > now ? customData.expiresAt : now;
        const projectedRemainingDays = Math.ceil((baseTime + plan.durationMs - now) / (24 * 60 * 60 * 1000));
        if (projectedRemainingDays > customCfg.maxDurationDays) {
          return interaction.editReply(
            `⚠️ Durasi Custom Role tidak bisa ditumpuk melebihi **${customCfg.maxDurationDays} Hari**! (Jika ditambah **+${plan.label}**, total sisa durasimu akan menjadi **${projectedRemainingDays} Hari**).`
          );
        }
      }

      const points = db.getPointsData(guildId, userId);
      if (points.balance < plan.price && !db.isRoleTester(userId)) {
        return interaction.editReply(
          `❌ Poin kamu belum cukup untuk paket **${plan.label}**! Harga: **${plan.price} Poin**, saldo dompetmu: **${points.balance} / ${points.walletCap} Poin** *(kurang ${plan.price - points.balance} Poin)*.`
        );
      }

      const spendRes = db.spendPoints(guildId, userId, plan.price);
      const updatedData = db.extendUserCustomRole(guildId, userId, plan.key);
      db.appendCustomRoleHistory(
        guildId,
        userId,
        plan.key === 'perm'
          ? `Upgraded duration to Permanent (-${plan.price} Poin)`
          : `Extended duration by +${plan.label} (-${plan.price} Poin)`
      );

      const expMsg = updatedData.expiresAt
        ? `Berlaku hingga <t:${Math.floor(updatedData.expiresAt / 1000)}:R> (<t:${Math.floor(updatedData.expiresAt / 1000)}:d>)`
        : '**Permanent ♾️**';

      const embed = buildRoleUpdatedEmbed(
        `${role} : **Successfully** extended role duration (**+${plan.label}**)!\n⏳ Status: ${expMsg} • Sisa Dompet: **${spendRes.balance} / ${points.walletCap} Poin**`
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // =================== BUY-SLOT ===================
    if (sub === 'buy-slot') {
      await interaction.deferReply();

      const customData = db.getUserCustomRole(guildId, userId);
      const role = customData ? guild.roles.cache.get(customData.roleId) : null;
      if (!customData || !role) {
        return interaction.editReply('❌ Kamu belum memiliki Custom Role. Buat dulu dengan `/roleshop buy-custom`!');
      }

      const customCfg = db.getCustomRoleConfig(guildId);
      const currentMax = customData.maxShares || 0;
      if (currentMax >= customCfg.maxShareSlots) {
        return interaction.editReply(`ℹ️ Kamu sudah mencapai batas maksimal slot Share (**${customCfg.maxShareSlots} slot**).`);
      }

      const points = db.getPointsData(guildId, userId);
      if (points.balance < customCfg.shareSlotPrice && !db.isRoleTester(userId)) {
        return interaction.editReply(
          `❌ Poin kamu belum cukup! Harga +1 Slot Share: **${customCfg.shareSlotPrice} Poin**, saldo kamu: **${points.balance} Poin** *(kurang ${customCfg.shareSlotPrice - points.balance} Poin)*.`
        );
      }

      const spendRes = db.spendPoints(guildId, userId, customCfg.shareSlotPrice);
      const newMax = currentMax + 1;
      db.setUserCustomRole(guildId, userId, {
        ...customData,
        maxShares: newMax,
      });
      db.appendCustomRoleHistory(guildId, userId, `Bought +1 Share Slot (${newMax} total)`);

      const embed = buildRoleUpdatedEmbed(
        `${role} : **Successfully** unlocked **+1 Share Slot**! (Shared: **${(customData.sharedWith || []).length} / ${newMax}** • Sisa Poin: **${spendRes.balance} Poin**)`
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // =================== BUY-ROLE (KATALOG SHOP) ===================
    if (sub === 'buy-role') {
      await interaction.deferReply();

      const rawRoleInput = interaction.options.getString('role').trim();
      const mentionMatch = rawRoleInput.match(/^<@&(\d+)>$/);
      const searchId = mentionMatch ? mentionMatch[1] : rawRoleInput;

      const catalog = db.getShopCatalog(guildId);
      const shopItem = catalog.find((item) => {
        if (item.roleId === searchId) return true;
        const r = guild.roles.cache.get(item.roleId);
        return r && r.name.toLowerCase() === rawRoleInput.toLowerCase();
      });

      if (!shopItem) {
        return interaction.editReply(
          '❌ Role tersebut tidak ditemukan di katalog Role Shop. Cek daftar role yang tersedia dengan `/roleshop view`.'
        );
      }

      const role = guild.roles.cache.get(shopItem.roleId);
      if (!role) {
        return interaction.editReply('❌ Role tersebut sudah tidak ada di server ini.');
      }

      const member = guild.members.cache.get(userId)
        || await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return interaction.editReply('❌ Data member tidak ditemukan.');
      }

      if (member.roles.cache.has(role.id)) {
        return interaction.editReply(`ℹ️ Kamu sudah memiliki role ${role}!`);
      }

      const points = db.getPointsData(guildId, userId);
      if (points.balance < shopItem.price) {
        return interaction.editReply(
          `❌ Poin kamu belum cukup untuk membeli ${role}! Harga: **${shopItem.price} Poin**, saldo kamu: **${points.balance} Poin** *(kurang ${shopItem.price - points.balance} Poin)*.`
        );
      }

      const botMember = guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= botMember.roles.highest.position) {
        return interaction.editReply(
          `❌ Bot tidak bisa memberikan role ${role} karena posisi role tersebut lebih tinggi atau sama dengan role tertinggi bot.`
        );
      }

      try {
        await member.roles.add(role, `Dibeli dari Role Shop (${shopItem.price} Poin)`);
        const spendRes = db.spendPoints(guildId, userId, shopItem.price);

        const embed = buildRoleUpdatedEmbed(
          `Role ${role} added to ${interaction.user} (Sisa Saldo: **${spendRes.balance} Poin**)`
        );
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Gagal membeli role katalog:', err);
        await interaction.editReply(`❌ Gagal memberikan role: ${err.message}`);
      }
    }
  },
};
