const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

// Override token & clientId dari environment variable kalau ada (lebih aman untuk production)
config.token = process.env.BOT_TOKEN || config.token;
config.clientId = process.env.CLIENT_ID || config.clientId;

const {
  handleMessageCreate,
  handleVoiceStateUpdate,
  initVoiceTracking,
  flushActiveVoiceSessions,
} = require('./utils/xpHandler');
const db = require('./utils/database');
const jsonDb = require('./utils/jsonDb');
const staffDb = require('./utils/staffDb');
const { buildDirectoryEmbed, getPresenceEmoji } = require('./commands/staff');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX = config.prefix || '!';

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else {
    console.warn(`⚠️ Command di ${file} tidak punya data/execute yang valid.`);
  }
}

// Helper: Refresh staff directory embed untuk 1 guild
async function refreshGuildDirectoryEmbed(guild) {
  const dirMsg = staffDb.getDirectoryMessage(guild.id);
  if (!dirMsg) return;

  try {
    const channel = guild.channels.cache.get(dirMsg.channelId);
    if (!channel) {
      staffDb.clearDirectoryMessage(guild.id);
      return;
    }
    const msg = await channel.messages.fetch(dirMsg.messageId).catch(() => null);
    if (!msg) {
      staffDb.clearDirectoryMessage(guild.id);
      return;
    }
    const { embed, components } = await buildDirectoryEmbed(guild);
    await msg.edit({ embeds: [embed], components });
  } catch {
    // Silent fail — jangan spam console
  }
}

// Debounce map untuk PresenceUpdate per guild (mencegah rate limit Discord)
const directoryUpdateTimers = new Map();
function scheduleDirectoryRefresh(guild) {
  if (directoryUpdateTimers.has(guild.id)) return;
  const timer = setTimeout(async () => {
    directoryUpdateTimers.delete(guild.id);
    await refreshGuildDirectoryEmbed(guild);
  }, 5000);
  directoryUpdateTimers.set(guild.id, timer);
}

// ========================
// EVENT: Ready
// ========================
client.once(Events.ClientReady, async (c) => {
  console.log(`\n🤖 Bot ${c.user.tag} sudah online!`);
  console.log(`📊 Server: ${c.guilds.cache.size}`);

  // Init voice tracking untuk user yang sudah di voice channel saat bot start
  initVoiceTracking(c);

  // Sync scheduled events untuk semua guild saat startup
  console.log('\n⚡ Syncing scheduled events...');
  c.guilds.cache.forEach((guild) => {
    const result = db.syncScheduledEvents(guild.id);
    if (result.changed) {
      if (result.action === 'start') {
        console.log(`  ⚡ ${guild.name}: Event aktif — ${result.multiplier}x XP (${result.reason})`);
      } else {
        console.log(`  ✅ ${guild.name}: Event berakhir — kembali ke 1x XP`);
      }
    }
  });

  // Auto-sync scheduled events setiap 15 menit (cek event mulai/berakhir)
  setInterval(() => {
    c.guilds.cache.forEach((guild) => {
      db.syncScheduledEvents(guild.id);
    });
  }, 15 * 60 * 1000);

  // Checkpoint berkala voice XP setiap 5 menit (agar voice XP tersimpan walau user belum leave)
  setInterval(() => {
    flushActiveVoiceSessions(c).catch((err) => console.error('❌ Error flushing voice sessions:', err));
  }, 5 * 60 * 1000);

  // Auto-refresh staff directory embed setiap 2 menit (update status indikator)
  setInterval(async () => {
    for (const guild of c.guilds.cache.values()) {
      await refreshGuildDirectoryEmbed(guild);
    }
  }, 2 * 60 * 1000);

  // Cek & hapus otomatis Custom Role yang masa aktifnya sudah habis (expired) saat startup & tiap 1 menit
  checkAndCleanupExpiredCustomRoles(c).catch((err) => console.error('❌ Error checking expired custom roles:', err));
  setInterval(() => {
    checkAndCleanupExpiredCustomRoles(c).catch((err) => console.error('❌ Error checking expired custom roles:', err));
  }, 60 * 1000);

  // Register slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    const commandsData = client.commands.map((cmd) => cmd.data.toJSON());

    console.log('\n🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(config.clientId), { body: commandsData });
    console.log(`✅ Berhasil register ${commandsData.length} slash commands!`);
  } catch (err) {
    console.error('❌ Gagal register commands:', err);
  }

  // Set activity
  c.user.setActivity('📊 Chat & Voice Levels', { type: 3 }); // Watching
});

// ========================
// EVENT: Interaction Create (slash commands, autocomplete, components)
// ========================
const { handleDirectorySelect, handleProfileButton } = require('./utils/staffComponents');
const {
  handleCustomRoleInteraction,
  handleCustomRoleShortcut,
  checkAndCleanupExpiredCustomRoles,
} = require('./utils/customRoleComponents');

client.on(Events.InteractionCreate, async (interaction) => {
  // Custom Role Panel Interactions (button, modal, user select menu dengan prefix "cr_")
  if (
    (interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu()) &&
    interaction.customId?.startsWith('cr_')
  ) {
    try {
      await handleCustomRoleInteraction(interaction);
    } catch (err) {
      console.error('❌ Error custom role interaction:', err);
    }
    return;
  }

  // Autocomplete (untuk division option di /staff dan /staff-division)
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command && command.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`❌ Error autocomplete ${interaction.commandName}:`, err);
      }
    }
    return;
  }

  // Component interactions (dropdown, button)
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'staff_directory_select') {
      try {
        await handleDirectorySelect(interaction);
      } catch (err) {
        console.error('❌ Error directory select:', err);
      }
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'staff_profile_btn') {
      try {
        await handleProfileButton(interaction);
      } catch (err) {
        console.error('❌ Error profile button:', err);
      }
      return;
    }
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Error di command ${interaction.commandName}:`, err);

    const errorMsg = '❌ Ada error saat menjalankan command ini.';
    if (interaction.deferred) {
      await interaction.editReply(errorMsg).catch(() => {});
    } else {
      await interaction.reply({ content: errorMsg, ephemeral: true }).catch(() => {});
    }
  }
});

// ========================
// EVENT: Message Create (chat XP + prefix commands)
// ========================

// Buat pseudo-interaction supaya command slash bisa dipakai via prefix.
function createPseudoInteraction(message, args) {
  const command = client.commands.get(message.commandName);
  if (!command) return null;

  const optionsData = {};
  let subcommandName = null;
  let rawOptions = command.data.options || [];
  let argIndex = 0;

  // Cek apakah command menggunakan subcommand (type === 1 atau SubcommandBuilder)
  const firstOptJson = rawOptions[0]?.toJSON ? rawOptions[0].toJSON() : rawOptions[0];
  if (firstOptJson && firstOptJson.type === 1) {
    const candidateSub = args[0]?.toLowerCase();
    const matchedSub = rawOptions
      .map((o) => (o.toJSON ? o.toJSON() : o))
      .find((o) => o.type === 1 && o.name === candidateSub);

    if (matchedSub) {
      subcommandName = matchedSub.name;
      rawOptions = matchedSub.options || [];
      argIndex = 1;
    } else {
      subcommandName = firstOptJson.name;
      rawOptions = firstOptJson.options || [];
    }
  }

  for (const rawOpt of rawOptions) {
    if (argIndex >= args.length) break;
    const opt = rawOpt.toJSON ? rawOpt.toJSON() : rawOpt;
    const arg = args[argIndex];

    if (opt.type === 6) {
      // USER option — hanya konsumsi argumen jika benar-benar mention atau user ID
      const mentionMatch = arg.match(/^<@!?(\d+)>$/);
      const idMatch = arg.match(/^(\d{17,20})$/);
      const userId = mentionMatch ? mentionMatch[1] : idMatch ? idMatch[1] : null;
      if (userId) {
        const user = message.client.users.cache.get(userId) || message.mentions.users.first();
        if (user) optionsData[opt.name] = user;
        argIndex++;
      }
    } else if (opt.type === 8) {
      // ROLE option
      const roleMatch = arg.match(/^<@&(\d+)>$/) || arg.match(/^(\d{17,20})$/);
      if (roleMatch) {
        const role = message.guild.roles.cache.get(roleMatch[1]);
        if (role) optionsData[opt.name] = role;
        argIndex++;
      }
    } else if (opt.type === 7) {
      // CHANNEL option
      const chanMatch = arg.match(/^<#(\d+)>$/) || arg.match(/^(\d{17,20})$/);
      if (chanMatch) {
        const channel = message.guild.channels.cache.get(chanMatch[1]);
        if (channel) optionsData[opt.name] = channel;
        argIndex++;
      }
    } else if (opt.type === 3) {
      // STRING option
      optionsData[opt.name] = arg;
      argIndex++;
    } else if (opt.type === 4) {
      // INTEGER option
      const parsed = parseInt(arg, 10);
      if (!Number.isNaN(parsed)) {
        optionsData[opt.name] = parsed;
        argIndex++;
      }
    } else if (opt.type === 5) {
      // BOOLEAN option
      optionsData[opt.name] = arg === 'true' || arg === '1';
      argIndex++;
    }
  }

  let deferred = false;
  let replied = false;
  let sentReply = null;

  return {
    options: {
      getSubcommand: () => subcommandName,
      getUser: (name) => optionsData[name] ?? null,
      getRole: (name) => optionsData[name] ?? null,
      getChannel: (name) => optionsData[name] ?? null,
      getString: (name) => optionsData[name] ?? null,
      getInteger: (name) => optionsData[name] ?? null,
      getBoolean: (name) => optionsData[name] ?? null,
    },
    user: message.author,
    member: message.member,
    guild: message.guild,
    channel: message.channel,
    client: message.client,
    get deferred() {
      return deferred;
    },
    async reply(payload) {
      if (replied || deferred) return sentReply;
      replied = true;
      if (typeof payload === 'string') {
        sentReply = await message.reply(payload).catch(() => null);
      } else {
        const { content, embeds, files, components } = payload;
        sentReply = await message
          .reply({ content, embeds, files, components, allowedMentions: { repliedUser: false } })
          .catch(() => null);
      }
      return sentReply;
    },
    async deferReply() {
      if (replied || deferred) return sentReply;
      deferred = true;
      sentReply = await message
        .reply({ content: '⏳ Loading...', allowedMentions: { repliedUser: false } })
        .catch(() => null);
      return sentReply;
    },
    async editReply(payload) {
      const normalized = typeof payload === 'string'
        ? { content: payload }
        : {
            content: payload.content ?? null,
            embeds: payload.embeds,
            files: payload.files,
            components: payload.components,
          };

      if (sentReply) {
        const edited = await sentReply.edit(normalized).catch(() => null);
        if (edited) return edited;
      }
      sentReply = await message.channel.send(normalized).catch(() => null);
      return sentReply;
    },
  };
}

client.on(Events.MessageCreate, async (message) => {
  // Chat XP handler (selalu jalan)
  handleMessageCreate(message).catch((err) => console.error('❌ Error di handleMessageCreate:', err));

  // Prefix command handler
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  // Shortcut Custom Role (!role, !color, !icon, !share, !unshare, !name, !extend, !shophelp, !rolehelp)
  if (['role', 'customrole', 'myrole', 'color', 'icon', 'share', 'unshare', 'name', 'extend', 'shophelp', 'rolehelp'].includes(commandName)) {
    try {
      await handleCustomRoleShortcut(message, commandName, args);
    } catch (err) {
      console.error(`❌ Error di shortcut !${commandName}:`, err);
    }
    return;
  }

  const command = client.commands.get(commandName);
  if (!command) return;

  message.commandName = commandName;

  const interaction = createPseudoInteraction(message, args);
  if (!interaction) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ Error di prefix command !${commandName}:`, err);
    const errorMsg = '❌ Ada error saat menjalankan command ini.';
    if (interaction.deferred) {
      await interaction.editReply(errorMsg).catch(() => {});
    } else {
      await interaction.reply({ content: errorMsg }).catch(() => {});
    }
  }
});

// ========================
// EVENT: Voice State Update (voice XP)
// ========================
client.on(Events.VoiceStateUpdate, handleVoiceStateUpdate);

// ========================
// EVENT: Presence Update (refresh staff directory saat staff online/offline)
// ========================
client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  if (!newPresence?.guild) return;

  // Abaikan perubahan aktivitas (Spotify/game/custom status) jika indikator online/offline tidak berubah
  const oldEmoji = getPresenceEmoji(oldPresence?.status);
  const newEmoji = getPresenceEmoji(newPresence?.status);
  if (oldEmoji === newEmoji) return;

  const guildId = newPresence.guild.id;
  const userId = newPresence.userId;

  // Cek apakah user ini staff & ada directory embed aktif
  if (!staffDb.getDirectoryMessage(guildId)) return;
  if (!staffDb.getStaff(guildId, userId)) return;

  // Debounce refresh agar tidak terkena rate limit Discord
  scheduleDirectoryRefresh(newPresence.guild);
});

// ========================
// EVENT: Guild Create (join new server)
// ========================
client.on(Events.GuildCreate, (guild) => {
  console.log(`\n📥 Bot ditambahkan ke server: ${guild.name} (${guild.memberCount} members)`);
});

// Graceful shutdown: flush voice sessions & save DB
async function handleShutdown() {
  try {
    await flushActiveVoiceSessions(client, true);
  } catch {}
  jsonDb.saveSync();
  process.exit(0);
}
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// ========================
// Login
// ========================
if (config.token === 'PASTE_TOKEN_BOT_KAMU_DISINI') {
  console.error('\n❌ TOKEN belum diset! Buka config.json dan isi token bot kamu.');
  console.error('   Dapatkan token di: https://discord.com/developers/applications');
  process.exit(1);
}

client.login(config.token);
