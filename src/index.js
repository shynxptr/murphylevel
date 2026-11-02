const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

// Override token & clientId dari environment variable kalau ada (lebih aman untuk production)
config.token = process.env.BOT_TOKEN || config.token;
config.clientId = process.env.CLIENT_ID || config.clientId;

const { handleMessageCreate, handleVoiceStateUpdate, initVoiceTracking } = require('./utils/xpHandler');
const db = require('./utils/database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
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

  // Auto-sync setiap 15 menit (cek event mulai/berakhir)
  setInterval(() => {
    c.guilds.cache.forEach((guild) => {
      db.syncScheduledEvents(guild.id);
    });
  }, 15 * 60 * 1000);

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
// EVENT: Interaction Create (slash commands)
// ========================
client.on(Events.InteractionCreate, async (interaction) => {
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
// Support: reply(), deferReply(), editReply(), options.getUser(), options.getString()
function createPseudoInteraction(message, args) {
  const command = client.commands.get(message.commandName);
  if (!command) return null;

  // Parse options dari args berdasarkan definisi slash command
  const optionsData = {};
  const rawData = command.data.options || [];

  let argIndex = 0;
  for (const opt of rawData) {
    if (argIndex >= args.length) break;

    if (opt.type === 6) {
      // USER option — parse mention atau raw ID
      const arg = args[argIndex];
      const mentionMatch = arg.match(/^<@!?(\d+)>$/);
      const userId = mentionMatch ? mentionMatch[1] : arg;
      const user = message.client.users.cache.get(userId)
        || message.mentions.users.first();
      if (user) optionsData[opt.name] = user;
      argIndex++;
    } else if (opt.type === 3) {
      // STRING option
      optionsData[opt.name] = args[argIndex];
      argIndex++;
    } else if (opt.type === 4) {
      // INTEGER option
      optionsData[opt.name] = parseInt(args[argIndex], 10);
      argIndex++;
    } else if (opt.type === 5) {
      // BOOLEAN option
      optionsData[opt.name] = args[argIndex] === 'true' || args[argIndex] === '1';
      argIndex++;
    }
  }

  let deferred = false;
  let replied = false;

  return {
    deferred: false,
    options: {
      getUser: (name) => optionsData[name] || message.author,
      getString: (name) => optionsData[name] ?? null,
      getInteger: (name) => optionsData[name] ?? null,
      getBoolean: (name) => optionsData[name] ?? null,
    },
    user: message.author,
    member: message.member,
    guild: message.guild,
    channel: message.channel,
    client: message.client,
    get deferred() { return deferred; },
    async reply(payload) {
      if (replied || deferred) return;
      replied = true;
      if (typeof payload === 'string') {
        await message.reply(payload).catch(() => {});
      } else {
        const content = payload.content || undefined;
        const embeds = payload.embeds || undefined;
        const files = payload.files || undefined;
        await message.reply({ content, embeds, files, allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    },
    async deferReply() {
      if (replied || deferred) return;
      deferred = true;
      // Kirim placeholder yang nanti di-edit
      await message.reply('⏳ Loading...').catch(() => {});
    },
    async editReply(payload) {
      if (typeof payload === 'string') {
        await message.editReply ? message.editReply(payload) : message.channel.send(payload).catch(() => {});
      } else {
        const content = payload.content || undefined;
        const embeds = payload.embeds || undefined;
        const files = payload.files || undefined;
        // Edit pesan placeholder kalau ada, kalau tidak kirim baru
        try {
          const repliedMsg = await message.fetchReference();
          await repliedMsg.edit({ content, embeds, files }).catch(() => {});
        } catch {
          await message.channel.send({ content, embeds, files }).catch(() => {});
        }
      }
    },
  };
}

client.on(Events.MessageCreate, async (message) => {
  // Chat XP handler (selalu jalan)
  handleMessageCreate(message);

  // Prefix command handler
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

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
// EVENT: Guild Create (join new server)
// ========================
client.on(Events.GuildCreate, (guild) => {
  console.log(`\n📥 Bot ditambahkan ke server: ${guild.name} (${guild.memberCount} members)`);
});

// ========================
// Login
// ========================
if (config.token === 'PASTE_TOKEN_BOT_KAMU_DISINI') {
  console.error('\n❌ TOKEN belum diset! Buka config.json dan isi token bot kamu.');
  console.error('   Dapatkan token di: https://discord.com/developers/applications');
  process.exit(1);
}

client.login(config.token);
