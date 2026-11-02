const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/database');

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setevent')
    .setDescription('Atur scheduled XP event (recurring weekly) — hanya admin')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambah scheduled event baru')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Nama event, misal "Double XP Weekend"').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('multiplier')
            .setDescription('Multiplier: 2 = double, 3 = triple')
            .setMinValue(2).setMaxValue(10).setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('day')
            .setDescription('Hari: 0=Minggu, 1=Senin, 2=Selasa, ... 6=Sabtu')
            .setMinValue(0).setMaxValue(6).setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('start')
            .setDescription('Jam mulai (0-23), misal 0 = tengah malam')
            .setMinValue(0).setMaxValue(23).setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('end')
            .setDescription('Jam selesai (0-23). Kalau < start, berarti sampai besok')
            .setMinValue(0).setMaxValue(23).setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Lihat semua scheduled events')
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Enable/disable scheduled event')
        .addStringOption((opt) =>
          opt.setName('id').setDescription('Event ID (lihat dari /setevent list)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Hapus scheduled event')
        .addStringOption((opt) =>
          opt.setName('id').setDescription('Event ID (lihat dari /setevent list)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('sync').setDescription('Sync sekarang — cek & aktifkan event yang seharusnya jalan')
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const name = interaction.options.getString('name');
      const multiplier = interaction.options.getInteger('multiplier');
      const day = interaction.options.getInteger('day');
      const start = interaction.options.getInteger('start');
      const end = interaction.options.getInteger('end');

      const id = db.addScheduledEvent(guildId, {
        name, multiplier, dayOfWeek: day, startHour: start, endHour: end,
      });

      db.syncScheduledEvents(guildId);

      const timeRange = end > start ? `${start}:00 - ${end}:00` : `${start}:00 - ${end}:00 (besok)`;
      await interaction.reply({
        content: `✅ **Scheduled Event Dibuat!**\n\n📋 ID: \`${id}\`\n📝 Nama: **${name}**\n⚡ Multiplier: **${multiplier}x XP**\n📅 Hari: **${DAYS[day]}**\n⏰ Jam: **${timeRange}**\n\nEvent akan otomatis aktif setiap ${DAYS[day]} jam ${start}:00.`,
        ephemeral: true,
      });
    }

    else if (sub === 'list') {
      const events = db.getScheduledEvents(guildId);

      if (events.length === 0) {
        return interaction.reply({
          content: '📭 Belum ada scheduled event.\nTambah dengan `/setevent add`.',
          ephemeral: true,
        });
      }

      const lines = events.map((e) => {
        const status = e.enabled ? '✅' : '❌';
        const timeRange = e.endHour > e.startHour
          ? `${e.startHour}:00-${e.endHour}:00`
          : `${e.startHour}:00-${e.endHour}:00 (besok)`;
        return `${status} \`${e.id}\` — **${e.name}** | ${e.multiplier}x | ${DAYS[e.dayOfWeek]} ${timeRange}`;
      });

      await interaction.reply({
        content: `📋 **Scheduled Events** (${events.length})\n\n${lines.join('\n')}\n\nGunakan \`/setevent toggle\` untuk enable/disable, \`/setevent remove\` untuk hapus.`,
        ephemeral: true,
      });
    }

    else if (sub === 'toggle') {
      const id = interaction.options.getString('id');
      const events = db.getScheduledEvents(guildId);
      const evt = events.find((e) => e.id === id);

      if (!evt) {
        return interaction.reply({
          content: `❌ Event dengan ID \`${id}\` tidak ditemukan.`,
          ephemeral: true,
        });
      }

      db.updateScheduledEvent(guildId, id, { enabled: !evt.enabled });
      db.syncScheduledEvents(guildId);

      await interaction.reply({
        content: `${evt.enabled ? '🔇 Disabled' : '✅ Enabled'} event **${evt.name}**`,
        ephemeral: true,
      });
    }

    else if (sub === 'remove') {
      const id = interaction.options.getString('id');
      const events = db.getScheduledEvents(guildId);
      const evt = events.find((e) => e.id === id);

      if (!evt) {
        return interaction.reply({
          content: `❌ Event dengan ID \`${id}\` tidak ditemukan.`,
          ephemeral: true,
        });
      }

      db.removeScheduledEvent(guildId, id);
      db.syncScheduledEvents(guildId);

      await interaction.reply({
        content: `🗑️ Event **${evt.name}** telah dihapus.`,
        ephemeral: true,
      });
    }

    else if (sub === 'sync') {
      const result = db.syncScheduledEvents(guildId);

      if (!result.changed) {
        const { multiplier, reason } = db.getMultiplier(guildId);
        if (multiplier > 1) {
          return interaction.reply({
            content: `ℹ️ Tidak ada perubahan. Multiplier saat ini: **${multiplier}x** (${reason || 'manual'}).`,
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: 'ℹ️ Tidak ada perubahan. Saat ini: **Normal (1x XP)**.',
          ephemeral: true,
        });
      }

      if (result.action === 'start') {
        await interaction.reply({
          content: `⚡ **Event Dimulai!**\n\n⚡ Multiplier: **${result.multiplier}x XP**\n📝 Event: **${result.reason}**`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `✅ **Event Selesai**\n\nMultiplier dikembalikan ke **normal (1x XP)**.\n📝 Event yang berakhir: **${result.reason}**`,
          ephemeral: true,
        });
      }
    }
  },
};