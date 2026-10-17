const { Client, GatewayIntentBits, Partials, AttachmentBuilder } = require('discord.js');
const fetch = global.fetch || require('node-fetch');
const fs = require('fs');
const path = require('path');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const ROBLOX_CREATOR_ID = process.env.ROBLOX_CREATOR_ID;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_BYTES) || 20 * 1024 * 1024; // 20MB default
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_UPLOADS_PER_WINDOW = Number(process.env.MAX_UPLOADS_PER_WINDOW) || 3;

const uploadsFile = path.join(__dirname, 'uploads.json');
let uploads = {};
try {
  if (fs.existsSync(uploadsFile)) uploads = JSON.parse(fs.readFileSync(uploadsFile, 'utf8'));
} catch (e) {
  console.warn('Could not read uploads.json, starting fresh');
  uploads = {};
}

function saveUploads() {
  try {
    fs.writeFileSync(uploadsFile, JSON.stringify(uploads, null, 2));
  } catch (e) {
    console.error('Failed to save uploads.json', e);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

const commandHandlers = {
  help: async (interaction) => {
    await interaction.reply({ content: `RIVAL ASSET BOT - Commands:\n
- /help — show this help\n- /publish-audio <file|asset> [play_speed] — upload audio to Roblox Open Cloud Assets OR provide an existing asset id/url. Optionally set playback speed for Roblox (e.g. 1.0).\n- /publish-image <file|asset> — upload image to Roblox Open Cloud Assets or provide existing asset id/url.\n- /publish-model <file|asset> — upload a model file to Roblox Open Cloud Assets or provide existing asset id/url.\n- /my-uploads — show your upload history\n
Notes:\n- Only allowed users can publish.\n- Roblox API key and creator ID must be configured.\n`, ephemeral: true });
  },

  'my-uploads': async (interaction) => {
    const userId = interaction.user.id;
    const records = uploads[userId] || [];
    if (records.length === 0) {
      await interaction.reply({ content: 'You have no recorded uploads.', ephemeral: true });
      return;
    }
    const lines = records.slice().reverse().slice(0, 10).map(r => {
      const when = new Date(r.timestamp).toISOString();
      return `• [${when}] ${r.command} ${r.originalName || ('asset:' + (r.assetId||'unknown'))} — ${r.size || 0} bytes — status: ${r.status}${r.assetId ? ' — assetId: ' + r.assetId : ''}`;
    });
    await interaction.reply({ content: `Your recent uploads:\n${lines.join('\n')}`, ephemeral: true });
  }
};

async function checkAllowed(interaction) {
  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You are not allowed to use upload commands for this bot.', ephemeral: true });
    return false;
  }
  return true;
}

function recordUpload(userId, entry) {
  uploads[userId] = uploads[userId] || [];
  uploads[userId].push(entry);
  // keep history short
  if (uploads[userId].length > 200) uploads[userId].shift();
  saveUploads();
}

const recentUploadsMap = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const arr = recentUploadsMap.get(userId) || [];
  const filtered = arr.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (filtered.length >= MAX_UPLOADS_PER_WINDOW) return false;
  filtered.push(now);
  recentUploadsMap.set(userId, filtered);
  return true;
}

async function fetchAttachmentBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extractRobloxAssetId(text) {
  if (!text) return null;
  // common patterns: rbxassetid://12345, https://www.roblox.com/library/12345/name, just digits
  const urlMatch = text.match(/(\d{6,})/);
  if (urlMatch) return urlMatch[1];
  return null;
}

async function uploadToRoblox({ buffer, fileName, contentType, displayName, type }) {
  if (!ROBLOX_API_KEY) throw new Error('Roblox API key not set (ROBLOX_API_KEY)');
  const form = new (global.FormData)();
  form.append('displayName', displayName || fileName);
  form.append('type', type);
  if (ROBLOX_CREATOR_ID) form.append('creatorId', String(ROBLOX_CREATOR_ID));
  const blob = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  form.append('fileContent', blob, fileName);

  const res = await fetch('https://apis.roblox.com/assets/v1/assets', {
    method: 'POST',
    headers: {
      'x-api-key': ROBLOX_API_KEY,
    },
    body: form
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error('Roblox API returned error');
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

async function pollOperation(operationId, timeoutMs = 30000, interval = 2000) {
  if (!ROBLOX_API_KEY) throw new Error('Roblox API key not set');
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const res = await fetch(`https://apis.roblox.com/assets/v1/operations/${operationId}`, {
      headers: { 'x-api-key': ROBLOX_API_KEY }
    });
    if (!res.ok) throw new Error(`Polling operation failed: ${res.status}`);
    const json = await res.json();
    if (json.status && (json.status === 'Succeeded' || json.status === 'Failed')) {
      return json;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Operation polling timed out');
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  try {
    if (cmd === 'help' || cmd === 'my-uploads') {
      return await commandHandlers[cmd](interaction);
    }

    // Upload-type commands
    if (!await checkAllowed(interaction)) return;

    if (!checkRateLimit(interaction.user.id)) {
      await interaction.reply({ content: 'You are sending uploads too quickly. Please wait a bit.', ephemeral: true });
      return;
    }

    // For publish-audio, support optional existing asset id/url and play_speed
    const providedAsset = interaction.options.getString && interaction.options.getString('asset');
    const playSpeed = interaction.options.getNumber && interaction.options.getNumber('play_speed');

    if (playSpeed !== null && playSpeed !== undefined) {
      if (typeof playSpeed !== 'number' || playSpeed <= 0 || playSpeed > 5) {
        await interaction.reply({ content: 'play_speed must be a number > 0 and <= 5. Typical values are around 0.5-2.0.', ephemeral: true });
        return;
      }
    }

    let attachment = interaction.options.getAttachment && interaction.options.getAttachment('file');

    let finalAssetId = null;
    let operationId = null;
    let status = 'Unknown';

    // If user provided an existing asset id/url, detect it and skip upload
    const detectedId = extractRobloxAssetId(providedAsset || (attachment && attachment.name) || interaction.options.getString && interaction.options.getString('asset'));
    if (detectedId) {
      finalAssetId = detectedId;
      status = 'Provided';
      recordUpload(interaction.user.id, { timestamp: Date.now(), command: cmd, originalName: `asset:${finalAssetId}`, size: 0, contentType: 'n/a', status, assetId: finalAssetId });
      let reply = `Detected provided Roblox asset ID: ${finalAssetId}.`;
      if (cmd === 'publish-audio' && playSpeed) {
        reply += `\nRecommended Roblox usage: set Sound.PlaybackSpeed = ${playSpeed};`;
      }
      reply += '\nNote: this bot did not upload the file. Availability and moderation are determined by Roblox.';
      await interaction.reply({ content: reply, ephemeral: true });
      return;
    }

    if (!attachment) {
      await interaction.reply({ content: 'No file provided and no recognizable asset id/url. Please attach a file or provide an existing Roblox asset id/url via the asset option.', ephemeral: true });
      return;
    }

    if (attachment.size > MAX_FILE_SIZE) {
      await interaction.reply({ content: `File is too large. Max allowed is ${MAX_FILE_SIZE} bytes.`, ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const buffer = await fetchAttachmentBuffer(attachment.url);
    const contentType = attachment.contentType || 'application/octet-stream';

    // determine type and perform basic validation
    let robloxType = null;
    if (cmd === 'publish-audio') {
      robloxType = 'Audio';
      if (!contentType.startsWith('audio/')) {
        await interaction.editReply({ content: 'Uploaded file does not appear to be an audio file (content-type mismatch).' });
        return;
      }
    } else if (cmd === 'publish-image') {
      robloxType = 'Image';
      if (!contentType.startsWith('image/')) {
        await interaction.editReply({ content: 'Uploaded file does not appear to be an image file (content-type mismatch).' });
        return;
      }
    } else if (cmd === 'publish-model') {
      robloxType = 'Model';
      // allow common model content-types or file extensions
      const ext = (attachment.name || '').split('.').pop().toLowerCase();
      const allowed = ['fbx','gltf','glb','rbxm','rbxmx'];
      if (!allowed.includes(ext)) {
        await interaction.editReply({ content: `Unknown model file extension .${ext}. Supported: ${allowed.join(', ')}.` });
        return;
      }
    }

    // call roblox
    let robloxResp;
    try {
      robloxResp = await uploadToRoblox({ buffer, fileName: attachment.name || 'upload', contentType, displayName: attachment.name || 'Uploaded via RIVAL ASSET BOT', type: robloxType });
    } catch (err) {
      console.error('Roblox upload error (not exposing secrets):', err && err.message ? err.message : err);
      await interaction.editReply({ content: `Upload to Roblox failed: ${err.message || 'unknown error'}` });
      recordUpload(interaction.user.id, { timestamp: Date.now(), command: cmd, originalName: attachment.name, size: attachment.size, contentType, status: 'Failed', robloxResponse: (err.body || err.message) });
      return;
    }

    // Response should contain operationId (and possibly id)
    operationId = robloxResp.operationId || robloxResp.operation_id || robloxResp.operation || null;
    status = 'Uploaded';
    finalAssetId = robloxResp.id || robloxResp.assetId || null;

    if (operationId) {
      // poll for moderation / final status
      try {
        const op = await pollOperation(operationId, 30000, 2500);
        if (op.status === 'Succeeded') {
          status = 'Succeeded';
          finalAssetId = finalAssetId || op.assetId || op.result?.assetId || op.result?.id || null;
        } else {
          status = op.status || 'Failed';
        }
      } catch (err) {
        console.warn('Polling error (non fatal):', err.message);
        status = 'Pending';
      }
    }

    // Record upload (do not save any secrets)
    recordUpload(interaction.user.id, { timestamp: Date.now(), command: cmd, originalName: attachment.name, size: attachment.size, contentType, status, assetId: finalAssetId, operationId });

    // Reply with non-secret details
    let reply = `Upload recorded. Status: ${status}.`;
    if (finalAssetId) reply += ` Asset ID: ${finalAssetId}`;
    if (cmd === 'publish-audio' && playSpeed) {
      reply += `\nRecommended Roblox usage: set Sound.PlaybackSpeed = ${playSpeed};`;
      reply += `\nIf you want to change pitch only without changing playback duration, Roblox uses PlaybackSpeed for overall playback speed. Test values in-game as moderation/encoding may affect final duration.`;
    }
    reply += '\nNote: final moderation and availability are handled by Roblox. Supported formats, permissions, and moderation follow Roblox rules.';

    await interaction.editReply({ content: reply });

  } catch (err) {
    console.error('Command handling error:', err);
    try { await interaction.editReply({ content: 'Internal error while processing your command.' }); } catch(e){}
  }
});

async function shutdown() {
  console.log('Shutting down...');
  try { await client.destroy(); } catch (e) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(DISCORD_TOKEN).catch(err => {
  console.error('Failed to login to Discord:', err);
  process.exit(1);
});
