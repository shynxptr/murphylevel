// Script test untuk generate rank card dengan dummy data
// Output: test-chat-rank.png & test-voice-rank.png

const { createRankCard } = require('../src/utils/rankCard');
const { getXPNeeded } = require('../src/utils/database');
const fs = require('fs');
const path = require('path');

// Dummy member object (mock Discord GuildMember)
function createDummyMember(username, avatarURL) {
  return {
    displayName: username,
    user: {
      username: username,
      displayAvatarURL: () => avatarURL,
    },
    id: '123456789012345678',
  };
}

async function run() {
  console.log('🎨 Generating dummy rank cards...\n');

  // Dummy avatar (Discord default avatar)
  const dummyAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

  // === Chat Level Card (low level) ===
  const chatMember = createDummyMember('MurphyPlayer', dummyAvatar);
  const chatData = {
    xp: 25,
    level: 5,
    messages: 127,
    streak: 4,
    streakMultiplier: 1.33,
    rank: 3,
    totalUsers: 25,
  };
  const chatXpNeeded = getXPNeeded(5);

  const chatCard = await createRankCard(chatMember, chatData, 'chat', chatXpNeeded);
  const chatPath = path.join(__dirname, 'test-chat-rank.png');
  fs.writeFileSync(chatPath, chatCard);
  console.log(`✅ Chat rank card saved: ${chatPath}`);

  // === Voice Level Card ===
  const voiceMember = createDummyMember('MurphyPlayer', dummyAvatar);
  const voiceData = {
    xp: 30,
    level: 8,
    minutes: 95,
    streak: 7,
    streakMultiplier: 1.67,
    rank: 1,
    totalUsers: 25,
  };
  const voiceXpNeeded = getXPNeeded(8);

  const voiceCard = await createRankCard(voiceMember, voiceData, 'voice', voiceXpNeeded);
  const voicePath = path.join(__dirname, 'test-voice-rank.png');
  fs.writeFileSync(voicePath, voiceCard);
  console.log(`✅ Voice rank card saved: ${voicePath}`);

  // === Chat Level Card (high level) ===
  const proMember = createDummyMember('ProGamer123', dummyAvatar);
  const proData = {
    xp: 200,
    level: 150,
    messages: 5892,
    streak: 15,
    streakMultiplier: 3,
    rank: 1,
    totalUsers: 500,
  };
  const proXpNeeded = getXPNeeded(150);

  const proCard = await createRankCard(proMember, proData, 'chat', proXpNeeded);
  const proPath = path.join(__dirname, 'test-chat-rank-high.png');
  fs.writeFileSync(proPath, proCard);
  console.log(`✅ High-level chat rank card saved: ${proPath}`);

  console.log('\n🎉 Done! Buka file PNG di folder test/ untuk lihat hasilnya.');
}

run().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
