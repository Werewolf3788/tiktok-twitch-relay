// Section: Web Server & Express Keep-Alive (Lines 2-16)
const express = require('express');
const TikTokPackage = require('tiktok-live-connector');
const { LiveChat } = require('youtube-chat');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Chat Relay Worker (TikTok & YouTube) is running.'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// Section: Stream Target & Webhook Configuration (Lines 18-30)
const TIKTOK_USERNAME = 'k082412';
const TIKTOK_SESSION_ID = process.env.TIKTOK_SESSION_ID || '';
const TWITCH_CHANNEL = 'werewolf3788';
const YOUTUBE_CHANNEL_ID = 'UCYrxPkCw_Q2Fw02VFfumfyQ';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec';

let isTwitchActive = false;
let tiktokLiveConnection = null;
let youtubeLiveChat = null;
let isYouTubeRunning = false;

// Section: Universal TikTok Constructor Resolver (Lines 32-44)
function createTikTokConnection(username, options) {
  if (TikTokPackage.TikTokLiveConnection) {
    return new TikTokPackage.TikTokLiveConnection(username, options);
  }
  if (TikTokPackage.WebcastPushConnection) {
    return new TikTokPackage.WebcastPushConnection(username, options);
  }
  if (typeof TikTokPackage === 'function') {
    return new TikTokPackage(username, options);
  }
  throw new Error('Constructor not found');
}

// Section: DecAPI Twitch Stream Checker (Lines 46-58)
async function isTwitchLive() {
  try {
    const res = await fetch(`https://decapi.me/twitch/uptime/${TWITCH_CHANNEL}`);
    const text = await res.text();
    console.log(`[DecAPI Check] Result for ${TWITCH_CHANNEL}: "${text.trim()}"`);
    return !text.toLowerCase().includes('offline');
  } catch (err) {
    console.error('DecAPI check error:', err.message);
    return false;
  }
}

// Section: Dispatch to Google Apps Script (Lines 60-76)
function relayToAppsScript(platform, username, message) {
  const payload = { platform, username, message };
  console.log(`[Relay Triggered] Sending ${platform} message from ${username} to Apps Script...`);

  fetch(GAS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => res.text())
  .then(body => console.log(`[GAS Response - ${platform}] Status text: ${body}`))
  .catch(err => console.error(`Error relaying ${platform} chat to Apps Script:`, err.message));
}

// Section: TikTok Connection Manager (Lines 78-124)
function startTikTokListener() {
  if (tiktokLiveConnection) return;
  console.log(`[TikTok] Initializing connection for @${TIKTOK_USERNAME}...`);

  const connectionOptions = {
    enableExtendedGiftInfo: false
  };

  if (TIKTOK_SESSION_ID) {
    connectionOptions.sessionId = TIKTOK_SESSION_ID;
  }

  try {
    tiktokLiveConnection = createTikTokConnection(TIKTOK_USERNAME, connectionOptions);

    tiktokLiveConnection.connect().then(state => {
      console.log(`[TikTok] Connected to Room ID: ${state.roomId}`);
    }).catch(err => {
      console.log(`[TikTok] Not live or connection error: ${err.message || err}`);
      tiktokLiveConnection = null;
    });

    tiktokLiveConnection.on('chat', data => {
      console.log(`[TikTok Chat Inbound] ${data.uniqueId}: ${data.comment}`);
      relayToAppsScript('TikTok', data.nickname || data.uniqueId, data.comment);
    });

    tiktokLiveConnection.on('streamEnd', () => {
      console.log('[TikTok] Stream ended.');
      if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
        tiktokLiveConnection = null;
      }
    });

    tiktokLiveConnection.on('disconnected', () => {
      console.log('[TikTok] Socket disconnected.');
      tiktokLiveConnection = null;
    });
  } catch (e) {
    console.error('[TikTok Loader Error]:', e.message);
    tiktokLiveConnection = null;
  }
}

function stopTikTokListener() {
  if (tiktokLiveConnection) {
    try {
      tiktokLiveConnection.disconnect();
    } catch (e) {}
    tiktokLiveConnection = null;
  }
}

// Section: YouTube Live Chat Listener (Lines 126-173)
function startYouTubeListener() {
  if (isYouTubeRunning) return;

  console.log(`[YouTube] Attaching listener for channel: ${YOUTUBE_CHANNEL_ID}...`);
  try {
    youtubeLiveChat = new LiveChat({ channelId: YOUTUBE_CHANNEL_ID });

    youtubeLiveChat.on('start', (liveId) => {
      isYouTubeRunning = true;
      console.log(`[YouTube] Connected to active live stream: ${liveId}`);
    });

    youtubeLiveChat.on('chat', (chatItem) => {
      const author = chatItem.author ? chatItem.author.name : 'YouTubeViewer';
      const text = chatItem.message ? chatItem.message.map(m => m.text).join('') : '';
      if (text) {
        console.log(`[YouTube Chat Inbound] ${author}: ${text}`);
        relayToAppsScript('YouTube', author, text);
      }
    });

    youtubeLiveChat.on('end', (reason) => {
      console.log(`[YouTube] Stream ended (${reason || 'closed'}).`);
      stopYouTubeListener();
    });

    youtubeLiveChat.on('error', (err) => {
      console.error('[YouTube] Chat listener error:', err.message || err);
      stopYouTubeListener();
    });

    youtubeLiveChat.start();
  } catch (e) {
    console.error('[YouTube Loader Error]:', e.message);
    stopYouTubeListener();
  }
}

function stopYouTubeListener() {
  if (youtubeLiveChat) {
    try {
      youtubeLiveChat.stop();
    } catch (e) {}
    youtubeLiveChat = null;
  }
  isYouTubeRunning = false;
  console.log('[YouTube] Listener stopped.');
}

// Section: Master Polling Engine (Lines 175-199)
async function loopWatcher() {
  const live = await isTwitchLive();
  console.log(`[Stream Gate] Twitch live state is: ${live}`);

  if (live) {
    startTikTokListener();
    if (!isYouTubeRunning) {
      startYouTubeListener();
    }
  } else {
    stopTikTokListener();
    if (isYouTubeRunning) {
      stopYouTubeListener();
    }
  }

  setTimeout(loopWatcher, 60000);
}

// Kick off loop
loopWatcher();
