const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { buildShopHelpEmbed } = require('../utils/customRoleComponents');

/**
 * Bangun Embed Panduan Umum Semua Fitur Bot (Leveling + Role Shop + Staff)
 */
function buildGeneralHelpEmbed(guild) {
  return new EmbedBuilder()
    .setColor(0x0f3460)
    .setTitle('📚 Pusat Bantuan — Murphy Level & Role Shop Bot')
    .setDescription(
      'Selamat datang di **Murphy Bot**! Gunakan perintah Slash (`/`) atau Prefix (`!`) di bawah ini:'
    )
    .setThumbnail(guild?.iconURL({ size: 128 }) || null)
    .addFields(
      {
        name: '🏪 Role Shop & Custom Role (Level Points)',
        value: [
          '• `!role` / `/roleshop role` — Buka panel interaktif **Custom Role Information**',
          '• `!shophelp` / `/roleshop help` — **Panduan lengkap Poin, Paket Durasi (7/14/28 Hari), & Shortcut**',
          '• `/roleshop view` — Lihat katalog toko role, harga paket, & kuota slot server',
          '• `/roleshop points` — Cek isi dompet poin (Maks **75 Poin**) & sumber poinmu',
          '• `!color`, `!icon`, `!name`, `!share`, `!unshare`, `!extend` — Shortcut cepat edit Custom Role',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📊 Leveling, Rank & Leaderboard (Unlimited Level)',
        value: [
          '• `/rank` atau `!rank` — Lihat kartu visual Rank Chat, Voice, atau Overall',
          '• `/status` atau `!status` — Lihat statistik lengkap XP, Streak, Estimasi Level, & Poin',
          '• `/level` atau `!level` — Lihat ringkasan cepat level & dompet poin dalam teks',
          '• `/leaderboard` atau `!leaderboard` — Papan peringkat Top 10 Chat, Voice, & Overall',
          '• `/rewards` atau `!rewards` — Daftar role hadiah otomatis saat naik level tertentu',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚙️ Pengaturan Admin',
        value: [
          '• `/setshop custom-config` — Atur harga paket 7d/14d/28d, limit dompet, kuota role server, & syarat level',
          '• `/setshop add-role` / `remove-role` / `give-points` / `take-points` — Kelola toko & poin user',
          '• `/setreward`, `/setmultiplier`, `/setevent`, `/setlevelchannel` — Konfigurasi sistem XP & Level',
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: 'Klik tombol "📖 Panduan Role Shop" di bawah untuk melihat detail sistem Poin & Custom Role!' })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lihat panduan penggunaan Role Shop, Custom Role, Level Points, dan daftar command bot')
    .addStringOption((opt) =>
      opt
        .setName('topik')
        .setDescription('Pilih topik panduan yang ingin ditampilkan')
        .setRequired(false)
        .addChoices(
          { name: '🏪 Role Shop, Level Points & Custom Role (Lengkap)', value: 'shop' },
          { name: '📚 Semua Command Bot (Leveling, Shop & Admin)', value: 'all' }
        )
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const userId = interaction.user.id;
    const rawTopic = (interaction.options.getString('topik') || 'shop').toLowerCase();

    const isAll = ['all', 'umum', 'general', 'level', 'leveling'].includes(rawTopic);
    const embed = isAll
      ? buildGeneralHelpEmbed(guild)
      : buildShopHelpEmbed(guild, userId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cr_btn_help_${userId}`)
        .setLabel('Panduan Role Shop & Custom Role')
        .setEmoji('📖')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`cr_btn_points_${userId}`)
        .setLabel('Cek Dompet Poin Saya')
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};

