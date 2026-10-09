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

// Section: Stream Target & Webhook Endpoint (Lines 15-17)
const TIKTOK_USERNAME = 'k082412';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec';

// Section: Connection & Chat Event Listeners (Lines 19-58)
let tiktokLiveConnection = new WebcastPushConnection(TIKTOK_USERNAME);

function connectToTikTok() {
  console.log(`Attempting connection to TikTok user @${TIKTOK_USERNAME}...`);
  tiktokLiveConnection.connect().then(state => {
    console.log(`Connected to TikTok Room ID: ${state.roomId}`);
  }).catch(err => {
    console.log('Not live or connection error. Re-checking in 30 seconds.');
    setTimeout(connectToTikTok, 30000);
  });
}

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
  console.log('TikTok stream ended. Sleeping 60s before reconnect loop...');
  setTimeout(connectToTikTok, 60000);
});

tiktokLiveConnection.on('disconnected', () => {
  console.log('TikTok socket disconnected. Retrying in 15s...');
  setTimeout(connectToTikTok, 15000);
});

// Start loop
connectToTikTok();
