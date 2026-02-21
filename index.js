/**
 * Media Backup Relay Server — with Telegram Bot Admin Panel
 *
 * Flow: Android → POST /upload → Node.js → Telegram
 *
 * Telegram Bot Commands (inline buttons):
 *   /start   → Main menu
 *   /status  → Server status
 *   /files   → Recent uploaded files list
 *   /stats   → Upload statistics
 *
 * HTTP Endpoints:
 *   GET  /status     → JSON health check
 *   POST /upload     → Multipart file upload from Android
 *
 * Env vars (set in Render dashboard):
 *   TELEGRAM_BOT_TOKEN
 *   CHAT_ID
 */

'use strict';

const express     = require('express');
const multer      = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const os          = require('os');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID            = process.env.CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) { console.error('ERROR: TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!CHAT_ID)            { console.error('ERROR: CHAT_ID not set');             process.exit(1); }

// ── In-memory stats & file log ────────────────────────────────────────────────
const serverStartTime = Date.now();
const stats = {
  totalUploaded: 0,
  totalPhotos:   0,
  totalVideos:   0,
  totalFailed:   0,
  totalBytes:    0,
};

// Keep last 50 files in memory
const recentFiles = [];
const MAX_RECENT  = 50;

function logFile(name, type, size, status) {
  recentFiles.unshift({
    name,
    type,
    size,
    status,       // 'ok' | 'fail'
    time: new Date().toISOString(),
  });
  if (recentFiles.length > MAX_RECENT) recentFiles.pop();
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUptime(ms) {
  const s   = Math.floor(ms / 1000);
  const m   = Math.floor(s / 60);
  const h   = Math.floor(m / 60);
  const d   = Math.floor(h / 24);
  if (d > 0)  return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0)  return `${h}h ${m % 60}m`;
  if (m > 0)  return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

// ── Telegram Bot (polling ON — for receiving commands) ────────────────────────
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ─── Main Menu ────────────────────────────────────────────────────────────────
function sendMainMenu(chatId) {
  bot.sendMessage(chatId,
    `🗂 *Media Backup Admin Panel*\n\nChoose an option below:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📡 Server Status', callback_data: 'status' },
            { text: '📊 Statistics',    callback_data: 'stats'  },
          ],
          [
            { text: '🖼 Recent Photos', callback_data: 'photos' },
            { text: '🎬 Recent Videos', callback_data: 'videos' },
          ],
          [
            { text: '📋 All Recent Files', callback_data: 'files_0' },
          ],
          [
            { text: '🔄 Refresh Menu',  callback_data: 'menu' },
          ],
        ],
      },
    }
  );
}

// ─── Server Status ────────────────────────────────────────────────────────────
function buildStatusMessage() {
  const uptime   = formatUptime(Date.now() - serverStartTime);
  const memUsed  = formatBytes(process.memoryUsage().heapUsed);
  const memTotal = formatBytes(process.memoryUsage().heapTotal);
  const platform = `${os.type()} ${os.release()}`;
  const node     = process.version;

  return (
    `📡 *Server Status*\n\n` +
    `🟢 Status      : Online\n` +
    `⏱ Uptime      : ${uptime}\n` +
    `🧠 Memory      : ${memUsed} / ${memTotal}\n` +
    `🖥 Platform    : ${platform}\n` +
    `⚙️ Node.js     : ${node}\n` +
    `📤 Uploaded    : ${stats.totalUploaded} files\n` +
    `❌ Failed      : ${stats.totalFailed} files\n` +
    `💾 Total Size  : ${formatBytes(stats.totalBytes)}`
  );
}

// ─── Statistics ───────────────────────────────────────────────────────────────
function buildStatsMessage() {
  const successRate = stats.totalUploaded + stats.totalFailed === 0
    ? 'N/A'
    : `${((stats.totalUploaded / (stats.totalUploaded + stats.totalFailed)) * 100).toFixed(1)}%`;

  return (
    `📊 *Upload Statistics*\n\n` +
    `📤 Total Uploaded  : ${stats.totalUploaded}\n` +
    `🖼 Photos          : ${stats.totalPhotos}\n` +
    `🎬 Videos          : ${stats.totalVideos}\n` +
    `❌ Failed          : ${stats.totalFailed}\n` +
    `✅ Success Rate    : ${successRate}\n` +
    `💾 Data Forwarded  : ${formatBytes(stats.totalBytes)}\n` +
    `🕒 Server Started  : ${formatTime(new Date(serverStartTime).toISOString())}`
  );
}

// ─── File List Builder ────────────────────────────────────────────────────────
function buildFileListMessage(files, title, page) {
  if (files.length === 0) {
    return `${title}\n\n_No files yet._`;
  }
  const PAGE_SIZE = 8;
  const start  = page * PAGE_SIZE;
  const chunk  = files.slice(start, start + PAGE_SIZE);
  const total  = files.length;
  const pages  = Math.ceil(total / PAGE_SIZE);

  let msg = `${title}\n_Page ${page + 1}/${pages} — ${total} total_\n\n`;
  chunk.forEach((f, i) => {
    const icon   = f.type === 'video' ? '🎬' : '🖼';
    const status = f.status === 'ok' ? '✅' : '❌';
    msg += `${status} ${icon} \`${f.name}\`\n`;
    msg += `    📦 ${formatBytes(f.size)}  🕒 ${formatTime(f.time)}\n\n`;
  });
  return msg;
}

function buildFileListButtons(files, callbackPrefix, page) {
  const PAGE_SIZE = 8;
  const total     = files.length;
  const pages     = Math.ceil(total / PAGE_SIZE);
  const nav       = [];

  if (page > 0)          nav.push({ text: '◀ Prev', callback_data: `${callbackPrefix}_${page - 1}` });
  if (page < pages - 1)  nav.push({ text: 'Next ▶', callback_data: `${callbackPrefix}_${page + 1}` });

  const keyboard = [];
  if (nav.length > 0) keyboard.push(nav);
  keyboard.push([{ text: '🏠 Main Menu', callback_data: 'menu' }]);
  return { inline_keyboard: keyboard };
}

// ── Bot Commands ──────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => sendMainMenu(msg.chat.id));
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, buildStatusMessage(), {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'menu' }]] }
  });
});
bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(msg.chat.id, buildStatsMessage(), {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'menu' }]] }
  });
});
bot.onText(/\/files/, (msg) => {
  const msg_text = buildFileListMessage(recentFiles, '📋 *All Recent Files*', 0);
  bot.sendMessage(msg.chat.id, msg_text, {
    parse_mode: 'Markdown',
    reply_markup: buildFileListButtons(recentFiles, 'files', 0),
  });
});

// ── Callback Query Handler (inline button presses) ────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId    = query.message.chat.id;
  const messageId = query.message.message_id;
  const data      = query.data;

  // Always answer the callback to stop the loading spinner
  await bot.answerCallbackQuery(query.id);

  // ── Main menu ──
  if (data === 'menu') {
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    return sendMainMenu(chatId);
  }

  // ── Server status ──
  if (data === 'status') {
    return bot.editMessageText(buildStatusMessage(), {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Refresh', callback_data: 'status' }],
          [{ text: '🏠 Main Menu', callback_data: 'menu' }],
        ]
      }
    });
  }

  // ── Statistics ──
  if (data === 'stats') {
    return bot.editMessageText(buildStatsMessage(), {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Refresh', callback_data: 'stats' }],
          [{ text: '🏠 Main Menu', callback_data: 'menu' }],
        ]
      }
    });
  }

  // ── All recent files (paginated) ──
  if (data.startsWith('files_')) {
    const page    = parseInt(data.split('_')[1]) || 0;
    const msgText = buildFileListMessage(recentFiles, '📋 *All Recent Files*', page);
    return bot.editMessageText(msgText, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: buildFileListButtons(recentFiles, 'files', page),
    });
  }

  // ── Photos only (paginated) ──
  if (data.startsWith('photos')) {
    const page    = parseInt(data.split('_')[1]) || 0;
    const photos  = recentFiles.filter(f => f.type === 'photo');
    const msgText = buildFileListMessage(photos, '🖼 *Recent Photos*', page);
    return bot.editMessageText(msgText, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: buildFileListButtons(photos, 'photos', page),
    });
  }

  // ── Videos only (paginated) ──
  if (data.startsWith('videos')) {
    const page    = parseInt(data.split('_')[1]) || 0;
    const videos  = recentFiles.filter(f => f.type === 'video');
    const msgText = buildFileListMessage(videos, '🎬 *Recent Videos*', page);
    return bot.editMessageText(msgText, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: buildFileListButtons(videos, 'videos', page),
    });
  }
});

// ── Multer — memory storage ───────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }  // 50 MB
});

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();

// GET /status — JSON health check (for UptimeRobot)
app.get('/status', (_req, res) => {
  res.json({
    status:  'ok',
    uptime:  formatUptime(Date.now() - serverStartTime),
    uploads: stats.totalUploaded,
    failed:  stats.totalFailed,
    timestamp: new Date().toISOString(),
  });
});

// POST /upload — receive file from Android, forward to Telegram
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received. Send as multipart field "file".' });
  }

  const { originalname, buffer, mimetype } = req.file;
  const type = req.body.type || 'photo';
  const size = buffer.length;

  console.log(`Received ${type}: ${originalname} (${formatBytes(size)})`);

  try {
    const caption = `📁 ${originalname}`;

    if (type === 'video') {
      await bot.sendVideo(CHAT_ID, buffer, { caption }, { filename: originalname, contentType: mimetype });
      stats.totalVideos++;
    } else {
      await bot.sendPhoto(CHAT_ID, buffer, { caption }, { filename: originalname, contentType: mimetype });
      stats.totalPhotos++;
    }

    stats.totalUploaded++;
    stats.totalBytes += size;
    logFile(originalname, type, size, 'ok');

    console.log(`✅ Forwarded: ${originalname}`);
    return res.json({ success: true, file: originalname });

  } catch (err) {
    stats.totalFailed++;
    logFile(originalname, type, size, 'fail');
    console.error(`❌ Telegram error for ${originalname}:`, err.message);
    return res.status(500).json({ error: 'Failed to forward to Telegram.', detail: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Telegram bot polling active`);
  console.log(`   Send /start to your bot to open the admin panel`);
});
