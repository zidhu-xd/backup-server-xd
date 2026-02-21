/**
 * Media Backup Relay Server
 * Deploy this on Render.com
 * 
 * Set these 2 environment variables in Render dashboard:
 *   TELEGRAM_BOT_TOKEN  → from @BotFather
 *   CHAT_ID             → your personal Telegram chat ID
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const TelegramBot = require('node-telegram-bot-api');

// ── Read environment variables ────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID            = process.env.CHAT_ID;

// Crash early if secrets are missing
if (!TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}
if (!CHAT_ID) {
  console.error('ERROR: CHAT_ID is not set.');
  process.exit(1);
}

// ── Telegram bot (send-only, no polling needed) ───────────────────────────────
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// GET /status  →  health check (also used by UptimeRobot to keep server awake)
app.get('/status', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /notify  →  called by the Android app
app.post('/notify', async (req, res) => {
  const { fileName, url, type } = req.body;

  // Validate payload
  if (!fileName || !url || !type) {
    return res.status(400).json({ error: 'Missing fileName, url, or type.' });
  }
  if (!['photo', 'video'].includes(type)) {
    return res.status(400).json({ error: 'type must be "photo" or "video".' });
  }

  console.log(`Received ${type}: ${fileName}  →  ${url}`);

  try {
    // 1. Download the file into memory
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60_000,                         // 60 second download limit
      maxContentLength: 50 * 1024 * 1024       // 50 MB cap
    });

    const fileBuffer = Buffer.from(response.data);
    const caption    = `📁 ${fileName}`;

    // 2. Forward to Telegram
    if (type === 'photo') {
      await bot.sendPhoto(CHAT_ID, fileBuffer, { caption }, { filename: fileName });
    } else {
      await bot.sendVideo(CHAT_ID, fileBuffer, { caption }, { filename: fileName });
    }

    console.log(`Forwarded ${fileName} to Telegram.`);
    return res.json({ success: true });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
