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
 *   ADMIN_SECRET        → must match Constants.kt ADMIN_SECRET in Android app
 */

const express     = require('express');
const axios       = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const multer      = require('multer');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT               = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID            = process.env.CHAT_ID;
const ADMIN_SECRET       = process.env.ADMIN_SECRET || 'zidhu-secret';
const SERVER_URL         = 'https://backup-server-xd-production.up.railway.app';

if (!TELEGRAM_BOT_TOKEN) { console.error('❌ TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!CHAT_ID)            { console.error('❌ CHAT_ID not set');             process.exit(1); }

// ─── State ────────────────────────────────────────────────────────────────────
const startTime   = Date.now();
let   uploadCount = 0;
let   lastUpload  = null;
const recentFiles = [];   // keeps last 20 entries

// ─── Multer — in-memory, no temp files ───────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }  // 100 MB hard cap
});

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

// ── Welcome / startup message ─────────────────────────────────────────────────
function welcomeMessage() {
  return `\`\`\`
╔═══════════════════════════╗
║  ░▀▀▀░▀█▀░█▀▄░█░█░█░█    ║
║  ░▄▀░░░█░░█░█░█▀█░█░█    ║
║  ░▀▀▀░▀▀▀░▀▀░░▀░▀░▀▀▀    ║
║           X D             ║
╚═══════════════════════════╝\`\`\`
🔐 *ZIDHU\\-XD BACKUP SYSTEM*
━━━━━━━━━━━━━━━━━━━━━━━━
👾 *Admin panel is ONLINE*
📡 *Server:* Railway Cloud
🔄 *Status:* Active \\& Monitoring
━━━━━━━━━━━━━━━━━━━━━━━━
_Use the buttons below to control your backup system_`;
}

// ── /start command ────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  if (msg.chat.id.toString() !== CHAT_ID) {
    return bot.sendMessage(msg.chat.id, '⛔ Unauthorized.');
  }
  await bot.sendMessage(msg.chat.id, welcomeMessage(), {
    parse_mode: 'MarkdownV2',
    reply_markup: adminKeyboard()
  });
});

// ── /status command ───────────────────────────────────────────────────────────
bot.onText(/\/status/, async (msg) => {
  if (msg.chat.id.toString() !== CHAT_ID) return;
  const uptime = formatUptime(Date.now() - startTime);
  await bot.sendMessage(msg.chat.id,
    `🖥 *Server Status*\n⏱ *Uptime:* \`${escMd(uptime)}\`\n📦 *Uploads:* \`${uploadCount}\`\n🕐 *Last:* \`${lastUpload ? escMd(lastUpload) : 'None'}\``,
    { parse_mode: 'MarkdownV2', reply_markup: adminKeyboard() }
  );
});

// ── Inline button handler ─────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id.toString();
  if (chatId !== CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized' });
  }
  await bot.answerCallbackQuery(query.id);

  switch (query.data) {

    // ── 🟢 Service Status ─────────────────────────────────────────────────────
    case 'start_service': {
      const uptime = formatUptime(Date.now() - startTime);
      await bot.editMessageText(
        `🟢 *Service is RUNNING*\n━━━━━━━━━━━━━━━━━━━━━━\n⏱ *Uptime:* \`${escMd(uptime)}\`\n📦 *Files uploaded this session:* \`${uploadCount}\`\n🕐 *Last upload:* \`${lastUpload ? escMd(lastUpload) : 'None yet'}\`\n🌐 *Server:* Railway Cloud\n━━━━━━━━━━━━━━━━━━━━━━\n_Android client scans every 15 min_`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id,
          parse_mode: 'MarkdownV2', reply_markup: adminKeyboard() }
      );
      break;
    }

    // ── 📂 Get Folder ─────────────────────────────────────────────────────────
    case 'get_folder': {
      let text;
      if (recentFiles.length === 0) {
        text = `📂 *Downloads Folder*\n━━━━━━━━━━━━━━━━━━━━━━\n📭 *No files uploaded yet*\n_Waiting for Android client to sync\\.\\.\\._`;
      } else {
        const list = recentFiles.slice(-10).reverse()
          .map((f, i) => `\`${i + 1}\\.\` ${escMd(f.name)} — ${escMd(f.type)} \\| ${escMd(f.time)}`)
          .join('\n');
        text = `📂 *Recent Files from Downloads*\n━━━━━━━━━━━━━━━━━━━━━━\n${list}\n━━━━━━━━━━━━━━━━━━━━━━\n📊 *Total:* \`${uploadCount} files\``;
      }
      await bot.editMessageText(text, {
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        parse_mode: 'MarkdownV2', reply_markup: adminKeyboard()
      });
      break;
    }

    // ── 🏓 Ping ───────────────────────────────────────────────────────────────
    case 'ping': {
      const t0 = Date.now();
      let result;
      try {
        await axios.get(`${SERVER_URL}/status`, { timeout: 10000 });
        result = `🟢 *Online* \\— \`${Date.now() - t0}ms\``;
      } catch {
        result = `🔴 *Unreachable*`;
      }
      const uptime = formatUptime(Date.now() - startTime);
      await bot.editMessageText(
        `🏓 *Ping Results*\n━━━━━━━━━━━━━━━━━━━━━━\n${result}\n⏱ *Uptime:* \`${escMd(uptime)}\`\n🌐 *Host:* \`backup\\-server\\-xd\\-production\`\n_Railway Cloud • Node\\.js ${escMd(process.version)}_`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id,
          parse_mode: 'MarkdownV2', reply_markup: adminKeyboard() }
      );
      break;
    }
  }
});

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function authCheck(req, res, next) {
  const secret = req.headers['x-secret'] || req.body?.secret;
  if (secret !== ADMIN_SECRET) {
    console.warn('⚠️  Unauthorized request from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── GET /status — health check + UptimeRobot ping target ─────────────────────
app.get('/status', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: formatUptime(Date.now() - startTime),
    uploads: uploadCount,
    lastUpload,
    timestamp: new Date().toISOString()
  });
});

// ── POST /upload — Android sends file directly as multipart/form-data ─────────
app.post('/upload', authCheck, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received. Send file as form-data field "file".' });
  }

  const fileName   = req.body.fileName || req.file.originalname;
  const type       = req.body.type;
  const fileSizeKB = Math.round(req.file.buffer.length / 1024);
  const now        = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  if (!type || !['photo', 'video'].includes(type)) {
    return res.status(400).json({ error: 'type must be "photo" or "video"' });
  }

  console.log(`📥 Received ${type}: ${fileName} (${fileSizeKB}KB)`);

  try {
    const caption = `📁 *${fileName}*\n📦 ${fileSizeKB} KB  •  🕐 ${now}`;

    // Send media to Telegram
    if (type === 'photo') {
      await bot.sendPhoto(CHAT_ID, req.file.buffer,
        { caption, parse_mode: 'Markdown' }, { filename: fileName });
    } else {
      await bot.sendVideo(CHAT_ID, req.file.buffer,
        { caption, parse_mode: 'Markdown' }, { filename: fileName });
    }

    // Update tracking state
    uploadCount++;
    lastUpload = now;
    recentFiles.push({ name: fileName, type, time: now });
    if (recentFiles.length > 20) recentFiles.shift();

    // Send upload notification message
    await bot.sendMessage(CHAT_ID,
      `✅ *File Backed Up\\!*\n━━━━━━━━━━━━━━━━━━━━━━\n📄 *Name:* \`${escMd(fileName)}\`\n📦 *Size:* \`${fileSizeKB} KB\`\n🎞 *Type:* \`${type}\`\n🕐 *Time:* \`${escMd(now)}\`\n📊 *Session total:* \`${uploadCount}\``,
      { parse_mode: 'MarkdownV2' }
    );

    console.log(`✅ Forwarded ${fileName} to Telegram`);
    return res.json({ success: true, fileName, sizeKB: fileSizeKB });

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
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
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60),
        h = Math.floor(m / 60),   d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function escMd(str) {
  return String(str).replace(/[_*[\]()~`>#+=|{}.!\-]/g, '\\$&');
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 Zidhu-XD Backup Server on port ${PORT}`);
  try {
    await bot.sendMessage(CHAT_ID, welcomeMessage(), {
      parse_mode: 'MarkdownV2',
      reply_markup: adminKeyboard()
    });
    console.log('✅ Startup message sent to Telegram');
  } catch (err) {
    console.error('⚠️  Startup message failed:', err.message);
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled:', err?.message));
