#!/usr/bin/env node

import { chromium } from 'playwright';

async function captureLogs() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const logs = [];
  
  page.on('console', (msg) => {
    const line = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    logs.push(line);
    console.log(line);
  });
  
  try {
    console.log('Loading inventory page and capturing all logs...\n');
    
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    console.log('\n=== All Captured Logs ===');
    logs.forEach((log) => console.log(log));
    
    // Check for specific strings
    console.log('\n=== Key Indicators ===');
    console.log(`Mock data found: ${logs.some((l) => l.includes('Mock data has'))}`);
    console.log(`Mock fallback triggered: ${logs.some((l) => l.includes('using mock data'))}`);
    console.log(`Error occurred: ${logs.some((l) => l.includes('[ERROR]'))}`);
    
  } finally {
    await browser.close();
  }
}

captureLogs();
