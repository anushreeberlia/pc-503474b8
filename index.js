const express = require('express');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ port: 8080 });

app.use(express.json());
app.use(express.static('public'));

// In-memory storage (in production, use a proper database)
let userCredentials = null;
let botStatus = {
  isRunning: false,
  lastRun: null,
  nextRun: null,
  message: 'Bot not configured',
  reservations: []
};

// Broadcast status to all connected clients
function broadcastStatus() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(botStatus));
    }
  });
}

// Update bot status
function updateStatus(updates) {
  Object.assign(botStatus, updates);
  broadcastStatus();
}

// Tennis court reservation logic
async function reserveCourt() {
  if (!userCredentials) {
    updateStatus({ message: 'No credentials configured' });
    return;
  }

  updateStatus({ isRunning: true, message: 'Starting reservation attempt...' });
  
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Navigate to SF Rec & Parks tennis reservation page
    updateStatus({ message: 'Navigating to reservation page...' });
    await page.goto('https://sfrecpark.org/1446/Reservable-Tennis-Courts', { waitUntil: 'networkidle2' });
    
    // Look for Alice Marble tennis courts reservation link
    updateStatus({ message: 'Looking for Alice Marble courts...' });
    
    // This is a simplified version - the actual implementation would need to:
    // 1. Find the specific reservation system link
    // 2. Navigate through the booking system
    // 3. Login with credentials
    // 4. Select Alice Marble courts
    // 5. Choose available time slots
    // 6. Complete the reservation
    
    // For demonstration, we'll simulate the process
    await page.waitForTimeout(2000);
    
    // Look for reservation links (this would need to be adapted based on actual page structure)
    const reservationLinks = await page.$$eval('a', links => 
      links.filter(link => 
        link.textContent.toLowerCase().includes('alice marble') ||
        link.textContent.toLowerCase().includes('reservation') ||
        link.textContent.toLowerCase().includes('book')
      ).map(link => ({ text: link.textContent, href: link.href }))
    );
    
    if (reservationLinks.length === 0) {
      updateStatus({ message: 'No reservation links found for Alice Marble courts' });
      return;
    }
    
    updateStatus({ message: `Found ${reservationLinks.length} potential reservation links` });
    
    // Navigate to the first relevant link
    await page.goto(reservationLinks[0].href, { waitUntil: 'networkidle2' });
    
    // Attempt to login (this would need to be customized based on the actual login form)
    updateStatus({ message: 'Attempting to login...' });
    
    try {
      // Look for login form
      await page.waitForSelector('input[type="email"], input[type="text"][name*="user"], input[name*="login"]', { timeout: 5000 });
      
      const usernameField = await page.$('input[type="email"], input[type="text"][name*="user"], input[name*="login"]');
      const passwordField = await page.$('input[type="password"]');
      
      if (usernameField && passwordField) {
        await usernameField.type(userCredentials.username);
        await passwordField.type(userCredentials.password);
        
        // Look for submit button
        const submitButton = await page.$('button[type="submit"], input[type="submit"], button[name*="login"], button[name*="submit"]');
        if (submitButton) {
          await submitButton.click();
          await page.waitForNavigation({ waitUntil: 'networkidle2' });
          updateStatus({ message: 'Login successful, looking for available courts...' });
        }
      }
    } catch (loginError) {
      updateStatus({ message: 'Login form not found or login failed' });
    }
    
    // Look for Alice Marble courts and available time slots
    updateStatus({ message: 'Searching for available Alice Marble court slots...' });
    
    // This would need to be customized based on the actual reservation interface
    const availableSlots = await page.evaluate(() => {
      // Look for elements that might represent available time slots
      const slots = [];
      const elements = document.querySelectorAll('[class*="slot"], [class*="time"], [class*="available"], .calendar-day');
      
      elements.forEach(el => {
        if (el.textContent && !el.textContent.toLowerCase().includes('unavailable')) {
          slots.push({
            text: el.textContent.trim(),
            clickable: el.tagName === 'BUTTON' || el.onclick || el.getAttribute('data-*')
          });
        }
      });
      
      return slots;
    });
    
    if (availableSlots.length > 0) {
      updateStatus({ 
        message: `Found ${availableSlots.length} potential slots, attempting to book...`,
        reservations: [...botStatus.reservations, {
          timestamp: new Date().toISOString(),
          status: 'attempt',
          court: 'Alice Marble',
          slots: availableSlots.length
        }]
      });
      
      // In a real implementation, this would click on the first available slot and complete booking
      // For now, we'll simulate a successful booking
      updateStatus({ 
        message: 'Reservation attempt completed (simulated)',
        reservations: [...botStatus.reservations, {
          timestamp: new Date().toISOString(),
          status: 'success',
          court: 'Alice Marble',
          details: 'Simulated booking - implement actual booking logic'
        }]
      });
    } else {
      updateStatus({ 
        message: 'No available slots found',
        reservations: [...botStatus.reservations, {
          timestamp: new Date().toISOString(),
          status: 'no_slots',
          court: 'Alice Marble'
        }]
      });
    }
    
  } catch (error) {
    console.error('Reservation error:', error);
    updateStatus({ 
      message: `Error during reservation: ${error.message}`,
      reservations: [...botStatus.reservations, {
        timestamp: new Date().toISOString(),
        status: 'error',
        court: 'Alice Marble',
        error: error.message
      }]
    });
  } finally {
    if (browser) {
      await browser.close();
    }
    updateStatus({ 
      isRunning: false, 
      lastRun: new Date().toISOString(),
      nextRun: getNextRunTime()
    });
  }
}

// Calculate next run time (typically when reservations open)
function getNextRunTime() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0); // Assume reservations open at 8 AM
  return tomorrow.toISOString();
}

// Schedule the bot to run when reservations typically open
// This runs every day at 8:00 AM (when many reservation systems open)
cron.schedule('0 8 * * *', () => {
  console.log('Running scheduled tennis court reservation check...');
  reserveCourt();
});

// Also check every hour during peak booking times (7 AM - 10 AM)
cron.schedule('0 7-10 * * *', () => {
  console.log('Running hourly tennis court check...');
  reserveCourt();
});

// API Routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'SF Tennis Bot is running',
    botStatus: botStatus,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/credentials', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  userCredentials = { username, password };
  updateStatus({ message: 'Credentials updated successfully' });
  
  res.json({ success: true, message: 'Credentials saved' });
});

app.get('/api/status', (req, res) => {
  res.json(botStatus);
});

app.post('/api/run-now', (req, res) => {
  if (botStatus.isRunning) {
    return res.status(400).json({ error: 'Bot is already running' });
  }
  
  // Run the reservation attempt immediately
  reserveCourt();
  
  res.json({ success: true, message: 'Reservation attempt started' });
});

app.delete('/api/credentials', (req, res) => {
  userCredentials = null;
  updateStatus({ message: 'Credentials cleared' });
  res.json({ success: true, message: 'Credentials cleared' });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Send current status to new client
  ws.send(JSON.stringify(botStatus));
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Initialize status
updateStatus({ nextRun: getNextRunTime() });

app.listen(port, () => {
  console.log(`SF Tennis Bot server running on port ${port}`);
  console.log(`WebSocket server running on port 8080`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  wss.close();
  process.exit(0);
});