// Section: Web Server & Express Keep-Alive (Lines 2-14)
const express = require('express');
const TikTokLive = require('tiktok-live-connector');
const WebcastPushConnection = TikTokLive.WebcastPushConnection || TikTokLive;
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Chat Relay Worker (TikTok & Nimo) is running.'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// Section: Stream Target & Webhook Configuration (Lines 16-23)
const TIKTOK_USERNAME = 'k082412';
const TIKTOK_SESSION_ID = process.env.TIKTOK_SESSION_ID || '';
const TWITCH_CHANNEL = 'werewolf3788';
const NIMO_CHANNEL_ID = '1465016441';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec';

let isTwitchActive = false;
let tiktokLiveConnection = null;
let nimoBrowser = null;
let isNimoRunning = false;

// Section: DecAPI Twitch Stream Checker (Lines 25-37)
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

// Section: Dispatch to Google Apps Script (Lines 39-55)
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

// Section: TikTok Connection Manager (Lines 57-97)
function startTikTokListener() {
  if (tiktokLiveConnection) return;
  console.log(`[TikTok] Initializing connection for @${TIKTOK_USERNAME}...`);

  const connectionOptions = {
    enableExtendedGiftInfo: false
  };

  if (TIKTOK_SESSION_ID) {
    connectionOptions.sessionId = TIKTOK_SESSION_ID;
  }

  tiktokLiveConnection = new WebcastPushConnection(TIKTOK_USERNAME, connectionOptions);

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
}

// Section: Lightweight Nimo TV Headless Scraper (Lines 99-166)
async function startNimoListener() {
  if (isNimoRunning) return;
  isNimoRunning = true;
  console.log('[Nimo] Launching lightweight browser listener...');

  try {
    nimoBrowser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      defaultViewport: { width: 400, height: 600 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await nimoBrowser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.exposeFunction('sendNimoMessage', (user, text) => {
      relayToAppsScript('Nimo', user, text);
    });

    const popoutUrl = `https://dashboard.nimo.tv/popout/chat/${NIMO_CHANNEL_ID}`;
    await page.goto(popoutUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[Nimo] Page loaded. Watching DOM mutations...');

    await page.evaluate(() => {
      const seen = new Set();
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              const fullText = node.innerText || node.textContent || '';
              if (fullText && !seen.has(fullText)) {
                seen.add(fullText);
                if (seen.size > 200) seen.clear();

                const parts = fullText.split(':');
                if (parts.length >= 2) {
                  const user = parts[0].trim();
                  const msg = parts.slice(1).join(':').trim();
                  window.sendNimoMessage(user, msg);
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  } catch (err) {
    console.error('[Nimo] Listener encountered error:', err.message);
    stopNimoListener();
  }
}

function stopNimoListener() {
  if (nimoBrowser) {
    nimoBrowser.close().catch(() => {});
    nimoBrowser = null;
  }
  isNimoRunning = false;
  console.log('[Nimo] Listener stopped.');
}

// Section: Master Polling Engine (Lines 168-189)
async function loopWatcher() {
  const live = await isTwitchLive();

  console.log(`[Stream Gate] Twitch live state is: ${live}`);
  
  startTikTokListener();
  if (!isNimoRunning) {
    startNimoListener();
  }

  setTimeout(loopWatcher, 60000);
}

// Kick off loop
loopWatcher();
