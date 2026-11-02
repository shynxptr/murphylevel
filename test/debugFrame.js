// Debug: render single frame as PNG to inspect text rendering
const { createLevelUpGIF } = require('../src/utils/levelUpCard');
const fs = require('fs');
const path = require('path');

async function run() {
  const gifBuffer = await createLevelUpGIF({
    username: 'MurphyPlayer',
    avatarURL: 'https://cdn.discordapp.com/embed/avatars/0.png',
    oldLevel: 4,
    newLevel: 5,
    type: 'chat',
  });

  const outPath = path.join(__dirname, 'debug-levelup.gif');
  fs.writeFileSync(outPath, gifBuffer);
  console.log(`Debug GIF saved: ${outPath}`);
}

run().catch(console.error);
