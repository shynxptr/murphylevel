// Handler untuk komponen interaktif staff directory (dropdown + button)
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const staffDb = require('./staffDb');
const { buildDirectoryEmbed, getPresenceEmoji } = require('../commands/staff');

/**
 * Handle dropdown select menu "staff_directory_select"
 */
async function handleDirectorySelect(interaction) {
  const guildId = interaction.guild.id;
  const value = interaction.values[0];

  if (value === 'all') {
    // Tampilkan semua divisi (embed default)
    const { embed, components } = await buildDirectoryEmbed(interaction.guild);
    await interaction.update({ embeds: [embed], components });
    return;
  }

  // Filter: tampilkan satu divisi saja
  const divName = value.replace('div_', '');
  const members = staffDb.getStaffByDivision(guildId, divName);

  const allStaff = staffDb.getAllStaff(guildId);
  const totalStaff = staffDb.getStaffCount(guildId);
  const activeDivisions = allStaff.filter((d) => d.members.length > 0).length;
  const divNames = staffDb.getDivisionNames(guildId);

  let activeStaff = 0;
  for (const member of members) {
    const m = interaction.guild.members.cache.get(member.userId);
    if (m?.presence?.status && m.presence.status !== 'offline') activeStaff++;
  }

  const embed = new EmbedBuilder()
    .setTitle(`. MURPHY DIRECTORY — ${divName}`)
    .setColor(0x9b59b6)
    .setDescription(`Filtered view: **${divName}** division`)
    .addFields({
      name: 'METRICS',
      value: [
        `**Staff:** ${activeStaff}/${members.length} active`,
        `**Divisions:** ${activeDivisions}/${divNames.length} active`,
      ].join('\n'),
    })
    .setThumbnail(interaction.guild.iconURL({ size: 128 }))
    .setTimestamp();

  if (members.length === 0) {
    embed.addFields({ name: divName, value: '```\n — No staff assigned —\n```' });
  } else {
    const lines = members.map((member) => {
      const m = interaction.guild.members.cache.get(member.userId);
      const emoji = getPresenceEmoji(m?.presence?.status);
      const displayName = m?.displayName || member.userId;
      const titleSuffix = member.title ? ` — ${member.title}` : '';
      return `${emoji}  **${displayName}**${titleSuffix}`;
    });
    embed.addFields({ name: `${divName}  (${members.length})`, value: lines.join('\n') });
  }

  embed.setFooter({ text: `MURPHY DIRECTORY • Filtered: ${divName}` });

  // Rebuild dropdown dengan selected value
  const selectOptions = [
    { label: '📋 Semua Divisi', value: 'all', description: 'Tampilkan semua staff' },
    ...divNames.map((d) => ({ label: d, value: `div_${d}`, default: d === divName })),
  ];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('staff_directory_select')
    .setPlaceholder('Tampilkan Semua Divisi')
    .addOptions(selectOptions.slice(0, 25));

  const row1 = new ActionRowBuilder().addComponents(selectMenu);
  const profileButton = new ButtonBuilder()
    .setCustomId('staff_profile_btn')
    .setLabel('My Staff Profile')
    .setStyle(ButtonStyle.Secondary);
  const row2 = new ActionRowBuilder().addComponents(profileButton);

  await interaction.update({ embeds: [embed], components: [row1, row2] });
}

/**
 * Handle button "staff_profile_btn"
 */
async function handleProfileButton(interaction) {
  const guildId = interaction.guild.id;
  const staff = staffDb.getStaff(guildId, interaction.user.id);

  if (!staff) {
    await interaction.reply({ content: '❌ Kamu bukan staff di directory ini.', ephemeral: true });
    return;
  }

  const member = interaction.member;
  const statusEmoji = getPresenceEmoji(member?.presence?.status);

  const embed = new EmbedBuilder()
    .setTitle(`👤 Staff Profile — ${interaction.user.username}`)
    .setColor(0x9b59b6)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Status', value: `${statusEmoji} ${member?.presence?.status || 'offline'}`, inline: true },
      { name: 'Divisi', value: staff.division, inline: true },
      { name: 'Title', value: staff.title || '—', inline: true },
      { name: 'Join Server', value: member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : '—', inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
  handleDirectorySelect,
  handleProfileButton,
};
