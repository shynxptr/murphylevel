const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { parseBratArgs, generateBratPng, generateBratGif } = require('../utils/bratGenerator');

/**
 * Handler untuk command chat langsung seperti:
 * - fbratt <teks> / !bratt <teks>
 * - fbrattgif <teks> / !brattgif <teks>
 */
async function handleBratMessageCommand(message, rawInput, forceGif = false) {
  let { text, theme, isGif } = parseBratArgs(rawInput, forceGif);

  // Jika user tidak mengetik teks tapi me-reply pesan orang lain, ambil teks dari pesan yang di-reply!
  if (!text && message.reference?.messageId) {
    const repliedMsg = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);
    if (repliedMsg && repliedMsg.content) {
      text = repliedMsg.content.trim();
    }
  }

  if (!text) {
    return message.reply({
      content:
        '🟩 **Cara Pakai Brat Generator:**\n' +
        '• `fbratt <teks>` — Buat gambar Brat background putih\n' +
        '• `fbratt --green <teks>` — Buat gambar Brat warna **Hijau Lime**\n' +
        '• `fbratt --hitam <teks>` — Buat gambar Brat warna **Hitam**\n' +
        '• `fbrattgif <teks>` atau `fbratt --gif <teks>` — Buat **Animasi GIF** kata per kata\n' +
        '*(Tips: Kamu juga bisa reply chat orang lain lalu ketik `fbratt`!)*',
      allowedMentions: { repliedUser: false },
    });
  }

  const cleanText = text.slice(0, 250);

  try {
    await message.channel.sendTyping().catch(() => {});

    const buffer = isGif
      ? generateBratGif(cleanText, theme)
      : generateBratPng(cleanText, theme);

    const ext = isGif ? 'gif' : 'png';
    const attachment = new AttachmentBuilder(buffer, { name: `brat.${ext}` });

    await message.reply({
      files: [attachment],
      allowedMentions: { repliedUser: false },
    });
  } catch (err) {
    console.error('❌ Error generating brat:', err);
    await message
      .reply({
        content: '❌ Gagal membuat gambar Brat. Coba lagi dengan teks yang lebih pendek.',
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bratt')
    .setDescription('Buat gambar atau animasi stiker Brat dari teks kamu')
    .addStringOption((opt) =>
      opt
        .setName('teks')
        .setDescription('Teks yang ingin dijadikan Brat (maks 250 karakter)')
        .setRequired(true)
        .setMaxLength(250)
    )
    .addStringOption((opt) =>
      opt
        .setName('warna')
        .setDescription('Pilih warna background Brat (Default: Putih)')
        .setRequired(false)
        .addChoices(
          { name: '⬜ Putih (Classic WA/Discord)', value: 'white' },
          { name: '🟩 Hijau Lime (Charli XCX BRAT)', value: 'green' },
          { name: '⬛ Hitam (Dark Mode)', value: 'black' },
          { name: '🩷 Pink (Brat Remix)', value: 'pink' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('format')
        .setDescription('Pilih gambar statis (PNG) atau animasi kata per kata (GIF)')
        .setRequired(false)
        .addChoices(
          { name: '🖼️ Gambar Statis (PNG)', value: 'png' },
          { name: '🎞️ Animasi Kata per Kata (GIF)', value: 'gif' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const rawText = interaction.options.getString('teks') || '';
    const warnaOpt = interaction.options.getString('warna');
    const formatOpt = interaction.options.getString('format');

    const parsed = parseBratArgs(rawText, formatOpt === 'gif');
    const finalTheme = warnaOpt || parsed.theme || 'white';
    const finalGif = formatOpt ? formatOpt === 'gif' : parsed.isGif;
    const cleanText = (parsed.text || rawText).trim().slice(0, 250);

    if (!cleanText) {
      return interaction.editReply('❌ Teks tidak boleh kosong!');
    }

    const buffer = finalGif
      ? generateBratGif(cleanText, finalTheme)
      : generateBratPng(cleanText, finalTheme);

    const ext = finalGif ? 'gif' : 'png';
    const attachment = new AttachmentBuilder(buffer, { name: `brat.${ext}` });

    await interaction.editReply({ files: [attachment] });
  },

  handleBratMessageCommand,
};
