// Test script untuk generate animated GIF level up card
// Output: test/levelup-chat.gif & test/levelup-voice.gif

const { createLevelUpGIF } = require('../src/utils/levelUpCard');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('🎬 Generating animated level up GIFs...\n');

  const dummyAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

  // === Chat Level Up GIF ===
  console.log('  Generating chat level up GIF (LV 4 -> LV 5)...');
  const chatGif = await createLevelUpGIF({
    username: 'MurphyPlayer',
    avatarURL: dummyAvatar,
    oldLevel: 4,
    newLevel: 5,
    type: 'chat',
  });
  const chatPath = path.join(__dirname, 'levelup-chat.gif');
  fs.writeFileSync(chatPath, chatGif);
  console.log(`  OK Saved: ${chatPath} (${(chatGif.length / 1024).toFixed(1)} KB)`);

  // === Voice Level Up GIF ===
  console.log('  Generating voice level up GIF (LV 7 -> LV 8)...');
  const voiceGif = await createLevelUpGIF({
    username: 'MurphyPlayer',
    avatarURL: dummyAvatar,
    oldLevel: 7,
    newLevel: 8,
    type: 'voice',
  });
  const voicePath = path.join(__dirname, 'levelup-voice.gif');
  fs.writeFileSync(voicePath, voiceGif);
  console.log(`  OK Saved: ${voicePath} (${(voiceGif.length / 1024).toFixed(1)} KB)`);

  // === High level chat ===
  console.log('  Generating high-level chat GIF (LV 14 -> LV 15)...');
  const proGif = await createLevelUpGIF({
    username: 'ProGamer123',
    avatarURL: dummyAvatar,
    oldLevel: 14,
    newLevel: 15,
    type: 'chat',
  });
  const proPath = path.join(__dirname, 'levelup-chat-high.gif');
  fs.writeFileSync(proPath, proGif);
  console.log(`  OK Saved: ${proPath} (${(proGif.length / 1024).toFixed(1)} KB)`);

  console.log('\nDone! Buka file .gif di folder test/ untuk lihat animasinya.');
  console.log('   Buka di browser atau image viewer yang support GIF animation.');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
