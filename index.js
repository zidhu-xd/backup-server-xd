'use strict';

/**
 * ╔══════════════════════════════════════╗
 * ║   ZIDHU-XD MEDIA BACKUP RELAY v2    ║
 * ║   Railway Backend + Telegram Admin   ║
 * ╚══════════════════════════════════════╝
 *
 * ENV VARIABLES (set in Railway dashboard):
 *   TELEGRAM_BOT_TOKEN  → from @BotFather
 *   CHAT_ID             → your personal Telegram chat ID
 *   ADMIN_SECRET        → any secret string to protect /notify endpoint
 */

const express    = require('express');
const axios      = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const https      = require('https');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID            = process.env.CHAT_ID;
const ADMIN_SECRET       = process.env.ADMIN_SECRET || 'zidhu-secret';
const SERVER_URL         = process.env.RAILWAY_STATIC_URL
                           ? `https://${process.env.RAILWAY_STATIC_URL}`
                           : 'https://backup-server-xd-production.up.railway.app';

if (!TELEGRAM_BOT_TOKEN) { console.error('❌ TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!CHAT_ID)            { console.error('❌ CHAT_ID not set');             process.exit(1); }

// ─── State ────────────────────────────────────────────────────────────────────
const startTime   = Date.now();
let   uploadCount = 0;
let   lastUpload  = null;
const recentFiles = [];   // last 20 files from Downloads

// ─── Telegram Bot ─────────────────────────────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ── Admin panel keyboard ──────────────────────────────────────────────────────
function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🟢 Service Status', callback_data: 'start_service' },
        { text: '📂 Get Folder',     callback_data: 'get_folder'    },
      ],
      [
        { text: '🏓 Ping Server',    callback_data: 'ping'          },
      ]
    ]
  };
}

// ── Welcome message ───────────────────────────────────────────────────────────
function welcomeMessage() {
  return `\`\`\`
╔═══════════════════════════╗
║   ░▀▀█░▀█▀░█▀▄░█░█░█░█   ║
║   ░▄▀░░░█░░█░█░█▀█░█░█   ║
║   ░▀▀▀░▀▀▀░▀▀░░▀░▀░▀▀▀   ║
║          X D              ║
╚═══════════════════════════╝
\`\`\`
🔐 *ZIDHU\\-XD BACKUP SYSTEM*
━━━━━━━━━━━━━━━━━━━━━━━━
👾 *Admin panel is online*
📡 *Server:* Railway Cloud
🔄 *Status:* Active & Monitoring
━━━━━━━━━━━━━━━━━━━━━━━━
_Use the buttons below to control your backup system_`;
}

// ── /start command ────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id.toString();

  // Only respond to the admin
  if (chatId !== CHAT_ID) {
    return bot.sendMessage(chatId, '⛔ Unauthorized.');
  }

  await bot.sendMessage(chatId, welcomeMessage(), {
    parse_mode: 'MarkdownV2',
    reply_markup: adminKeyboard()
  });
});

// ── /status command ───────────────────────────────────────────────────────────
bot.onText(/\/status/, async (msg) => {
  if (msg.chat.id.toString() !== CHAT_ID) return;
  const uptime = formatUptime(Date.now() - startTime);
  await bot.sendMessage(msg.chat.id, buildStatusMessage(uptime), {
    parse_mode: 'MarkdownV2',
    reply_markup: adminKeyboard()
  });
});

// ── Inline button handler ─────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id.toString();
  if (chatId !== CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized' });
  }

  await bot.answerCallbackQuery(query.id);

  switch (query.data) {

    // ── 🟢 Service Status ────────────────────────────────────────────────────
    case 'start_service': {
      const uptime = formatUptime(Date.now() - startTime);
      const text = `🟢 *Service is RUNNING*
━━━━━━━━━━━━━━━━━━━━━━
⏱ *Uptime:* \`${escMd(uptime)}\`
📦 *Files uploaded:* \`${uploadCount}\`
🕐 *Last upload:* \`${lastUpload ? escMd(lastUpload) : 'None yet'}\`
🌐 *Server:* Railway Cloud
━━━━━━━━━━━━━━━━━━━━━━
_Android client scans every 15 min_`;

      await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'MarkdownV2',
        reply_markup: adminKeyboard()
      });
      break;
    }

    // ── 📂 Get Folder ────────────────────────────────────────────────────────
    case 'get_folder': {
      let folderText;
      if (recentFiles.length === 0) {
        folderText = `📂 *Downloads Folder*
━━━━━━━━━━━━━━━━━━━━━━
📭 *No files uploaded yet*
_Waiting for Android client to sync\\.\\.\\._`;
      } else {
        const fileList = recentFiles
          .slice(-10)
          .reverse()
          .map((f, i) => `\`${i + 1}\\. ${escMd(f.name)}\` \\— ${escMd(f.type)} \\| ${escMd(f.time)}`)
          .join('\n');

        folderText = `📂 *Recent Files from Downloads*
━━━━━━━━━━━━━━━━━━━━━━
${fileList}
━━━━━━━━━━━━━━━━━━━━━━
📊 *Total backed up:* \`${uploadCount} files\``;
      }

      await bot.editMessageText(folderText, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'MarkdownV2',
        reply_markup: adminKeyboard()
      });
      break;
    }

    // ── 🏓 Ping ──────────────────────────────────────────────────────────────
    case 'ping': {
      const pingStart = Date.now();
      let pingResult;
      try {
        await axios.get(`${SERVER_URL}/status`, { timeout: 10000 });
        const ms = Date.now() - pingStart;
        pingResult = `🟢 *Online* \\— \`${ms}ms\``;
      } catch {
        pingResult = `🔴 *Unreachable*`;
      }

      const uptime = formatUptime(Date.now() - startTime);
      const text = `🏓 *Ping Results*
━━━━━━━━━━━━━━━━━━━━━━
${pingResult}
⏱ *Server uptime:* \`${escMd(uptime)}\`
🌐 *Host:* \`backup\\-server\\-xd\\-production\`
━━━━━━━━━━━━━━━━━━━━━━
_Railway Cloud • Node\\.js ${escMd(process.version)}_`;

      await bot.editMessageText(text, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'MarkdownV2',
        reply_markup: adminKeyboard()
      });
      break;
    }
  }
});

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Middleware: log all requests ───────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── GET /status ───────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: formatUptime(Date.now() - startTime),
    uploads: uploadCount,
    lastUpload,
    timestamp: new Date().toISOString()
  });
});

// ── POST /notify ──────────────────────────────────────────────────────────────
app.post('/notify', async (req, res) => {
  // Auth check
  const secret = req.headers['x-secret'] || req.body.secret;
  if (secret !== ADMIN_SECRET) {
    console.warn('Unauthorized /notify attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { fileName, url, type } = req.body;

  if (!fileName || !url || !type) {
    return res.status(400).json({ error: 'Missing fileName, url, or type' });
  }
  if (!['photo', 'video'].includes(type)) {
    return res.status(400).json({ error: 'type must be photo or video' });
  }

  console.log(`📥 New ${type}: ${fileName} — ${url}`);

  try {
    // 1. Download file into buffer
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 90_000,
      maxContentLength: 100 * 1024 * 1024   // 100MB
    });

    const fileBuffer = Buffer.from(response.data);
    const fileSizeKB = Math.round(fileBuffer.length / 1024);
    const now        = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const caption    = `📁 *${fileName}*\n📦 ${fileSizeKB} KB  •  🕐 ${now}`;

    // 2. Send to Telegram
    if (type === 'photo') {
      await bot.sendPhoto(CHAT_ID, fileBuffer, { caption, parse_mode: 'Markdown' }, { filename: fileName });
    } else {
      await bot.sendVideo(CHAT_ID, fileBuffer, { caption, parse_mode: 'Markdown' }, { filename: fileName });
    }

    // 3. Send upload notification message
    uploadCount++;
    lastUpload = now;
    recentFiles.push({ name: fileName, type, time: now });
    if (recentFiles.length > 20) recentFiles.shift();

    const notifText = `✅ *File Backed Up\\!*
━━━━━━━━━━━━━━━━━━━━━━
📄 *Name:* \`${escMd(fileName)}\`
📦 *Size:* \`${fileSizeKB} KB\`
🎞 *Type:* \`${type}\`
🕐 *Time:* \`${escMd(now)}\`
📊 *Total today:* \`${uploadCount}\``;

    await bot.sendMessage(CHAT_ID, notifText, { parse_mode: 'MarkdownV2' });

    console.log(`✅ Forwarded ${fileName} (${fileSizeKB}KB) to Telegram`);
    return res.json({ success: true, fileName, sizeKB: fileSizeKB });

  } catch (err) {
    console.error(`❌ Error processing ${fileName}:`, err.message);

    // Notify admin about failure
    try {
      await bot.sendMessage(CHAT_ID,
        `❌ *Upload Failed*\n\`${escMd(fileName)}\`\n_${escMd(err.message)}_`,
        { parse_mode: 'MarkdownV2' }
      );
    } catch (_) {}

    return res.status(500).json({ error: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function escMd(str) {
  return String(str).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

function buildStatusMessage(uptime) {
  return `🖥 *Server Status*
━━━━━━━━━━━━━━━━━━━━━━
⏱ *Uptime:* \`${escMd(uptime)}\`
📦 *Uploads:* \`${uploadCount}\`
🕐 *Last:* \`${lastUpload ? escMd(lastUpload) : 'None'}\`
🌐 *Platform:* Railway Cloud`;
}

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 Zidhu-XD Backup Server running on port ${PORT}`);
  console.log(`📡 Railway URL: ${SERVER_URL}`);

  // Send startup notification to Telegram
  try {
    await bot.sendMessage(CHAT_ID, welcomeMessage(), {
      parse_mode: 'MarkdownV2',
      reply_markup: adminKeyboard()
    });
    console.log('✅ Startup notification sent to Telegram');
  } catch (err) {
    console.error('⚠️  Could not send startup message:', err.message);
  }
});

// ─── Graceful error handling ──────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});
