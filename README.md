# 📊 Murphy Level Bot

Discord bot dengan sistem leveling **terpisah**: **Chat Level** dan **Voice Level**.

## ✨ Fitur

| Fitur | Chat Level | Voice Level |
|-------|-----------|-------------|
| XP System | ✅ Dapat XP tiap chat (25-40 XP, cooldown 60s) | ✅ Dapat XP tiap menit di voice (20 XP/menit) |
| Rank Card | ✅ Gambar dengan progress bar | ✅ Gambar dengan progress bar |
| Leaderboard | ✅ Top 10 | ✅ Top 10 |
| Role Reward | ✅ Auto role saat level up | ✅ Auto role saat level up |
| Daily Streak Bonus | ✅ Bonus XP harian, multiplier hingga 3x | ✅ Bonus XP harian, multiplier hingga 3x |
| XP Event/Multiplier | ✅ Double/triple XP event | ✅ Double/triple XP event |
| Level Up Animation | ✅ GIF animasi | ✅ GIF animasi |

## 🚀 Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Buat bot di Discord Developer Portal
1. Buka https://discord.com/developers/applications
2. Klik **New Application** → kasih nama
3. Pergi ke tab **Bot** → copy **Token**
4. Di tab **OAuth2 → General**, copy **Client ID**
5. Invite bot ke server dengan URL:
   ```
   https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID_KAMU&permissions=268438608&scope=bot%20applications.commands
   ```

### 3. Isi config
Copy `config.example.json` ke `config.json` dan isi:
```bash
cp config.example.json config.json
```
```json
{
  "token": "TOKEN_BOT_KAMU",
  "clientId": "CLIENT_ID_BOT_KAMU",
  "prefix": "!"
}
```

> **⚠️ Keamanan:** `config.json` sudah ada di `.gitignore`. Jangan pernah commit file ini!
> Alternatif lebih aman: gunakan environment variable:
> ```bash
> # Linux/Mac
> export BOT_TOKEN="TOKEN_KAMU"
> export CLIENT_ID="CLIENT_ID_KAMU"
> # Windows PowerShell
> $env:BOT_TOKEN="TOKEN_KAMU"
> $env:CLIENT_ID="CLIENT_ID_KAMU"
> ```

### 4. Aktifkan Privileged Intents
Di Discord Developer Portal → tab **Bot** → aktifkan:
- ✅ **Message Content Intent**
- ✅ **Server Members Intent**

### 5. Jalankan bot
```bash
npm start
```

## 📋 Commands

| Command | Deskripsi |
|---------|-----------|
| `/rank` | Lihat rank card (gambar progress bar) — bisa pilih chat/voice/both |
| `/level` | Lihat level dalam bentuk text |
| `/status` | Status lengkap (chat + voice + streak + rank + progress bar) |
| `/leaderboard` | Top 10 user (chat atau voice) |
| `/setreward` | *(Admin)* Set role reward untuk level tertentu |
| `/rewards` | Lihat semua role reward yang sudah diset |
| `/setmultiplier` | *(Admin)* Set XP multiplier event (double/triple XP) |
| `/setevent` | *(Admin)* Atur scheduled XP event (recurring weekly) |
| `/setlevelchannel` | *(Admin)* Set channel untuk announce level up |
| `/testnotiflevel` | *(Admin)* Test notifikasi level up |

## 🎨 Contoh Penggunaan

### Set role reward
```
/setreward type: Chat Level level: 10 role: @Pro Chatter
/setreward type: Voice Level level: 10 role: @Voice Pro
```

### Cek rank
```
/rank                        → Lihat rank sendiri (chat + voice)
/rank type: Chat Level       → Lihat chat rank card aja
/rank user: @user type: Voice Level → Lihat voice rank user lain
```

## 📁 Struktur Project

```
murphy level/
├── config.json              # Token & client ID
├── package.json
├── README.md
└── src/
    ├── index.js             # Main entry point
    ├── commands/
    │   ├── rank.js          # Rank card (gambar)
    │   ├── level.js         # Level (text)
    │   ├── status.js        # Status lengkap (chat + voice + streak)
    │   ├── leaderboard.js   # Top 10
    │   ├── setreward.js     # Set role reward (admin)
    │   ├── rewards.js       # Lihat semua reward
    │   ├── setmultiplier.js # Set XP multiplier event (admin)
    │   ├── setevent.js      # Scheduled XP event (admin)
    │   ├── setlevelchannel.js # Set channel announce level up (admin)
    │   └── testnotiflevel.js  # Test notifikasi level up (admin)
    └── utils/
        ├── jsonDb.js         # JSON database (pure JS, no native deps)
        ├── database.js       # Database handler (chat & voice XP, streak)
        ├── xpHandler.js      # XP tracking logic
        ├── rankCard.js       # Canvas rank card generator
        └── levelUpCard.js    # Level up GIF animation generator
```

## ⚙️ Konfigurasi XP

| Setting | Default | Lokasi |
|---------|---------|--------|
| Chat XP per message | 25-75 (random, avg 50) | `src/utils/xpHandler.js` |
| Chat cooldown | 60 detik | `src/utils/xpHandler.js` |
| Voice XP per menit | 20 XP | `src/utils/xpHandler.js` |
| Min voice time untuk XP | 1 menit | `src/utils/xpHandler.js` |
| XP formula per level | `floor(2.5 * (L+1)^1.25 + 25)` | `src/utils/database.js` |
| Max level | 500 | `src/utils/database.js` |
| Daily streak bonus | Hingga 3x multiplier | `src/utils/database.js` |
| XP multiplier event | 1x-10x (default 1x) | `src/utils/database.js` |

### 📐 Formula XP (Power-Based)

XP yang dibutuhkan naik dari level `L` ke `L+1`:

```
XPNeeded(L) = floor(2.5 × (L+1)^1.25 + 25)
```

Formula ini **power-based** (bukan linear) supaya level tinggi jauh lebih berat — level 500 jadi pencapaian berarti, bukan sesuatu yang didapat dalam 1-2 bulan.

| Level | XP dibutuhkan | Total XP kumulatif |
|-------|---------------|--------------------|
| 1 | 27 | 27 |
| 10 | 78 | ~430 |
| 20 | 137 | ~1.5K |
| 50 | 365 | ~9.5K |
| 100 | 825 | ~30K |
| 200 | 1.917 | ~105K |
| 300 | 3.159 | ~245K |
| 400 | 4.511 | ~490K |
| 499 | 5.935 | ~1.328.745 |

**Total XP dari level 0 → 500: 1.328.745 XP**

> ℹ️ User dengan data lama akan otomatis **direkalkulasi** (`recalibrateProgress`) saat pertama kali dapat XP lagi, supaya progress-nya konsisten dengan formula baru.

### 📈 Estimasi Capaian Level

| Aktivitas | XP/hari | Level 100 | Level 250 | Level 500 |
|-----------|---------|-----------|-----------|-----------|
| **Casual** — 30 chat + 1.5 jam voice | ~4.650 | 0.4 bln | 2.9 bln | 13.4 bln |
| **Aktif** — 60 chat + 3 jam voice | ~9.000 | 0.2 bln | 1.4 bln | **6.7 bln** |
| **Sangat aktif** — 100 chat + 5 jam voice | ~13.500 | 0.1 bln | 0.9 bln | **4 bln** |
| **Hardcore** — 150 chat + 8 jam voice | ~21.000 | 0.1 bln | 0.6 bln | **2.8 bln** |

### 🔥 Daily Streak Bonus

User yang aktif **setiap hari** mendapat bonus XP tambahan:

| Streak (hari) | Bonus Multiplier | Efek |
|---------------|-----------------|------|
| 1-2 | 1x | Normal |
| 3-5 | 1.33x | Bonus XP harian |
| 6-8 | 1.67x | Bonus XP harian |
| 9-11 | 2x | Bonus XP harian |
| 12+ | 3x | Bonus XP maksimal |

Skip sehari = streak reset ke 1.

### 🛡️ Anti-AFK Voice

User **tidak dapat XP** di voice channel jika:

- Mute / deaf (server atau self-deafen)
- Berada di AFK channel
- Sendirian di channel (minimal ada 2 orang)

Anti-AFK juga menangani kasus saat satu orang leave — sisa user yang jadi sendirian langsung diproses & dihentikan tracking-nya.

## 🔧 Requirements

- Node.js v18 atau lebih baru
- Bot dengan permission: Send Messages, Manage Roles, Read Messages, View Channels

## 🐛 Troubleshooting

**Bot tidak online?**
- Cek token di `config.json` sudah benar
- Pastikan tidak ada bot lain pakai token yang sama

**Slash commands tidak muncul?**
- Pastikan `clientId` di `config.json` benar
- Tunggu beberapa menit setelah bot start (cache Discord)
- Kick & re-invite bot jika perlu

**Rank card error?**
- Pastikan `@napi-rs/canvas` terinstall: `npm install`
- Database pakai JSON file (`database.json`) — tidak butuh SQLite/build tools

**Role reward tidak terpasang?**
- Pastikan role bot **di atas** role yang mau dikasih
- Bot butuh permission **Manage Roles**
