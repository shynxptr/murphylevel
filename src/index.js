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
// EVENT: Message Create (chat XP)
// ========================
client.on(Events.MessageCreate, handleMessageCreate);

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
