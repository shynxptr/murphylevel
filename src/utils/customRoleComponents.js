const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  PermissionFlagsBits,
  Routes,
} = require('discord.js');
const db = require('./database');

/**
 * Normalisasi kode warna Hex (#RRGGBB atau #RGB) → '#RRGGBB' (uppercase) atau null
 */
function normalizeHexColor(input) {
  if (!input) return null;
  const cleaned = input.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const r = cleaned[0] + cleaned[0];
    const g = cleaned[1] + cleaned[1];
    const b = cleaned[2] + cleaned[2];
    return `#${(r + g + b).toUpperCase()}`;
  }
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}

/**
 * Generate warna Hex acak yang cerah
 */
function generateRandomHexColor() {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, '0').toUpperCase()}`;
}

/**
 * Buat embed hijau "✅ Custom role updated" persis seperti di referensi gambar
 */
function buildRoleUpdatedEmbed(description, thumbnailUrl = null) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Custom role updated')
    .setDescription(description);

  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }
  return embed;
}

/**
 * Terapkan warna role (mendukung 1 warna standar maupun 2 warna gradasi Discord terbaru)
 */
async function applyRoleColors(guild, role, primaryHex, sideHex = null, reason = 'Custom role color update') {
  const primaryInt = parseInt(primaryHex.replace('#', ''), 16);

  if (sideHex) {
    const secondaryInt = parseInt(sideHex.replace('#', ''), 16);
    try {
      await guild.client.rest.patch(Routes.guildRole(guild.id, role.id), {
        body: {
          color: primaryInt,
          colors: {
            primary_color: primaryInt,
            secondary_color: secondaryInt,
            tertiary_color: null,
          },
        },
        reason,
      });
      return;
    } catch {
      // Fallback ke warna utama jika server belum mendukung role gradient API
    }
  }

  await role.edit({ color: primaryHex, reason });
}

/**
 * Posisikan Custom Role tepat di bawah Role Bot (default ID: 1559902612692664332 atau role tertinggi bot)
 * sehingga warna & icon role langsung tampil rapi di profil member tanpa perlu digeser manual.
 */
async function positionRoleBelowBot(guild, role, cfg = null) {
  try {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember) return role;

    const effectiveCfg = cfg || db.getCustomRoleConfig(guild.id);
    const highestBotRole = botMember.roles.highest;

    let anchorRole = null;
    if (effectiveCfg?.anchorRoleId) {
      anchorRole = guild.roles.cache.get(effectiveCfg.anchorRoleId)
        || await guild.roles.fetch(effectiveCfg.anchorRoleId).catch(() => null);
    }

    // Gunakan anchorRole (1559902612692664332) jika ada dan tidak melebihi role tertinggi bot;
    // jika tidak ditemukan, otomatis gunakan role tertinggi bot
    if (!anchorRole || anchorRole.position > highestBotRole.position) {
      anchorRole = highestBotRole;
    }

    if (!anchorRole || anchorRole.position <= 1) return role;

    // Jika role saat ini berada di bawah anchorRole, target index di discord.js setPosition adalah anchorRole.position - 1
    // agar role ditempatkan persis 1 tingkat di bawah anchorRole
    const targetPosition = role.position < anchorRole.position
      ? Math.max(1, anchorRole.position - 1)
      : Math.max(1, anchorRole.position);

    if (role.position === targetPosition) return role;

    try {
      await role.setPosition(targetPosition, {
        reason: `Auto-position Custom Role tepat di bawah role bot (${anchorRole.name})`,
      });
      return role;
    } catch {
      // Fallback langsung ke REST API hanya untuk 1 role ini jika cache posisi role lain di server tidak sinkron
      const rawTarget = Math.max(1, (anchorRole.rawPosition || anchorRole.position) - 1);
      await guild.client.rest.patch(Routes.guildRoles(guild.id), {
        body: [{ id: role.id, position: rawTarget }],
        reason: `Auto-position Custom Role tepat di bawah role bot (${anchorRole.name})`,
      }).catch(() => {});
      return role;
    }
  } catch (err) {
    console.warn(`⚠️ Gagal mengatur posisi Custom Role ${role?.name}:`, err.message);
    return role;
  }
}

/**
 * Sinkronkan daftar sharedWith dengan member yang benar-benar masih memegang role di guild
 */
function syncSharedMembers(guild, role, customData) {
  const ownerId = customData.ownerId;
  const validShared = (customData.sharedWith || []).filter((uid) => {
    if (uid === ownerId) return false;
    const m = guild.members.cache.get(uid);
    return m ? m.roles.cache.has(role.id) : true;
  });

  if (validShared.length !== (customData.sharedWith || []).length) {
    return db.setUserCustomRole(guild.id, ownerId, {
      ...customData,
      sharedWith: validShared,
    });
  }
  return customData;
}

/**
 * Cek dan bersihkan Custom Role user jika sudah melewati batas waktu (expired)
 * Mengembalikan null jika sudah expired dan dihapus, atau customData jika masih aktif
 */
function ensureActiveCustomRole(guild, ownerId) {
  const customData = db.getUserCustomRole(guild.id, ownerId);
  if (!customData) return null;

  if (typeof customData.expiresAt === 'number' && customData.expiresAt <= Date.now()) {
    const role = guild.roles.cache.get(customData.roleId);
    if (role) {
      role.delete('Masa aktif Custom Role habis (expired)').catch(() => {});
    }
    db.setUserCustomRole(guild.id, ownerId, null);
    return null;
  }

  // Jika role yang sudah dibuat sebelumnya masih berada di posisi paling bawah, rapikan otomatis di bawah role bot
  const existingRole = guild.roles.cache.get(customData.roleId);
  if (existingRole && existingRole.position <= 2) {
    positionRoleBelowBot(guild, existingRole).catch(() => {});
  }

  return customData;
}

/**
 * Background task: Cek semua Custom Role di seluruh guild yang sudah habis masa aktifnya (expired),
 * hapus rolenya dari Discord & database, dan kirim notifikasi DM singkat ke pemiliknya.
 */
async function checkAndCleanupExpiredCustomRoles(client) {
  const expiredList = db.getExpiredCustomRoles(Date.now());
  if (expiredList.length === 0) return 0;

  let cleaned = 0;
  for (const { guildId, userId, customData } of expiredList) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      const role = guild.roles.cache.get(customData.roleId)
        || await guild.roles.fetch(customData.roleId).catch(() => null);
      if (role) {
        await role.delete('Masa aktif Custom Role habis (expired)').catch(() => {});
      }
    }

    db.setUserCustomRole(guildId, userId, null);
    cleaned++;

    // Kirim pemberitahuan DM ramah ke pemilik
    try {
      const user = client.users.cache.get(userId) || await client.users.fetch(userId).catch(() => null);
      if (user) {
        const guildName = guild ? guild.name : 'server';
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle('⏳ Masa Aktif Custom Role Berakhir')
          .setDescription(
            `Masa aktif Custom Role **${customData.name}** milikmu di **${guildName}** telah habis dan role telah dihapus otomatis.\n\n` +
            `💡 Kamu bisa membuat Custom Role baru kapan saja menggunakan Level Points dengan mengetik \`!role\` atau \`/roleshop role\`!`
          )
          .setTimestamp();
        await user.send({ embeds: [embed] }).catch(() => {});
      }
    } catch {
      // Abaikan jika DM user tertutup
    }
  }

  return cleaned;
}

/**
 * Bangun komponen tombol pilihan paket Extend (Perpanjang Durasi: 7d / 14d / 28d)
 */
function buildExtendPlanButtons(guildId, ownerId, isPermanent = false) {
  const cfg = db.getCustomRoleConfig(guildId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cr_extend_7d_${ownerId}`)
      .setLabel(`+7 Hari (${cfg.price7d} Poin)`)
      .setEmoji('⏳')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isPermanent),
    new ButtonBuilder()
      .setCustomId(`cr_extend_14d_${ownerId}`)
      .setLabel(`+14 Hari (${cfg.price14d} Poin)`)
      .setEmoji('🗓️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isPermanent),
    new ButtonBuilder()
      .setCustomId(`cr_extend_28d_${ownerId}`)
      .setLabel(`+28 Hari (${cfg.price28d} Poin)`)
      .setEmoji('🌟')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isPermanent)
  );

  if (cfg.pricePermanent > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`cr_extend_perm_${ownerId}`)
        .setLabel(`Permanen (${cfg.pricePermanent} Poin)`)
        .setEmoji('♾️')
        .setStyle(ButtonStyle.Success)
        .setDisabled(isPermanent)
    );
  }

  return row;
}

/**
 * Bangun Embed Panduan Lengkap (Help) untuk Role Shop, Level Points, & Custom Role
 */
function buildShopHelpEmbed(guild, userId = null) {
  const guildId = guild.id;
  const cfg = db.getCustomRoleConfig(guildId);
  const activeRoles = db.getActiveCustomRoleCount(guildId);
  const pts = userId ? db.getPointsData(guildId, userId) : null;

  const userSummary = pts
    ? `🪙 **Dompet Kamu:** **${pts.balance} / ${pts.walletCap} Poin**${pts.isWalletFull ? ' ⚠️ *(PENUH)*' : ''} • **Overall Lv.${pts.overallLevel}**\n`
    : '';

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('📖 Panduan Role Shop, Level Points & Custom Role')
    .setDescription(
      [
        userSummary + `📦 **Kuota Custom Role Server:** **${activeRoles} / ${cfg.maxServerRoles} Slot Terpakai**`,
        `Sistem **Level Points** memungkinkan kamu menukarkan hasil keaktifan Chat & Voice menjadi **Custom Role Pribadi** lengkap dengan warna gradasi, icon, dan fitur share ke teman!`,
      ].join('\n')
    )
    .addFields(
      {
        name: '🪙 1. Cara Mendapatkan Poin & Aturan Dompet',
        value: [
          `• 💬 **Naik Chat Level:** **+1 Poin** setiap naik 1 level`,
          `• 🎙️ **Naik Voice Level:** **+1 Poin** setiap naik 1 level`,
          `• 🏆 **Bonus Milestone Level:** **+2 Poin** tiap tembus level *5, 10, 15, 20, 25, 30, 40, 50, dst.*`,
          `• ⚡ **Grinding XP Berkelanjutan:** **+1 Poin** setiap mengumpulkan **1.500 Total XP** gabungan`,
          `• 👛 **Limit Dompet Maksimal (${cfg.walletCap} Poin):** Poin di dompetmu **tidak bisa menumpuk melebihi ${cfg.walletCap} Poin**. Jika dompet sudah penuh, belanjakan poinmu (beli/extend role atau beli slot share) agar poin dari level berikutnya bisa masuk lagi!`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '⏳ 2. Paket Harga & Syarat Custom Role',
        value: [
          `• 🔓 **Syarat Minimal:** **Overall Level ${cfg.minOverallLevel}** untuk membuat Custom Role baru *(Member di bawah Lv.${cfg.minOverallLevel} tetap bisa memakai role yang di-share oleh temannya!)*`,
          `• ⏳ **Paket 7 Hari (1 Minggu):** **${cfg.price7d} Poin**`,
          `• 🗓️ **Paket 14 Hari (2 Minggu):** **${cfg.price14d} Poin**`,
          `• 🌟 **Paket 28 Hari (~1 Bulan):** **${cfg.price28d} Poin** *(Diskon hemat 10 Poin!)*`,
          `• 🔄 **Perpanjang Durasi (Extend):** Bisa diperpanjang kapan saja hingga batas tumpuk maksimal **${cfg.maxDurationDays} Hari**. Jika waktu habis dan tidak diperpanjang, role otomatis terhapus.`,
          `• ✨ **Fitur Tambahan:** Edit Nama/Warna/Icon **Gratis** • **+1 Slot Share Teman:** **${cfg.shareSlotPrice} Poin/slot** • **Unlock Hoist:** **${cfg.hoistPrice} Poin**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚡ 3. Shortcut Command Cepat (Prefix `!`)',
        value: [
          `• \`!role\` atau \`!role @user\` — Buka panel interaktif **Custom Role Information**`,
          `• \`!color #HEX1\` atau \`!color #HEX1 #HEX2\` — Ubah warna role (mendukung 2 warna gradasi!)`,
          `• \`!icon\` *(sambil upload gambar/emoji/URL)* — Pasang atau hapus icon role`,
          `• \`!name <nama baru>\` — Ganti nama Custom Role dengan cepat`,
          `• \`!share @user\` / \`!unshare @user\` — Bagikan atau lepas Custom Role ke teman`,
          `• \`!extend [7d | 14d | 28d]\` — Perpanjang masa aktif Custom Role`,
          `• \`!shophelp\` / \`!roleshop help\` — Tampilkan panduan ini`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛒 4. Slash Commands (`/roleshop`)',
        value: [
          `• \`/roleshop role\` — Buka panel interaktif **View & Edit Mode**`,
          `• \`/roleshop view\` — Lihat daftar harga, kuota slot server, & katalog Role Shop`,
          `• \`/roleshop points\` — Lihat rincian dompet poin dan sumber poinmu`,
          `• \`/roleshop buy-custom\` — Buat Custom Role baru (pilih paket 7d / 14d / 28d)`,
          `• \`/roleshop extend\` — Perpanjang durasi Custom Role aktifmu`,
          `• \`/roleshop buy-slot\` — Beli +1 slot Share untuk membagikan role ke teman`,
          `• \`/roleshop buy-role\` — Beli role spesial dari katalog toko server`,
          `• \`/roleshop help\` — Buka panduan lengkap fitur Role Shop ini`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚙️ 5. Command Admin (`/setshop`)',
        value: [
          `• \`/setshop custom-config\` — Atur harga paket 7d/14d/28d, limit dompet, kuota role server, & syarat level`,
          `• \`/setshop add-role\` & \`/setshop remove-role\` — Kelola role di katalog toko`,
          `• \`/setshop give-points\` & \`/setshop take-points\` — Tambah/kurangi poin member`,
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: 'Tips: Ketik !role untuk langsung membuka panel Custom Role kamu!' })
    .setTimestamp();

  return embed;
}

/**
 * Bangun payload pesan "ℹ️ Custom Role Information" (View Mode atau Edit Mode)
 * Persis seperti desain referensi Gambar 1 & Gambar 3
 */
function buildCustomRoleInfoPayload(guild, ownerId, mode = 'view') {
  const guildId = guild.id;
  const cfg = db.getCustomRoleConfig(guildId);
  const points = db.getPointsData(guildId, ownerId);
  let customData = ensureActiveCustomRole(guild, ownerId);
  const role = customData ? guild.roles.cache.get(customData.roleId) : null;

  // Jika belum punya custom role (atau rolenya sudah terhapus / expired di server)
  if (!customData || !role) {
    const activeRoles = db.getActiveCustomRoleCount(guildId);
    const isTester = db.isRoleTester(ownerId);
    const isServerSlotFull = activeRoles >= cfg.maxServerRoles && !isTester;
    const meetsLevelReq = points.overallLevel >= cfg.minOverallLevel || isTester;
    const permLine = cfg.pricePermanent > 0
      ? `> ♾️ **Paket Permanen:** **${cfg.pricePermanent} Poin**\n`
      : '';

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('ℹ️ Custom Role Information')
      .setDescription(
        [
          `<@${ownerId}> belum memiliki Custom Role aktif di server ini.`,
          '',
          `> 🪙 **Dompet Poin:** **${points.balance} / ${points.walletCap} Poin**${points.isWalletFull ? ' ⚠️ *(PENUH)*' : ''}${isTester ? ' 🛠️ *(Mode Tester Aktif)*' : ''}`,
          `> 🔓 **Syarat Buat Role:** **Minimal Overall Lv.${cfg.minOverallLevel}** *(Levelmu: Lv.${points.overallLevel} ${meetsLevelReq ? '✅' : '🔒'})*`,
          `> 📦 **Kuota Role Server:** **${activeRoles} / ${cfg.maxServerRoles} Slot Terpakai**${isServerSlotFull ? ' ⚠️ *(PENUH)*' : ''}`,
          '',
          `> ⏳ **Paket 7 Hari (1 Minggu):** **${cfg.price7d} Poin**`,
          `> 🗓️ **Paket 14 Hari (2 Minggu):** **${cfg.price14d} Poin**`,
          `> 🌟 **Paket 28 Hari (~1 Bulan):** **${cfg.price28d} Poin** *(Hemat 10 Poin!)*`,
          permLine ? permLine.trimEnd() : null,
          `> ✨ **Edit Nama / Warna / Icon:** **Gratis**`,
          `> 🤝 **Tambah Slot Share Teman:** **${cfg.shareSlotPrice} Poin / slot** *(Hemat slot server!)*`,
          `> 📌 **Unlock Fitur Hoist:** **${cfg.hoistPrice} Poin**`,
        ]
          .filter((l) => l !== null)
          .join('\n')
      );

    const canCreate = cfg.enabled && !isServerSlotFull && meetsLevelReq;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cr_btn_create_7d_${ownerId}`)
        .setLabel(`7 Hari (${cfg.price7d}P)`)
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canCreate),
      new ButtonBuilder()
        .setCustomId(`cr_btn_create_14d_${ownerId}`)
        .setLabel(`14 Hari (${cfg.price14d}P)`)
        .setEmoji('🗓️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canCreate),
      new ButtonBuilder()
        .setCustomId(`cr_btn_create_28d_${ownerId}`)
        .setLabel(`28 Hari (${cfg.price28d}P)`)
        .setEmoji('🌟')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canCreate),
      new ButtonBuilder()
        .setCustomId(`cr_btn_points_${ownerId}`)
        .setLabel(`Dompet: ${points.balance}/${points.walletCap}P`)
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cr_btn_help_${ownerId}`)
        .setLabel('Help')
        .setEmoji('❓')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
  }

  customData = syncSharedMembers(guild, role, customData);

  const ownerMember = guild.members.cache.get(ownerId);
  const isEquipped = ownerMember ? ownerMember.roles.cache.has(role.id) : true;

  const primaryHex = (customData.color || role.hexColor || '#CECECE').toUpperCase();
  const sideHex = customData.sideColor ? customData.sideColor.toUpperCase() : null;
  const colorDisplay = sideHex ? `${primaryHex} ${sideHex}` : primaryHex;

  const discordIconUrl = role.iconURL({ extension: 'png', size: 256 });
  const effectiveIconUrl = discordIconUrl || customData.iconURL || null;
  const hasIcon = Boolean(effectiveIconUrl || role.unicodeEmoji);
  const hasBanner = Boolean(customData.bannerURL);
  const isHoisted = Boolean(role.hoist);

  const sharedCount = (customData.sharedWith || []).length;
  const maxShares = customData.maxShares || 0;
  const memberCount = Math.max(role.members.size, (isEquipped ? 1 : 0) + sharedCount);
  const createdSec = Math.floor((customData.createdAt || Date.now()) / 1000);
  const isPermanent = !customData.expiresAt;
  const expiresSec = customData.expiresAt ? Math.floor(customData.expiresAt / 1000) : null;
  const expiresDisplay = expiresSec
    ? `<t:${expiresSec}:R> (<t:${expiresSec}:d>)`
    : '**Permanent ♾️**';

  const infoLines = [
    `👑 Owned by <@${ownerId}>`,
    '',
    '**Description**',
    customData.description || "This custom role's duration follows your active Level Points plan.",
    '',
    `> Role Name: **${role.name}**`,
    `> Role Mention: ${role}`,
    `> Color: \`${colorDisplay}\``,
    `> 🔘 Side Color: \`${sideHex || 'None'}\``,
    `> 🔘 Icon: **${hasIcon ? 'Yes' : 'No'}**`,
    `> 🔘 Banner: **${hasBanner ? 'Yes' : 'No'}**`,
    `> 🔘 Hoisted: **${isHoisted ? 'Yes' : 'No'}**${customData.hoistUnlocked ? '' : ` *(🔒 ${cfg.hoistPrice} Poin)*`}`,
    `> Members: **${memberCount}**`,
    `> Shared: **${sharedCount} / ${maxShares}**`,
    `> Created At: <t:${createdSec}:R>`,
    `> Expires At: ${expiresDisplay}`,
  ];

  const mainEmbed = new EmbedBuilder()
    .setColor(role.color || 0x2b2d31)
    .setTitle('ℹ️ Custom Role Information')
    .setDescription(infoLines.join('\n'));

  if (effectiveIconUrl) {
    mainEmbed.setThumbnail(effectiveIconUrl);
  }
  if (customData.bannerURL) {
    mainEmbed.setImage(customData.bannerURL);
  }

  // =================== VIEW MODE ===================
  if (mode === 'view') {
    const viewRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cr_mode_edit_${ownerId}`)
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary)
    );

    if (!isPermanent) {
      viewRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`cr_btn_extend_${ownerId}`)
          .setLabel('Extend Durasi')
          .setEmoji('⏳')
          .setStyle(ButtonStyle.Primary)
      );
    }

    viewRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`cr_buyslot_${ownerId}`)
        .setLabel(`+1 Share Slot (${cfg.shareSlotPrice} Poin)`)
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(maxShares >= cfg.maxShareSlots),
      new ButtonBuilder()
        .setCustomId(`cr_btn_help_${ownerId}`)
        .setLabel('Help')
        .setEmoji('❓')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [mainEmbed], components: [viewRow] };
  }

  // =================== EDIT MODE ===================
  const editEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(
      [
        `✏️ **Edit Mode**`,
        `🪙 Dompet Poin: **${points.balance} / ${points.walletCap} Poin** • Edit dasar **Gratis** • Extend: **${cfg.price7d}P (7d) / ${cfg.price14d}P (14d) / ${cfg.price28d}P (28d)** • Slot Share: **${cfg.shareSlotPrice} Poin**`,
      ].join('\n')
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cr_btn_name_${ownerId}`).setLabel('Name').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_color_${ownerId}`).setLabel('Color').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_randcolor_${ownerId}`).setLabel('Random Color').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_sidecolor_${ownerId}`).setLabel('Side Color').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cr_btn_icon_${ownerId}`).setLabel('Icon').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_banner_${ownerId}`).setLabel('Banner').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_desc_${ownerId}`).setLabel('Description').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cr_btn_hoist_${ownerId}`)
      .setLabel(customData.hoistUnlocked ? 'Hoist' : `Hoist (${cfg.hoistPrice}P)`)
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cr_btn_share_${ownerId}`).setLabel('Share').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_transfer_${ownerId}`).setLabel('Transfer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cr_btn_history_${ownerId}`).setLabel('History').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cr_btn_extend_${ownerId}`)
      .setLabel(isPermanent ? 'Permanent ♾️' : 'Extend ⏳')
      .setStyle(isPermanent ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(isPermanent)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cr_btn_equip_${ownerId}`)
      .setLabel(isEquipped ? 'Unequip' : 'Equip')
      .setStyle(isEquipped ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cr_btn_delete_${ownerId}`)
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cr_btn_help_${ownerId}`)
      .setEmoji('❓')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cr_mode_view_${ownerId}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [mainEmbed, editEmbed],
    components: [row1, row2, row3, row4],
  };
}

/**
 * Helper: Download gambar dari URL dan pasang sebagai Role Icon
 */
async function setRoleIconFromUrl(role, imageUrl, reason = 'Custom role icon update') {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error('Gagal mengunduh gambar dari URL tersebut.');
  const contentType = res.headers.get('content-type') || '';
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('URL tersebut bukan file gambar yang valid (PNG/JPG/WEBP/GIF).');
  }
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.length > 4 * 1024 * 1024) {
    throw new Error('Ukuran gambar terlalu besar (maksimal 4 MB).');
  }

  let appliedToDiscordRole = false;
  try {
    await role.setIcon(buffer, reason);
    appliedToDiscordRole = true;
  } catch {
    // Jika server belum Boost Level 2, Discord menolak role.setIcon — kita tetap simpan thumbnail di kartu info
  }
  return { appliedToDiscordRole, imageUrl };
}

/**
 * Parse input icon (bisa berupa Custom Emoji <:name:id>, <a:name:id>, atau URL gambar)
 */
function resolveIconInputUrl(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const emojiMatch = trimmed.match(/^<a?:[a-zA-Z0-9_]+:(\d{17,20})>$/);
  if (emojiMatch) {
    return `https://cdn.discordapp.com/emojis/${emojiMatch[1]}.png?size=256`;
  }
  if (/^https?:\/\/\S+/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Handle semua interaksi Button, Modal, dan SelectMenu yang berawalan "cr_"
 */
async function handleCustomRoleInteraction(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;
  const guildId = guild.id;
  const customId = interaction.customId || '';
  if (!customId.startsWith('cr_')) return false;

  // Extract ownerId dari ujung customId (format: cr_<action>_<ownerId>)
  const parts = customId.split('_');
  const ownerId = parts[parts.length - 1];
  const action = parts.slice(1, -1).join('_');

  // =================== BUTTON: HELP PANDUAN ROLE SHOP (Bisa diklik siapa saja) ===================
  if (interaction.isButton() && action === 'btn_help') {
    const helpEmbed = buildShopHelpEmbed(guild, interaction.user.id);
    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    return true;
  }

  // Pastikan hanya pemilik (atau akun Tester) yang bisa menekan tombol aksi (kecuali cek help)
  if (interaction.user.id !== ownerId && !db.isRoleTester(interaction.user.id)) {
    await interaction.reply({
      content: `❌ Hanya pemilik Custom Role ini (<@${ownerId}>) yang bisa menggunakan tombol ini.`,
      ephemeral: true,
    });
    return true;
  }

  const cfg = db.getCustomRoleConfig(guildId);
  const isTester = db.isRoleTester(ownerId) || db.isRoleTester(interaction.user.id);

  // =================== BUTTON: CEK SALDO POIN ===================
  if (interaction.isButton() && action === 'btn_points') {
    const pts = db.getPointsData(guildId, ownerId);
    await interaction.reply({
      content: [
        `🪙 **Dompet Poin Kamu:** **${pts.balance} / ${pts.walletCap} Poin**${pts.isWalletFull ? ' ⚠️ **(DOMPET PENUH — Belanjakan poinmu agar poin baru tidak hangus!)**' : ''}${isTester ? ' 🛠️ *(Mode Tester Aktif)*' : ''}`,
        `*(Total terpakai: ${pts.spentPoints} Poin • Overall Lv.${pts.overallLevel})*`,
        '',
        `**Sumber Poin Grinding:**`,
        `• 💬 Chat Level (${pts.chatLevel}): **+${pts.chatTierPoints} Poin** *(+1 Poin / level)*`,
        `• 🎙️ Voice Level (${pts.voiceLevel}): **+${pts.voiceTierPoints} Poin** *(+1 Poin / level)*`,
        `• 🏆 Bonus Milestone Level: **+${pts.milestonePoints} Poin** *(+2 Poin tiap milestone)*`,
        `• ⚡ Bonus Grinding XP: **+${pts.xpActivityPoints} Poin** *(+1 Poin tiap 1.500 Total XP)*`,
      ].join('\n'),
      ephemeral: true,
    });
    return true;
  }

  // =================== BUTTON: BUAT CUSTOM ROLE BARU (MODAL PAKET DURASI) ===================
  if (interaction.isButton() && (action === 'btn_create' || action.startsWith('btn_create_'))) {
    const planKey = action.startsWith('btn_create_') ? action.replace('btn_create_', '') : '28d';
    const plan = db.getCustomRolePlanInfo(guildId, planKey);

    if (!plan.enabled) {
      await interaction.reply({
        content: '❌ Paket durasi tersebut sedang dinonaktifkan oleh admin.',
        ephemeral: true,
      });
      return true;
    }

    const pts = db.getPointsData(guildId, ownerId);
    if (pts.overallLevel < cfg.minOverallLevel && !isTester) {
      await interaction.reply({
        content: `🔒 Kamu membutuhkan minimal **Overall Level ${cfg.minOverallLevel}** untuk membuat Custom Role sendiri (Level kamu saat ini: **Lv.${pts.overallLevel}**).\n💡 *Tips: Kamu tetap bisa menerima Custom Role dari teman yang membagikan rolenya lewat fitur \`!share\`!*`,
        ephemeral: true,
      });
      return true;
    }

    const activeRoles = db.getActiveCustomRoleCount(guildId);
    if (activeRoles >= cfg.maxServerRoles && !isTester) {
      await interaction.reply({
        content: `⚠️ Kuota Custom Role di server saat ini sedang penuh (**${activeRoles} / ${cfg.maxServerRoles} Role Aktif**) demi menjaga batas aman slot role Discord.\n💡 Silakan tunggu hingga ada Custom Role member lain yang habis masa aktifnya, atau minta temanmu membagikan rolenya menggunakan \`!share\`!`,
        ephemeral: true,
      });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_create_${plan.key}_${ownerId}`)
      .setTitle(`Buat Role • ${plan.label} (${plan.price} Poin)`);

    const nameInput = new TextInputBuilder()
      .setCustomId('role_name')
      .setLabel('Nama Custom Role')
      .setPlaceholder('Contoh: fear of missing out')
      .setMinLength(1)
      .setMaxLength(50)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const colorInput = new TextInputBuilder()
      .setCustomId('role_color')
      .setLabel('Warna Hex (#HEX1 atau #HEX1 #HEX2)')
      .setPlaceholder('Contoh: #CECECE atau #FFFFF0 #AA8668')
      .setMinLength(4)
      .setMaxLength(20)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const descInput = new TextInputBuilder()
      .setCustomId('role_desc')
      .setLabel('Deskripsi (Opsional)')
      .setPlaceholder('Deskripsi singkat tentang custom role kamu')
      .setMaxLength(150)
      .setRequired(false)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(descInput)
    );

    await interaction.showModal(modal);
    return true;
  }

  // =================== MODAL SUBMIT: BUAT CUSTOM ROLE BARU ===================
  if (interaction.isModalSubmit() && (action === 'modal_create' || action.startsWith('modal_create_'))) {
    await interaction.deferUpdate();

    if (!cfg.enabled) {
      await interaction.followUp({ content: '❌ Pembuatan Custom Role sedang dinonaktifkan oleh admin.', ephemeral: true });
      return true;
    }

    const planKey = action.startsWith('modal_create_') ? action.replace('modal_create_', '') : '28d';
    const plan = db.getCustomRolePlanInfo(guildId, planKey);
    if (!plan.enabled) {
      await interaction.followUp({ content: '❌ Paket durasi tersebut sedang dinonaktifkan oleh admin.', ephemeral: true });
      return true;
    }

    const existing = ensureActiveCustomRole(guild, ownerId);
    if (existing && guild.roles.cache.get(existing.roleId)) {
      const payload = buildCustomRoleInfoPayload(guild, ownerId, 'view');
      await interaction.editReply(payload);
      return true;
    }

    const pts = db.getPointsData(guildId, ownerId);
    if (pts.overallLevel < cfg.minOverallLevel && !isTester) {
      await interaction.followUp({
        content: `🔒 Kamu membutuhkan minimal **Overall Level ${cfg.minOverallLevel}** untuk membuat Custom Role baru (Levelmu: **Lv.${pts.overallLevel}**).`,
        ephemeral: true,
      });
      return true;
    }

    const activeRoles = db.getActiveCustomRoleCount(guildId);
    if (activeRoles >= cfg.maxServerRoles && !isTester) {
      await interaction.followUp({
        content: `⚠️ Kuota Custom Role server sedang penuh (**${activeRoles} / ${cfg.maxServerRoles} Role Aktif**). Silakan tunggu slot kosong atau gunakan fitur Share Role bersama teman!`,
        ephemeral: true,
      });
      return true;
    }

    const rawName = interaction.fields.getTextInputValue('role_name').trim();
    const rawColorTokens = interaction.fields.getTextInputValue('role_color').trim().split(/\s+/);
    const rawDesc = interaction.fields.getTextInputValue('role_desc')?.trim();

    const primaryHex = normalizeHexColor(rawColorTokens[0]);
    const sideHex = rawColorTokens[1] ? normalizeHexColor(rawColorTokens[1]) : null;

    if (!primaryHex || (rawColorTokens[1] && !sideHex)) {
      await interaction.followUp({
        content: '❌ Format warna Hex tidak valid! Gunakan contoh seperti `#CECECE` atau `#FFFFF0 #AA8668`.',
        ephemeral: true,
      });
      return true;
    }

    if (pts.balance < plan.price && !isTester) {
      await interaction.followUp({
        content: `❌ Poin kamu belum cukup untuk paket **${plan.label}**! Harga: **${plan.price} Poin**, saldo dompetmu: **${pts.balance} / ${pts.walletCap} Poin** *(kurang ${plan.price - pts.balance} Poin)*.`,
        ephemeral: true,
      });
      return true;
    }

    const botMember = guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.followUp({ content: '❌ Bot tidak memiliki izin **Manage Roles**.', ephemeral: true });
      return true;
    }

    try {
      const createdRole = await guild.roles.create({
        name: rawName,
        color: primaryHex,
        permissions: [],
        reason: `Custom Role (${plan.label}) dibeli oleh ${interaction.user.tag} (${plan.price} Poin)`,
      });

      await positionRoleBelowBot(guild, createdRole, cfg);

      if (sideHex) {
        await applyRoleColors(guild, createdRole, primaryHex, sideHex);
      }

      const member = guild.members.cache.get(ownerId) || await guild.members.fetch(ownerId).catch(() => null);
      if (member) {
        await member.roles.add(createdRole);
      }

      const now = Date.now();
      const expiresAt = plan.durationMs ? now + plan.durationMs : null;

      db.spendPoints(guildId, ownerId, plan.price);
      db.setUserCustomRole(guildId, ownerId, {
        roleId: createdRole.id,
        ownerId,
        name: rawName,
        color: primaryHex,
        sideColor: sideHex,
        description: rawDesc || "This custom role's duration follows your active Level Points plan.",
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

      const payload = buildCustomRoleInfoPayload(guild, ownerId, 'view');
      await interaction.editReply(payload);
      const expText = expiresAt ? ` (Berlaku hingga <t:${Math.floor(expiresAt / 1000)}:R>)` : ' (**Permanent ♾️**)';
      await interaction.followUp({
        embeds: [buildRoleUpdatedEmbed(`${createdRole} : **Successfully** created your custom role!${expText}`)],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ Gagal membuat Custom Role: ${err.message}`, ephemeral: true });
    }
    return true;
  }

  // Ambil custom role user untuk semua aksi di bawah ini
  const customData = ensureActiveCustomRole(guild, ownerId);
  const role = customData ? guild.roles.cache.get(customData.roleId) : null;

  if (!customData || !role) {
    const payload = buildCustomRoleInfoPayload(guild, ownerId, 'view');
    if (interaction.isButton()) {
      await interaction.update(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
    return true;
  }

  // =================== SWITCH MODE: VIEW <-> EDIT ===================
  if (interaction.isButton() && (action === 'mode_edit' || action === 'mode_view')) {
    const targetMode = action === 'mode_edit' ? 'edit' : 'view';
    const payload = buildCustomRoleInfoPayload(guild, ownerId, targetMode);
    await interaction.update(payload);
    return true;
  }

  // =================== BUTTON: OPEN EXTEND DURATION MENU ===================
  if (interaction.isButton() && action === 'btn_extend') {
    const isPermanent = !customData.expiresAt;
    if (isPermanent) {
      await interaction.reply({
        content: `♾️ Custom Role ${role} milikmu sudah berstatus **Permanen**!`,
        ephemeral: true,
      });
      return true;
    }

    const pts = db.getPointsData(guildId, ownerId);
    const expSec = Math.floor(customData.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('⏳ Extend Custom Role Duration')
      .setDescription(
        [
          `**Role:** ${role}`,
          `**Berakhir Pada:** <t:${expSec}:R> (<t:${expSec}:f>)`,
          `**Dompet Poin Kamu:** 🪙 **${pts.balance} / ${pts.walletCap} Poin**`,
          `**Batas Tumpuk Durasi:** Maksimal **${cfg.maxDurationDays} Hari**`,
          '',
          'Pilih paket perpanjangan masa aktif di bawah ini:',
        ].join('\n')
      );

    const row = buildExtendPlanButtons(guildId, ownerId, false);
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }

  // =================== BUTTON: EXECUTE EXTEND (7d / 14d / 28d / perm) ===================
  if (interaction.isButton() && action.startsWith('extend_')) {
    const planKey = action.replace('extend_', '');
    const plan = db.getCustomRolePlanInfo(guildId, planKey);

    if (!plan.enabled) {
      await interaction.reply({ content: '❌ Paket tersebut sedang tidak tersedia.', ephemeral: true });
      return true;
    }

    if (!customData.expiresAt) {
      await interaction.reply({ content: `♾️ Custom Role ${role} milikmu sudah **Permanen**!`, ephemeral: true });
      return true;
    }

    if (plan.durationMs && !isTester) {
      const now = Date.now();
      const baseTime = customData.expiresAt > now ? customData.expiresAt : now;
      const projectedRemainingDays = Math.ceil((baseTime + plan.durationMs - now) / (24 * 60 * 60 * 1000));
      if (projectedRemainingDays > cfg.maxDurationDays) {
        await interaction.reply({
          content: `⚠️ Durasi Custom Role tidak bisa ditumpuk melebihi **${cfg.maxDurationDays} Hari**! (Jika ditambah **+${plan.label}**, total sisa durasimu akan menjadi **${projectedRemainingDays} Hari**).`,
          ephemeral: true,
        });
        return true;
      }
    }

    const pts = db.getPointsData(guildId, ownerId);
    if (pts.balance < plan.price && !isTester) {
      await interaction.reply({
        content: `❌ Poin kamu belum cukup untuk paket **${plan.label}**! Harga: **${plan.price} Poin**, saldo dompetmu: **${pts.balance} / ${pts.walletCap} Poin** *(kurang ${plan.price - pts.balance} Poin)*.`,
        ephemeral: true,
      });
      return true;
    }

    const spendRes = db.spendPoints(guildId, ownerId, plan.price);
    const updatedData = db.extendUserCustomRole(guildId, ownerId, plan.key);
    db.appendCustomRoleHistory(
      guildId,
      ownerId,
      plan.key === 'perm'
        ? `Upgraded duration to Permanent (-${plan.price} Poin)`
        : `Extended duration by +${plan.label} (-${plan.price} Poin)`
    );

    const expMsg = updatedData.expiresAt
      ? `Berlaku hingga <t:${Math.floor(updatedData.expiresAt / 1000)}:R> (<t:${Math.floor(updatedData.expiresAt / 1000)}:d>)`
      : '**Permanent ♾️**';

    await interaction.update({
      embeds: [
        buildRoleUpdatedEmbed(
          `${role} : **Successfully** extended role duration (**+${plan.label}**)!\n⏳ Status: ${expMsg} • Sisa Dompet: **${spendRes.balance} / ${pts.walletCap} Poin**`
        ),
      ],
      components: [],
    });
    return true;
  }

  // =================== BUY +1 SHARE SLOT ===================
  if (interaction.isButton() && action === 'buyslot') {
    const currentMax = customData.maxShares || 0;
    if (currentMax >= cfg.maxShareSlots) {
      await interaction.reply({
        content: `ℹ️ Kamu sudah mencapai batas maksimal slot Share (**${cfg.maxShareSlots} slot**).`,
        ephemeral: true,
      });
      return true;
    }

    const pts = db.getPointsData(guildId, ownerId);
    if (pts.balance < cfg.shareSlotPrice && !isTester) {
      await interaction.reply({
        content: `❌ Poin kamu belum cukup untuk membeli +1 Slot Share! Harga: **${cfg.shareSlotPrice} Poin**, saldo kamu: **${pts.balance} Poin** *(kurang ${cfg.shareSlotPrice - pts.balance} Poin)*.`,
        ephemeral: true,
      });
      return true;
    }

    const spendRes = db.spendPoints(guildId, ownerId, cfg.shareSlotPrice);
    const newMax = currentMax + 1;
    db.setUserCustomRole(guildId, ownerId, {
      ...customData,
      maxShares: newMax,
    });
    db.appendCustomRoleHistory(guildId, ownerId, `Bought +1 Share Slot (${newMax} total)`);

    // Update panel jika tombol diklik dari panel utama
    if (interaction.message && interaction.message.embeds?.[0]?.title === 'ℹ️ Custom Role Information') {
      const isEditMode = interaction.message.embeds.length > 1;
      const payload = buildCustomRoleInfoPayload(guild, ownerId, isEditMode ? 'edit' : 'view');
      await interaction.update(payload);
      await interaction.followUp({
        embeds: [
          buildRoleUpdatedEmbed(
            `${role} : **Successfully** unlocked **+1 Share Slot**! (Shared capacity: **${(customData.sharedWith || []).length} / ${newMax}** • Sisa Poin: **${spendRes.balance} Poin**)`
          ),
        ],
        ephemeral: true,
      });
    } else {
      await interaction.update({
        embeds: [
          buildRoleUpdatedEmbed(
            `${role} : **Successfully** unlocked **+1 Share Slot**! (Shared capacity: **${(customData.sharedWith || []).length} / ${newMax}** • Sisa Poin: **${spendRes.balance} Poin**)`
          ),
        ],
        components: [],
      });
    }
    return true;
  }

  // =================== BUTTON: NAME (MODAL) ===================
  if (interaction.isButton() && action === 'btn_name') {
    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_name_${ownerId}`)
      .setTitle('Change Custom Role Name');

    const input = new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel('Role Name')
      .setValue(role.name)
      .setMinLength(1)
      .setMaxLength(50)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_name') {
    await interaction.deferUpdate();
    const newName = interaction.fields.getTextInputValue('new_name').trim();
    if (!newName || /^@(everyone|here)$/i.test(newName)) {
      await interaction.followUp({ content: '❌ Nama role tidak valid.', ephemeral: true });
      return true;
    }

    try {
      await role.setName(newName, `Diubah oleh ${interaction.user.tag}`);
      db.setUserCustomRole(guildId, ownerId, { ...customData, name: newName });
      db.appendCustomRoleHistory(guildId, ownerId, `Changed name to "${newName}"`);

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      await interaction.followUp({
        embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** changed the role name to **${newName}**`)],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ Gagal mengubah nama role: ${err.message}`, ephemeral: true });
    }
    return true;
  }

  // =================== BUTTON: COLOR (MODAL) ===================
  if (interaction.isButton() && action === 'btn_color') {
    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_color_${ownerId}`)
      .setTitle('Change Custom Role Color');

    const currentVal = customData.sideColor
      ? `${customData.color} ${customData.sideColor}`
      : customData.color;

    const input = new TextInputBuilder()
      .setCustomId('new_color')
      .setLabel('Hex Color (#HEX1 atau #HEX1 #HEX2)')
      .setValue(currentVal)
      .setPlaceholder('#FFFFF0 #AA8668')
      .setMinLength(4)
      .setMaxLength(20)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_color') {
    await interaction.deferUpdate();
    const rawTokens = interaction.fields.getTextInputValue('new_color').trim().split(/\s+/);
    const primaryHex = normalizeHexColor(rawTokens[0]);
    const sideHex = rawTokens[1] ? normalizeHexColor(rawTokens[1]) : customData.sideColor;

    if (!primaryHex || (rawTokens[1] && !normalizeHexColor(rawTokens[1]))) {
      await interaction.followUp({
        content: '❌ Kode warna Hex tidak valid! Contoh: `#FFFFF0` atau `#FFFFF0 #AA8668`.',
        ephemeral: true,
      });
      return true;
    }

    try {
      await applyRoleColors(guild, role, primaryHex, sideHex, `Diubah oleh ${interaction.user.tag}`);
      db.setUserCustomRole(guildId, ownerId, {
        ...customData,
        color: primaryHex,
        sideColor: sideHex,
      });
      const displayStr = sideHex ? `${primaryHex} ${sideHex}` : primaryHex;
      db.appendCustomRoleHistory(guildId, ownerId, `Changed color to ${displayStr}`);

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      await interaction.followUp({
        embeds: [
          buildRoleUpdatedEmbed(`${role} : **Successfully** changed the role color to\n\`\`\`\n${displayStr}\n\`\`\``),
        ],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ Gagal mengubah warna role: ${err.message}`, ephemeral: true });
    }
    return true;
  }

  // =================== BUTTON: RANDOM COLOR ===================
  if (interaction.isButton() && action === 'btn_randcolor') {
    await interaction.deferUpdate();
    const randomHex = generateRandomHexColor();
    try {
      await applyRoleColors(guild, role, randomHex, customData.sideColor, `Random color oleh ${interaction.user.tag}`);
      db.setUserCustomRole(guildId, ownerId, { ...customData, color: randomHex });
      db.appendCustomRoleHistory(guildId, ownerId, `Randomized color to ${randomHex}`);

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      await interaction.followUp({
        embeds: [
          buildRoleUpdatedEmbed(`${role} : **Successfully** changed the role color to\n\`\`\`\n${randomHex}\n\`\`\``),
        ],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ Gagal mengacak warna: ${err.message}`, ephemeral: true });
    }
    return true;
  }

  // =================== BUTTON: SIDE COLOR (MODAL) ===================
  if (interaction.isButton() && action === 'btn_sidecolor') {
    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_sidecolor_${ownerId}`)
      .setTitle('Change Side / Gradient Color');

    const input = new TextInputBuilder()
      .setCustomId('new_sidecolor')
      .setLabel('Side Color Hex (Ketik "none" untuk hapus)')
      .setValue(customData.sideColor || '')
      .setPlaceholder('#363636 atau none')
      .setMaxLength(15)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_sidecolor') {
    await interaction.deferUpdate();
    const rawVal = interaction.fields.getTextInputValue('new_sidecolor').trim();
    const isClear = /^none|clear|off|reset|-$/i.test(rawVal);
    const sideHex = isClear ? null : normalizeHexColor(rawVal);

    if (!isClear && !sideHex) {
      await interaction.followUp({
        content: '❌ Format Hex tidak valid. Masukkan seperti `#363636` atau ketik `none` untuk menghapus.',
        ephemeral: true,
      });
      return true;
    }

    try {
      await applyRoleColors(guild, role, customData.color, sideHex);
      db.setUserCustomRole(guildId, ownerId, { ...customData, sideColor: sideHex });
      db.appendCustomRoleHistory(guildId, ownerId, `Set side color to ${sideHex || 'None'}`);

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      const displayStr = sideHex ? `${customData.color} ${sideHex}` : customData.color;
      await interaction.followUp({
        embeds: [
          buildRoleUpdatedEmbed(`${role} : **Successfully** updated role side color to\n\`\`\`\n${displayStr}\n\`\`\``),
        ],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ Gagal mengubah side color: ${err.message}`, ephemeral: true });
    }
    return true;
  }

  // =================== BUTTON: ICON (MODAL) ===================
  if (interaction.isButton() && action === 'btn_icon') {
    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_icon_${ownerId}`)
      .setTitle('Change Custom Role Icon');

    const input = new TextInputBuilder()
      .setCustomId('icon_input')
      .setLabel('URL Gambar / Emoji (atau ketik "remove")')
      .setPlaceholder('https://.../icon.png, <:nama:id>, atau ketik !icon + gambar di chat')
      .setValue(customData.iconURL || '')
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_icon') {
    await interaction.deferUpdate();
    const rawInput = interaction.fields.getTextInputValue('icon_input').trim();

    if (/^remove|none|delete|clear|off$/i.test(rawInput)) {
      const prevIcon = role.iconURL({ extension: 'png', size: 256 }) || customData.iconURL;
      try {
        await role.setIcon(null).catch(() => {});
      } catch {}
      db.setUserCustomRole(guildId, ownerId, { ...customData, iconURL: null });
      db.appendCustomRoleHistory(guildId, ownerId, 'Removed role icon');

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      await interaction.followUp({
        embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** removed the role icon`, prevIcon)],
        ephemeral: true,
      });
      return true;
    }

    const resolvedUrl = resolveIconInputUrl(rawInput);
    if (!resolvedUrl) {
      await interaction.followUp({
        content: '❌ Masukkan URL gambar langsung (`https://...`), custom emoji (`<:name:id>`), atau ketik `!icon` sambil melampirkan gambar di chat!',
        ephemeral: true,
      });
      return true;
    }

    try {
      await setRoleIconFromUrl(role, resolvedUrl, `Diubah oleh ${interaction.user.tag}`);
      db.setUserCustomRole(guildId, ownerId, { ...customData, iconURL: resolvedUrl });
      db.appendCustomRoleHistory(guildId, ownerId, 'Changed role icon');

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      await interaction.followUp({
        embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** changed the role icon`, resolvedUrl)],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ Gagal mengubah icon: ${err.message}`, ephemeral: true });
    }
    return true;
  }

  // =================== BUTTON: BANNER (MODAL) ===================
  if (interaction.isButton() && action === 'btn_banner') {
    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_banner_${ownerId}`)
      .setTitle('Change Custom Role Banner');

    const input = new TextInputBuilder()
      .setCustomId('banner_input')
      .setLabel('URL Gambar Banner (atau ketik "remove")')
      .setPlaceholder('https://.../banner.png atau remove')
      .setValue(customData.bannerURL || '')
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_banner') {
    await interaction.deferUpdate();
    const rawInput = interaction.fields.getTextInputValue('banner_input').trim();
    const isRemove = /^remove|none|delete|clear|off$/i.test(rawInput);

    if (!isRemove && !/^https?:\/\/\S+/i.test(rawInput)) {
      await interaction.followUp({
        content: '❌ Masukkan URL gambar yang valid (`https://...`) atau ketik `remove` untuk menghapus banner.',
        ephemeral: true,
      });
      return true;
    }

    const newBanner = isRemove ? null : rawInput;
    db.setUserCustomRole(guildId, ownerId, { ...customData, bannerURL: newBanner });
    db.appendCustomRoleHistory(guildId, ownerId, isRemove ? 'Removed role banner' : 'Changed role banner');

    await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [
        buildRoleUpdatedEmbed(
          `${role} : **Successfully** ${isRemove ? 'removed' : 'changed'} the role banner`,
          newBanner
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  // =================== BUTTON: DESCRIPTION (MODAL) ===================
  if (interaction.isButton() && action === 'btn_desc') {
    const modal = new ModalBuilder()
      .setCustomId(`cr_modal_desc_${ownerId}`)
      .setTitle('Change Custom Role Description');

    const input = new TextInputBuilder()
      .setCustomId('desc_input')
      .setLabel('Description')
      .setValue(customData.description || '')
      .setMaxLength(200)
      .setRequired(true)
      .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal_desc') {
    await interaction.deferUpdate();
    const newDesc = interaction.fields.getTextInputValue('desc_input').trim();
    db.setUserCustomRole(guildId, ownerId, { ...customData, description: newDesc });
    db.appendCustomRoleHistory(guildId, ownerId, 'Updated role description');

    await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** updated the role description`)],
      ephemeral: true,
    });
    return true;
  }

  // =================== BUTTON: HOIST (UNLOCK WITH POINTS OR TOGGLE) ===================
  if (interaction.isButton() && action === 'btn_hoist') {
    await interaction.deferUpdate();

    if (!customData.hoistUnlocked) {
      const pts = db.getPointsData(guildId, ownerId);
      if (pts.balance < cfg.hoistPrice && !isTester) {
        await interaction.followUp({
          content: `🔒 Fitur **Hoist** (tampilkan role terpisah di daftar member) membutuhkan **${cfg.hoistPrice} Poin** untuk di-unlock!\n🪙 Saldo kamu saat ini: **${pts.balance} Poin** *(kurang ${cfg.hoistPrice - pts.balance} Poin)*.`,
          ephemeral: true,
        });
        return true;
      }

      const spendRes = db.spendPoints(guildId, ownerId, cfg.hoistPrice);
      await role.setHoist(true, `Hoist di-unlock oleh ${interaction.user.tag}`).catch(() => {});
      db.setUserCustomRole(guildId, ownerId, {
        ...customData,
        hoistUnlocked: true,
        hoisted: true,
      });
      db.appendCustomRoleHistory(guildId, ownerId, `Unlocked & enabled Hoist (-${cfg.hoistPrice} Poin)`);

      await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
      await interaction.followUp({
        embeds: [
          buildRoleUpdatedEmbed(
            `${role} : **Successfully** unlocked & enabled **Hoist**! (Sisa Poin: **${spendRes.balance} Poin**)`
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    const nextHoist = !role.hoist;
    await role.setHoist(nextHoist, `Toggle hoist oleh ${interaction.user.tag}`).catch(() => {});
    db.setUserCustomRole(guildId, ownerId, { ...customData, hoisted: nextHoist });
    db.appendCustomRoleHistory(guildId, ownerId, `${nextHoist ? 'Enabled' : 'Disabled'} Hoist`);

    await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [
        buildRoleUpdatedEmbed(`${role} : **Successfully** ${nextHoist ? 'enabled' : 'disabled'} role hoist`),
      ],
      ephemeral: true,
    });
    return true;
  }

  // =================== BUTTON: SHARE MENU ===================
  if (interaction.isButton() && action === 'btn_share') {
    const sharedList = (customData.sharedWith || []).map((id) => `<@${id}>`).join(', ') || 'Belum ada';
    const maxShares = customData.maxShares || 0;
    const pts = db.getPointsData(guildId, ownerId);

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('🤝 Share Custom Role')
      .setDescription(
        [
          `**Role:** ${role}`,
          `**Kuota Share:** **${(customData.sharedWith || []).length} / ${maxShares}** slot terpakai`,
          `**Member yang di-share:** ${sharedList}`,
          `**Saldo Poin Kamu:** 🪙 **${pts.balance} Poin**`,
          '',
          maxShares === 0
            ? `🔒 Kamu belum memiliki slot Share (**0 / 0**). Klik tombol di bawah untuk membeli **+1 Slot Share (${cfg.shareSlotPrice} Poin)**!`
            : `Pilih teman di bawah untuk **menambahkan** atau **melepas** role ${role} (atau ketik \`!share @user\` di chat).`,
        ].join('\n')
      );

    const rows = [];
    if (maxShares > 0) {
      const userSelect = new UserSelectMenuBuilder()
        .setCustomId(`cr_select_share_${ownerId}`)
        .setPlaceholder('Pilih member untuk Share / Unshare role ini')
        .setMinValues(1)
        .setMaxValues(1);
      rows.push(new ActionRowBuilder().addComponents(userSelect));
    }

    const buySlotBtn = new ButtonBuilder()
      .setCustomId(`cr_buyslot_${ownerId}`)
      .setLabel(`Beli +1 Slot Share (${cfg.shareSlotPrice} Poin)`)
      .setEmoji('🪙')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(maxShares >= cfg.maxShareSlots);

    rows.push(new ActionRowBuilder().addComponents(buySlotBtn));

    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
    return true;
  }

  // =================== USER SELECT: SHARE / UNSHARE ===================
  if (interaction.isUserSelectMenu() && action === 'select_share') {
    const targetUserId = interaction.values[0];
    if (targetUserId === ownerId) {
      await interaction.reply({ content: '❌ Kamu adalah pemilik role ini (gunakan tombol Equip/Unequip).', ephemeral: true });
      return true;
    }

    const targetMember = guild.members.cache.get(targetUserId)
      || await guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember || targetMember.user.bot) {
      await interaction.reply({ content: '❌ Member tidak valid atau merupakan bot.', ephemeral: true });
      return true;
    }

    const currentShared = new Set(customData.sharedWith || []);
    const alreadyHas = currentShared.has(targetUserId) || targetMember.roles.cache.has(role.id);

    if (alreadyHas) {
      await targetMember.roles.remove(role, `Unshared oleh ${interaction.user.tag}`).catch(() => {});
      currentShared.delete(targetUserId);
      db.setUserCustomRole(guildId, ownerId, {
        ...customData,
        sharedWith: Array.from(currentShared),
      });
      db.appendCustomRoleHistory(guildId, ownerId, `Removed shared role from <@${targetUserId}>`);

      await interaction.update({
        embeds: [buildRoleUpdatedEmbed(`Role ${role} removed from <@${targetUserId}>`)],
        components: [],
      });
      return true;
    }

    // Mau share ke member baru → cek slot
    const maxShares = customData.maxShares || 0;
    if (currentShared.size >= maxShares) {
      const buySlotBtn = new ButtonBuilder()
        .setCustomId(`cr_buyslot_${ownerId}`)
        .setLabel(`Beli +1 Slot Share (${cfg.shareSlotPrice} Poin)`)
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Primary);

      await interaction.update({
        content: `❌ Slot Share kamu sudah penuh (**${currentShared.size} / ${maxShares}**)! Beli slot tambahan terlebih dahulu:`,
        embeds: [],
        components: [new ActionRowBuilder().addComponents(buySlotBtn)],
      });
      return true;
    }

    await targetMember.roles.add(role, `Shared oleh ${interaction.user.tag}`);
    currentShared.add(targetUserId);
    db.setUserCustomRole(guildId, ownerId, {
      ...customData,
      sharedWith: Array.from(currentShared),
    });
    db.appendCustomRoleHistory(guildId, ownerId, `Shared role to <@${targetUserId}>`);

    await interaction.update({
      embeds: [buildRoleUpdatedEmbed(`Role ${role} added to <@${targetUserId}>`)],
      components: [],
    });
    return true;
  }

  // =================== BUTTON: TRANSFER ===================
  if (interaction.isButton() && action === 'btn_transfer') {
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`cr_select_transfer_${ownerId}`)
      .setPlaceholder('Pilih member penerima kepemilikan Custom Role ini')
      .setMinValues(1)
      .setMaxValues(1);

    await interaction.reply({
      content: `⚠️ **Transfer Kepemilikan Custom Role**\nPilih member yang akan menerima kepemilikan penuh atas ${role}:`,
      components: [new ActionRowBuilder().addComponents(userSelect)],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isUserSelectMenu() && action === 'select_transfer') {
    const targetUserId = interaction.values[0];
    if (targetUserId === ownerId) {
      await interaction.reply({ content: '❌ Kamu sudah menjadi pemilik role ini.', ephemeral: true });
      return true;
    }

    const targetMember = guild.members.cache.get(targetUserId)
      || await guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember || targetMember.user.bot) {
      await interaction.reply({ content: '❌ Tidak bisa mentransfer Custom Role ke bot atau user yang tidak ditemukan.', ephemeral: true });
      return true;
    }

    const res = db.transferUserCustomRole(guildId, ownerId, targetUserId);
    if (!res.success) {
      await interaction.update({ content: `❌ ${res.error}`, components: [] });
      return true;
    }

    const ownerMember = guild.members.cache.get(ownerId);
    if (ownerMember && ownerMember.roles.cache.has(role.id)) {
      await ownerMember.roles.remove(role).catch(() => {});
    }
    if (!targetMember.roles.cache.has(role.id)) {
      await targetMember.roles.add(role).catch(() => {});
    }

    await interaction.update({
      content: null,
      embeds: [buildRoleUpdatedEmbed(`${role} : **Successfully** transferred ownership to <@${targetUserId}>`)],
      components: [],
    });
    return true;
  }

  // =================== BUTTON: HISTORY ===================
  if (interaction.isButton() && action === 'btn_history') {
    const history = customData.history || [];
    const lines = history.length > 0
      ? history
          .slice()
          .reverse()
          .map((h) => `• <t:${Math.floor(h.timestamp / 1000)}:R> — ${h.action}`)
          .join('\n')
      : '*Belum ada riwayat perubahan.*';

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`📜 Custom Role History — ${role.name}`)
      .setDescription(lines);

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  // =================== BUTTON: EQUIP / UNEQUIP ===================
  if (interaction.isButton() && action === 'btn_equip') {
    await interaction.deferUpdate();
    const member = guild.members.cache.get(ownerId)
      || await guild.members.fetch(ownerId).catch(() => null);
    if (!member) return true;

    const currentlyEquipped = member.roles.cache.has(role.id);
    if (currentlyEquipped) {
      await member.roles.remove(role, 'Unequipped custom role').catch(() => {});
    } else {
      await member.roles.add(role, 'Equipped custom role').catch(() => {});
    }

    await interaction.editReply(buildCustomRoleInfoPayload(guild, ownerId, 'edit'));
    await interaction.followUp({
      embeds: [
        buildRoleUpdatedEmbed(
          `${role} : **Successfully** ${currentlyEquipped ? 'unequipped' : 'equipped'} your custom role`
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  // =================== BUTTON: DELETE ROLE ===================
  if (interaction.isButton() && action === 'btn_delete') {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cr_confirm_delete_${ownerId}`)
        .setLabel('Ya, Hapus Permanen')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cr_cancel_delete_${ownerId}`)
        .setLabel('Batal')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `⚠️ Apakah kamu yakin ingin menghapus Custom Role ${role} secara permanen?`,
      components: [confirmRow],
      ephemeral: true,
    });
    return true;
  }

  if (interaction.isButton() && action === 'confirm_delete') {
    const roleName = role.name;
    await role.delete(`Dihapus oleh pemilik ${interaction.user.tag}`).catch(() => {});
    db.setUserCustomRole(guildId, ownerId, null);

    await interaction.update({
      content: null,
      embeds: [buildRoleUpdatedEmbed(`**${roleName}** : **Successfully** deleted custom role`)],
      components: [],
    });
    return true;
  }

  if (interaction.isButton() && action === 'cancel_delete') {
    await interaction.update({ content: '✅ Penghapusan dibatalkan.', components: [] });
    return true;
  }

  return false;
}

/**
 * Handle shortcut prefix command cepat di chat:
 * !role, !color, !icon, !share, !unshare, !name, !hoist
 */
async function handleCustomRoleShortcut(message, commandName, args) {
  const guild = message.guild;
  const guildId = guild.id;
  const userId = message.author.id;
  const cfg = db.getCustomRoleConfig(guildId);

  // =================== !shophelp / !rolehelp ===================
  if (commandName === 'shophelp' || commandName === 'rolehelp') {
    const embed = buildShopHelpEmbed(guild, userId);
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    return true;
  }

  // =================== !role / !customrole ===================
  if (commandName === 'role' || commandName === 'customrole' || commandName === 'myrole') {
    if (args[0]?.toLowerCase() === 'help') {
      const embed = buildShopHelpEmbed(guild, userId);
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return true;
    }
    const targetMention = message.mentions.users.first();
    const targetId = targetMention ? targetMention.id : userId;
    const payload = buildCustomRoleInfoPayload(guild, targetId, 'view');
    await message.reply({ ...payload, allowedMentions: { repliedUser: false } });
    return true;
  }

  // Pastikan user punya custom role untuk shortcut edit (!color, !icon, !share, !unshare, !name, !extend)
  const customData = ensureActiveCustomRole(guild, userId);
  const role = customData ? guild.roles.cache.get(customData.roleId) : null;

  if (!customData || !role) {
    const payload = buildCustomRoleInfoPayload(guild, userId, 'view');
    await message.reply({
      content: '❌ Kamu belum memiliki Custom Role aktif (atau masa aktifnya telah habis)! Buat terlebih dahulu di bawah ini:',
      ...payload,
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  // =================== !extend [7d | 14d | 28d] ===================
  if (commandName === 'extend') {
    if (!customData.expiresAt) {
      await message.reply({
        content: `♾️ Custom Role ${role} milikmu sudah berstatus **Permanen**!`,
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    const argPlan = args[0]?.toLowerCase();
    if (!argPlan || !['7d', '7', '14d', '14', '28d', '28', '30d', '30', 'perm', 'permanent'].includes(argPlan)) {
      const pts = db.getPointsData(guildId, userId);
      const expSec = Math.floor(customData.expiresAt / 1000);
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('⏳ Extend Custom Role Duration')
        .setDescription(
          [
            `**Role:** ${role}`,
            `**Berakhir Pada:** <t:${expSec}:R> (<t:${expSec}:f>)`,
            `**Dompet Poin Kamu:** 🪙 **${pts.balance} / ${pts.walletCap} Poin**`,
            `**Batas Tumpuk Durasi:** Maksimal **${cfg.maxDurationDays} Hari**`,
            '',
            'Pilih paket perpanjangan masa aktif di bawah ini (atau ketik `!extend 7d` / `!extend 14d` / `!extend 28d`):',
          ].join('\n')
        );

      const row = buildExtendPlanButtons(guildId, userId, false);
      await message.reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } });
      return true;
    }

    const plan = db.getCustomRolePlanInfo(guildId, argPlan);
    if (!plan.enabled) {
      await message.reply({ content: '❌ Paket durasi tersebut sedang tidak tersedia.', allowedMentions: { repliedUser: false } });
      return true;
    }

    const isTester = db.isRoleTester(userId);
    if (plan.durationMs && !isTester) {
      const now = Date.now();
      const baseTime = customData.expiresAt > now ? customData.expiresAt : now;
      const projectedRemainingDays = Math.ceil((baseTime + plan.durationMs - now) / (24 * 60 * 60 * 1000));
      if (projectedRemainingDays > cfg.maxDurationDays) {
        await message.reply({
          content: `⚠️ Durasi Custom Role tidak bisa ditumpuk melebihi **${cfg.maxDurationDays} Hari**! (Jika ditambah **+${plan.label}**, total sisa durasimu akan menjadi **${projectedRemainingDays} Hari**).`,
          allowedMentions: { repliedUser: false },
        });
        return true;
      }
    }

    const pts = db.getPointsData(guildId, userId);
    if (pts.balance < plan.price && !isTester) {
      await message.reply({
        content: `❌ Poin kamu belum cukup untuk paket **${plan.label}**! Harga: **${plan.price} Poin**, saldo dompetmu: **${pts.balance} / ${pts.walletCap} Poin** *(kurang ${plan.price - pts.balance} Poin)*.`,
        allowedMentions: { repliedUser: false },
      });
      return true;
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
      `${role} : **Successfully** extended role duration (**+${plan.label}**)!\n⏳ Status: ${expMsg} • Sisa Dompet: **${spendRes.balance} / ${pts.walletCap} Poin**`
    );
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    return true;
  }

  // =================== !color #HEX1 [#HEX2] ===================
  if (commandName === 'color') {
    if (args.length === 0) {
      await message.reply({
        content: '💡 Penggunaan: `!color #HEX1` atau `!color #HEX1 #HEX2` (contoh: `!color #FFFFF0 #AA8668`)',
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    const primaryHex = normalizeHexColor(args[0]);
    const sideHex = args[1] ? normalizeHexColor(args[1]) : null;

    if (!primaryHex || (args[1] && !sideHex)) {
      await message.reply({
        content: '❌ Kode warna Hex tidak valid! Contoh: `!color #FFFFF0` atau `!color #FFFFF0 #AA8668`',
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    try {
      await applyRoleColors(guild, role, primaryHex, sideHex, `Diubah oleh ${message.author.tag}`);
      db.setUserCustomRole(guildId, userId, {
        ...customData,
        color: primaryHex,
        sideColor: sideHex,
      });
      const displayStr = sideHex ? `${primaryHex} ${sideHex}` : primaryHex;
      db.appendCustomRoleHistory(guildId, userId, `Changed color to ${displayStr}`);

      const embed = buildRoleUpdatedEmbed(
        `${role} : **Successfully** changed the role color to\n\`\`\`\n${displayStr}\n\`\`\``
      );
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    } catch (err) {
      await message.reply({ content: `❌ Gagal mengubah warna role: ${err.message}`, allowedMentions: { repliedUser: false } });
    }
    return true;
  }

  // =================== !icon [attachment / emoji / url / remove] ===================
  if (commandName === 'icon') {
    const attachment = message.attachments.first();
    const arg = args[0]?.trim();

    // Jika ada gambar yang di-upload bersama pesan !icon (persis Gambar 4)
    if (attachment && attachment.url) {
      try {
        await setRoleIconFromUrl(role, attachment.url, `Diubah oleh ${message.author.tag}`);
        db.setUserCustomRole(guildId, userId, { ...customData, iconURL: attachment.url });
        db.appendCustomRoleHistory(guildId, userId, 'Changed role icon');

        const embed = buildRoleUpdatedEmbed(
          `${role} : **Successfully** changed the role icon`,
          attachment.url
        );
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      } catch (err) {
        await message.reply({ content: `❌ Gagal memasang role icon: ${err.message}`, allowedMentions: { repliedUser: false } });
      }
      return true;
    }

    // Jika argumen berupa emoji atau URL
    const resolvedUrl = resolveIconInputUrl(arg);
    if (resolvedUrl) {
      try {
        await setRoleIconFromUrl(role, resolvedUrl, `Diubah oleh ${message.author.tag}`);
        db.setUserCustomRole(guildId, userId, { ...customData, iconURL: resolvedUrl });
        db.appendCustomRoleHistory(guildId, userId, 'Changed role icon');

        const embed = buildRoleUpdatedEmbed(
          `${role} : **Successfully** changed the role icon`,
          resolvedUrl
        );
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      } catch (err) {
        await message.reply({ content: `❌ Gagal memasang role icon: ${err.message}`, allowedMentions: { repliedUser: false } });
      }
      return true;
    }

    // Jika !icon diketik tanpa gambar/argumen (atau !icon remove) -> hapus role icon saat ini (persis Gambar 4 atas)
    const oldIcon = role.iconURL({ extension: 'png', size: 256 }) || customData.iconURL;
    if (oldIcon || /^remove|none|delete|clear|off$/i.test(arg || '')) {
      await role.setIcon(null).catch(() => {});
      db.setUserCustomRole(guildId, userId, { ...customData, iconURL: null });
      db.appendCustomRoleHistory(guildId, userId, 'Removed role icon');

      const embed = buildRoleUpdatedEmbed(
        `${role} : **Successfully** removed the role icon`,
        oldIcon
      );
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return true;
    }

    await message.reply({
      content: '💡 Kirim `!icon` sambil **melampirkan gambar**, atau `!icon <emoji/url>` untuk memasang icon role!',
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  // =================== !share @user & !unshare @user ===================
  if (commandName === 'share' || commandName === 'unshare') {
    const targetUser = message.mentions.users.first();
    if (!targetUser) {
      await message.reply({
        content: `💡 Penggunaan: \`!${commandName} @user\` (contoh: \`!${commandName} @teman\`)`,
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    if (targetUser.id === userId) {
      await message.reply({ content: '❌ Kamu adalah pemilik role ini.', allowedMentions: { repliedUser: false } });
      return true;
    }

    if (targetUser.bot) {
      await message.reply({ content: '❌ Tidak bisa membagikan Custom Role ke bot.', allowedMentions: { repliedUser: false } });
      return true;
    }

    const targetMember = guild.members.cache.get(targetUser.id)
      || await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await message.reply({ content: '❌ Member tidak ditemukan di server ini.', allowedMentions: { repliedUser: false } });
      return true;
    }

    const syncedData = syncSharedMembers(guild, role, customData);
    const currentShared = new Set(syncedData.sharedWith || []);
    const isUnshare = commandName === 'unshare' || (commandName === 'share' && currentShared.has(targetUser.id) && args[1] === 'remove');

    if (isUnshare) {
      await targetMember.roles.remove(role, `Unshared oleh ${message.author.tag}`).catch(() => {});
      currentShared.delete(targetUser.id);
      db.setUserCustomRole(guildId, userId, {
        ...syncedData,
        sharedWith: Array.from(currentShared),
      });
      db.appendCustomRoleHistory(guildId, userId, `Removed shared role from <@${targetUser.id}>`);

      const embed = buildRoleUpdatedEmbed(`Role ${role} removed from ${targetUser}`);
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return true;
    }

    if (currentShared.has(targetUser.id) && targetMember.roles.cache.has(role.id)) {
      await message.reply({
        content: `ℹ️ ${targetUser} sudah menggunakan role ${role}. Ketik \`!unshare ${targetUser}\` untuk melepasnya.`,
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    const maxShares = syncedData.maxShares || 0;
    if (currentShared.size >= maxShares) {
      const buySlotBtn = new ButtonBuilder()
        .setCustomId(`cr_buyslot_${userId}`)
        .setLabel(`Beli +1 Slot Share (${cfg.shareSlotPrice} Poin)`)
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(maxShares >= cfg.maxShareSlots);

      await message.reply({
        content: `🔒 Slot Share untuk ${role} penuh (**Shared: ${currentShared.size} / ${maxShares}**).\nBeli slot tambahan menggunakan Level Points untuk membagikan role ini ke ${targetUser}:`,
        components: [new ActionRowBuilder().addComponents(buySlotBtn)],
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    try {
      await targetMember.roles.add(role, `Shared oleh ${message.author.tag}`);
      currentShared.add(targetUser.id);
      db.setUserCustomRole(guildId, userId, {
        ...syncedData,
        sharedWith: Array.from(currentShared),
      });
      db.appendCustomRoleHistory(guildId, userId, `Shared role to <@${targetUser.id}>`);

      const embed = buildRoleUpdatedEmbed(`Role ${role} added to ${targetUser}`);
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    } catch (err) {
      await message.reply({ content: `❌ Gagal membagikan role: ${err.message}`, allowedMentions: { repliedUser: false } });
    }
    return true;
  }

  // =================== !name <nama baru> ===================
  if (commandName === 'name') {
    const newName = args.join(' ').trim();
    if (!newName || newName.length > 50 || /^@(everyone|here)$/i.test(newName)) {
      await message.reply({
        content: '💡 Penggunaan: `!name <nama role baru>` (maksimal 50 karakter)',
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    try {
      await role.setName(newName, `Diubah oleh ${message.author.tag}`);
      db.setUserCustomRole(guildId, userId, { ...customData, name: newName });
      db.appendCustomRoleHistory(guildId, userId, `Changed name to "${newName}"`);

      const embed = buildRoleUpdatedEmbed(`${role} : **Successfully** changed the role name to **${newName}**`);
      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    } catch (err) {
      await message.reply({ content: `❌ Gagal mengubah nama role: ${err.message}`, allowedMentions: { repliedUser: false } });
    }
    return true;
  }

  return false;
}

module.exports = {
  normalizeHexColor,
  buildRoleUpdatedEmbed,
  buildShopHelpEmbed,
  buildCustomRoleInfoPayload,
  handleCustomRoleInteraction,
  handleCustomRoleShortcut,
  applyRoleColors,
  positionRoleBelowBot,
  setRoleIconFromUrl,
  ensureActiveCustomRole,
  checkAndCleanupExpiredCustomRoles,
};

