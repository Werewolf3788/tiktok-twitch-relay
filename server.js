// Section: Keep-Alive Server for Render (Lines 2-13)
const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('TikTok to Twitch Relay Worker is running.');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

// Section: Stream Target & Webhook Endpoint (Lines 15-18)
const TIKTOK_USERNAME = 'k082412';
const TWITCH_CHANNEL = 'werewolf3788';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec';

let isConnected = false;
let tiktokLiveConnection = null;

// Section: DecAPI Twitch Stream Checker (Lines 23-34)
async function isTwitchLive() {
  try {
    const res = await fetch(`https://decapi.me/twitch/uptime/${TWITCH_CHANNEL}`);
    const text = await res.text();
    return !text.toLowerCase().includes('offline');
  } catch (err) {
    console.error('DecAPI check failed:', err.message);
    return false;
  }
}

// Section: Dynamic Connection Loop (Lines 36-74)
async function checkAndConnect() {
  const live = await isTwitchLive();

  if (!live) {
    console.log(`[Twitch Offline] DecAPI reports ${TWITCH_CHANNEL} is offline. Skipping TikTok connect.`);
    if (isConnected && tiktokLiveConnection) {
      tiktokLiveConnection.disconnect();
      isConnected = false;
    }
    // Check again in 60 seconds
    setTimeout(checkAndConnect, 60000);
    return;
  }

  // If Twitch IS live and not yet hooked to TikTok:
  if (!isConnected) {
    console.log(`[Twitch Live!] Attempting TikTok connection for @${TIKTOK_USERNAME}...`);
    
    tiktokLiveConnection = new WebcastPushConnection(TIKTOK_USERNAME);

    tiktokLiveConnection.connect().then(state => {
      isConnected = true;
      console.log(`Connected to TikTok Room ID: ${state.roomId}`);
    }).catch(err => {
      console.log('TikTok not live yet or error connecting. Retrying in 30s...');
      setTimeout(checkAndConnect, 30000);
    });

    // Inbound Chat Relay
    tiktokLiveConnection.on('chat', data => {
      const payload = {
        platform: 'TikTok',
        username: data.nickname || data.uniqueId,
        message: data.comment
      };

      fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.text())
      .then(() => console.log(`[Relayed] ${data.uniqueId}: ${data.comment}`))
      .catch(err => console.error('Error posting to Google Apps Script:', err));
    });

    tiktokLiveConnection.on('streamEnd', () => {
      console.log('TikTok stream ended.');
      isConnected = false;
      setTimeout(checkAndConnect, 60000);
    });

    tiktokLiveConnection.on('disconnected', () => {
      console.log('TikTok socket disconnected.');
      isConnected = false;
      setTimeout(checkAndConnect, 30000);
    });
  } else {
    // Already connected, verify again in 2 minutes
    setTimeout(checkAndConnect, 120000);
  }
}

// Start master watcher loop
checkAndConnect();
