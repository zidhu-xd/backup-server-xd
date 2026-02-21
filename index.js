/**
 * Media Backup Relay Server
 *
 * Flow: Android uploads file directly here → server forwards to Telegram
 * No transfer.sh, no temp URLs, no middlemen.
 *
 * Endpoints:
 *   GET  /status  → health check
 *   POST /upload  → receives multipart file, sends to Telegram
 *
 * Required environment variables (set in Render dashboard):
 *   TELEGRAM_BOT_TOKEN
 *   CHAT_ID
 */

'use strict';

const express  = require('express');
const multer   = require('multer');
const TelegramBot = require('node-telegram-bot-api');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID            = process.env.CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) { console.error('ERROR: TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!CHAT_ID)            { console.error('ERROR: CHAT_ID not set');             process.exit(1); }

// ── Telegram (send-only) ──────────────────────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// ── Multer — store upload in memory (no disk writes needed) ──────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }  // 50 MB cap
});

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();

// GET /status — health check / UptimeRobot ping
app.get('/status', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /upload — receives file from Android, forwards to Telegram
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received. Send as multipart field "file".' });
  }

  const { originalname, buffer, mimetype } = req.file;
  const type = req.body.type || 'photo';   // "photo" or "video" sent by Android

  console.log(`Received ${type}: ${originalname} (${(buffer.length / 1024).toFixed(1)} KB)`);

  try {
    const caption = `📁 ${originalname}`;

    if (type === 'video') {
      await bot.sendVideo(
        CHAT_ID,
        buffer,
        { caption },
        { filename: originalname, contentType: mimetype }
      );
    } else {
      await bot.sendPhoto(
        CHAT_ID,
        buffer,
        { caption },
        { filename: originalname, contentType: mimetype }
      );
    }

    console.log(`Forwarded to Telegram: ${originalname}`);
    return res.json({ success: true, file: originalname });

  } catch (err) {
    console.error(`Telegram error for ${originalname}:`, err.message);
    return res.status(500).json({ error: 'Failed to forward to Telegram.', detail: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  GET  /status`);
  console.log(`  POST /upload  (multipart: file + type)`);
});
