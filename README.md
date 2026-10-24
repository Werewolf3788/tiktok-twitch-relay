Cloud-Based Multi-Platform Chat Relay to Twitch (PC-Off / Console)
A cloud relay engine designed for console and mobile streamers who broadcast without a local computer. Incoming chat messages from TikTok Live, YouTube Live, and Nimo TV are captured in the cloud and broadcast directly into your Twitch chat via a dedicated moderator bot account.

Architecture Flow
Plaintext
  ┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
  │    TikTok Live Chat    │      │   YouTube Live Chat    │      │    Nimo TV Live Chat   │
  │    (TikFinity Webhook) │      │  (youtube-chat Socket) │      │   (Headless Chromium)  │
  └───────────┬────────────┘      └───────────┬────────────┘      └───────────┬────────────┘
              │                               │                               │
              │                               └───────────────┬───────────────┘
              │                                               │
              │ HTTP GET (URL Query Params)                   │ HTTP POST (JSON Payload)
              │                                               ▼
              │                                ┌─────────────────────────────┐
              │                                │ Render.com Free Web Service │
              │                                │ (Node.js Keep-Alive Worker) │
              │                                └──────────────┬──────────────┘
              │                                               │ HTTP POST (JSON Payload)
              └───────────────────────┬───────────────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────┐
                       │  Google Apps Script Web App │
                       │    (doGet / doPost Hub)     │
                       └──────────────┬──────────────┘
                                      │ Twitch Helix REST API
                                      ▼
                       ┌─────────────────────────────┐
                       │      Twitch Live Chat       │
                       │ (Delivered via Bot Account) │
                       └─────────────────────────────┘
DecAPI Stream Check: The worker monitors your stream status via DecAPI. When offline, worker processes stay idle to conserve memory and avoid rate limits.

Cloud Ingestion (Render.com):

Ingests YouTube Live chat events in real time using persistent WebSocket connections (youtube-chat).

Ingests Nimo TV live chat through a headless browser instance (@sparticuz/chromium + puppeteer-core) optimized for 512 MB cloud environments.

Cloud Ingestion (TikFinity Actions & Events):

Intercepts TikTok Live chat on TikFinity's cloud servers and pushes query strings directly to the Google Apps Script endpoint via outbound HTTP Webhook triggers.

Dispatch Layer (Google Apps Script): Receives HTTP POST JSON payloads from Render and HTTP GET query parameters from TikFinity, then posts into Twitch chat using the Twitch Helix API (/helix/chat/messages).

🔗 Quick Setup Links
Twitch Developer Console

Google Apps Script Dashboard

TikFinity Actions & Events

Render.com Dashboard

DecAPI Documentation

cron-job.org (Free Uptime Pings)

Step 1: Twitch Developer & Bot Setup
1. Bot Moderation
To bypass standard chat rate limits (raising allowances to 100 messages per 30 seconds), open your main channel's Twitch chat and run:

Plaintext
/mod modem3788
2. Register Application
Go to the Twitch Developer Console.

Click Register Your Application.

Set OAuth Redirect URLs to https://localhost.

Choose Chat Bot under Category, save, and copy your Client ID.

3. Generate Bot OAuth Token
Open an Incognito window and log into Twitch as your Bot Account (modem3788).

Visit this authorization URL in your browser (substitute YOUR_CLIENT_ID):

Plaintext
https://id.twitch.tv/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://localhost&response_type=token&scope=user:write:chat+user:read:chat+chat:edit
Click Authorize.

The browser will redirect to https://localhost/#access_token=.... Copy the string between #access_token= and &scope.

4. Locate Channel & Bot Numeric IDs
Twitch requires numeric IDs for dispatch. Use DecAPI to retrieve them:

Broadcaster ID: Visit [https://decapi.me/twitch/id/werewolf3788](https://decapi.me/twitch/id/werewolf3788)

Bot Sender ID: Visit [https://decapi.me/twitch/id/modem3788](https://decapi.me/twitch/id/modem3788)

Step 2: Google Apps Script Dispatcher
Navigate to Google Apps Script and open your project.

Replace all code in Code.gs with the following:

JavaScript
// Section: Configuration & Identity Constants (Lines 2-12)
const TWITCH_CONFIG = {
  clientId: "8ubk5i0cuupez9vd5jgvu2qphkc2gf",
  userOAuthToken: "kincszoi7focc5efl78yehxiaqgnu7", // Extracted token for modem3788
  broadcasterId: "896952944",                        // werewolf3788
  senderId: "1556323775",                            // modem3788
  channelName: "werewolf3788"
};

// Section: Stream Uptime Gatekeeper (Lines 14-25)
function isStreamLive() {
  const uptimeUrl = "https://decapi.me/twitch/uptime/" + TWITCH_CONFIG.channelName;
  try {
    const res = UrlFetchApp.fetch(uptimeUrl, { muteHttpExceptions: true });
    const text = res.getContentText().trim().toLowerCase();
    return !text.includes("offline");
  } catch (err) {
    Logger.log("Failed to query DecAPI uptime: " + err);
    return false;
  }
}

// Section: Helix Chat Message Dispatcher (Lines 27-56)
function sendTwitchChatMessage(rawMessage) {
  const endpoint = "https://api.twitch.tv/helix/chat/messages";

  const payload = {
    broadcaster_id: TWITCH_CONFIG.broadcasterId,
    sender_id: TWITCH_CONFIG.senderId,
    message: rawMessage.substring(0, 500)
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Client-Id": TWITCH_CONFIG.clientId,
      "Authorization": "Bearer " + TWITCH_CONFIG.userOAuthToken
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode === 200) {
    Logger.log("Message delivered via modem3788: " + rawMessage);
  } else {
    Logger.log("Error posting to chat (" + statusCode + "): " + responseText);
  }
}

// Section: Inbound HTTP POST Webhook Receiver (Lines 58-105)
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput("Empty payload").setMimeType(ContentService.MimeType.TEXT);
    }

    const data = JSON.parse(e.postData.contents);

    let username = "Viewer";
    if (data.username) {
      username = data.username;
    } else if (data.nickname) {
      username = data.nickname;
    } else if (data.uniqueId || data.unique_id) {
      username = data.uniqueId || data.unique_id;
    }

    let message = "";
    if (data.comment) {
      message = data.comment;
    } else if (data.message) {
      message = data.message;
    } else if (data.text) {
      message = data.text;
    }

    // Drop empty messages or loops originating from Twitch
    if (!message || (data.platform && data.platform.toLowerCase() === "twitch")) {
      return ContentService.createTextOutput("Ignored").setMimeType(ContentService.MimeType.TEXT);
    }

    // Displays "username: message"
    const formatted = `${username}: ${message}`;
    sendTwitchChatMessage(formatted);

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    Logger.log("doPost error: " + err);
    return ContentService.createTextOutput("Error: " + err).setMimeType(ContentService.MimeType.TEXT);
  }
}

// Section: Inbound HTTP GET Webhook Receiver for TikFinity (Lines 107-133)
function doGet(e) {
  try {
    if (!e || !e.parameter) {
      return ContentService.createTextOutput("Endpoint active. No query parameters received.").setMimeType(ContentService.MimeType.TEXT);
    }

    const username = e.parameter.user || e.parameter.username || "Viewer";
    const message = e.parameter.msg || e.parameter.message || e.parameter.comment || "";

    if (!message) {
      return ContentService.createTextOutput("Ignored empty message").setMimeType(ContentService.MimeType.TEXT);
    }

    // Displays "username: message"
    const formatted = `${username}: ${message}`;
    sendTwitchChatMessage(formatted);

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    Logger.log("doGet error: " + err);
    return ContentService.createTextOutput("Error: " + err).setMimeType(ContentService.MimeType.TEXT);
  }
}

// Section: Manual Test Function (Lines 135-138)
function testRelayBot() {
  sendTwitchChatMessage("[Relay Engine] modem3788 is connected and ready to relay.");
}
Deploy the Web App:

Click Deploy > Manage deployments.

Click the Edit (pencil) icon.

Version: select New version.

Click Deploy and confirm your Web App URL matches:

Plaintext
https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec
Step 3: TikFinity Cloud Webhook Setup (TikTok)
Open TikFinity Actions.

Click Create new Action.

Set Name: Twitch Chat Webhook.

Check Trigger WebHook.

Paste this exact target URL into the WebHook field:

Plaintext
https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec?user=%username%&msg=%commandParams%&platform=TikTok
Ensure Global Cooldown and User Cooldown are set to 0 seconds.

Click Save Action.

Go to Events on the left menu:

Click Create new Event.

Trigger Event: Chat Message (or User sends a comment).

Actions: Check Twitch Chat Webhook.

Click Save Event.

Step 4: Render Ingestion Service Files (YouTube & Nimo TV)
In your GitHub repository (Werewolf3788/tiktok-twitch-relay), maintain these two files:

package.json
JSON
{
  "name": "tiktok-twitch-relay",
  "version": "1.0.0",
  "description": "TikTok, Nimo TV & YouTube Live Chat to Twitch Relay",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@sparticuz/chromium": "^131.0.1",
    "express": "^4.19.2",
    "puppeteer-core": "^23.6.0",
    "tiktok-live-connector": "^2.0.0",
    "youtube-chat": "^2.2.0"
  }
}
server.js
JavaScript
// Section: Web Server & Express Keep-Alive (Lines 2-18)
const express = require('express');
const TikTokPackage = require('tiktok-live-connector');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { LiveChat } = require('youtube-chat');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Chat Relay Worker (TikTok, Nimo & YouTube) is running.'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// Section: Stream Target & Webhook Configuration (Lines 20-33)
const TIKTOK_USERNAME = 'k082412';
const TIKTOK_SESSION_ID = process.env.TIKTOK_SESSION_ID || '';
const TWITCH_CHANNEL = 'werewolf3788';
const NIMO_CHANNEL_ID = '1465016441';
const YOUTUBE_CHANNEL_ID = 'UCYrxPkCw_Q2Fw02VFfumfyQ';
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyBD9lXckvfxNP0McP5kDuyKy8nX9LwAkXWCak_sHjPEytMH_4RYyLrjP4aZyqigJKR/exec';

let isTwitchActive = false;
let tiktokLiveConnection = null;
let nimoBrowser = null;
let isNimoRunning = false;
let youtubeLiveChat = null;
let isYouTubeRunning = false;

// Section: Universal TikTok Constructor Resolver (Lines 35-47)
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

// Section: DecAPI Twitch Stream Checker (Lines 49-61)
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

// Section: Dispatch to Google Apps Script (Lines 63-79)
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

// Section: TikTok Connection Manager (Lines 81-127)
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

// Section: Lightweight Nimo TV Headless Scraper (Lines 129-196)
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

// Section: YouTube Live Chat Listener (Lines 198-238)
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

// Section: Master Polling Engine (Lines 240-272)
async function loopWatcher() {
  const live = await isTwitchLive();
  console.log(`[Stream Gate] Twitch live state is: ${live}`);

  if (live) {
    startTikTokListener();
    if (!isNimoRunning) {
      startNimoListener();
    }
    if (!isYouTubeRunning) {
      startYouTubeListener();
    }
  } else {
    if (isNimoRunning) {
      stopNimoListener();
    }
    if (isYouTubeRunning) {
      stopYouTubeListener();
    }
    if (tiktokLiveConnection) {
      try {
        tiktokLiveConnection.disconnect();
      } catch (e) {}
      tiktokLiveConnection = null;
    }
  }

  setTimeout(loopWatcher, 60000);
}

// Kick off loop
loopWatcher();
Step 5: Render Deployment Settings
Connect your repository on dashboard.render.com.

Select Web Service.

Configure the build parameters:

Runtime: Node

Build Command: npm install

Start Command: node server.js

Instance Type: Free

Deploy the service.

Step 6: Keep-Alive Ping (Preventing Sleep)
Free Render instances suspend after 15 minutes of inbound inactivity. To keep your background listener running:

Open cron-job.org.

Set up an HTTP GET request pointing to your Render service URL (e.g., [https://tiktok-twitch-relay.onrender.com](https://tiktok-twitch-relay.onrender.com)).

Set the schedule to ping every 10 minutes.
