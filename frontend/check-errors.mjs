#!/usr/bin/env node

import { chromium } from 'playwright';

async function checkErrors() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let errorCount = 0;
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errorCount++;
      console.log(`[ERROR] ${msg.text()}`);
    } else if (msg.type() === 'warn') {
      console.log(`[WARN] ${msg.text()}`);
    } else if (msg.type() === 'log') {
      console.log(`[LOG] ${msg.text()}`);
    }
  });
  
  page.on('pageerror', (err) => {
    console.log(`[PAGE ERROR] ${err.message}`);
  });
  
  try {
    console.log('Checking for errors and console output...\n');
    
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    
    console.log(`\nTotal console errors: ${errorCount}`);
    
    // Check React error boundary
    const hasErrorBoundary = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('error') || text.includes('Error');
    });
    
    console.log(`Page text contains "error": ${hasErrorBoundary}`);
    
  } finally {
    await browser.close();
  }
}

checkErrors();
