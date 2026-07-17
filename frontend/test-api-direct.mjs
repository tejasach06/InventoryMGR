#!/usr/bin/env node

import { chromium } from 'playwright';

async function testAPI() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Capture all console messages
  const messages = [];
  page.on('console', (msg) => {
    messages.push({ type: msg.type(), text: msg.text() });
  });
  
  // Capture network errors too
  page.on('response', (res) => {
    if (res.status() >= 400) {
      messages.push({ type: 'network', status: res.status(), url: res.url() });
    }
  });
  
  try {
    console.log('Testing API directly from page context\n');
    
    await page.goto('http://localhost:3000/inventory');
    await page.waitForTimeout(2000);
    
    // Execute code that calls the API
    const result = await page.evaluate(async () => {
      // This code runs in the page context where the modules are loaded
      // Try to fetch vms and see what happens
      try {
        const url = '/api/vms';
        const res = await fetch(url);
        return {
          status: res.status,
          statusText: res.statusText,
          ok: res.ok,
          url: url,
        };
      } catch (err) {
        return { error: err.message };
      }
    });
    
    console.log('\nAPI Fetch Result:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\nConsole Messages Captured:');
    messages.forEach((msg) => {
      if (msg.type === 'network') {
        console.log(`  [${msg.type}] ${msg.status} ${msg.url}`);
      } else {
        console.log(`  [${msg.type}] ${msg.text}`);
      }
    });
    
    // Check if any message contains "mock"
    const mockMentioned = messages.some((m) => 
      m.text?.includes('mock') || m.text?.includes('Mock')
    );
    console.log(`\n✓ Mock fallback mentioned: ${mockMentioned}`);
    
  } finally {
    await browser.close();
  }
}

testAPI();
