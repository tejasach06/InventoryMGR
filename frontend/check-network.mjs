#!/usr/bin/env node

import { chromium } from 'playwright';

async function checkNetwork() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const requests = [];
  const responses = [];
  
  page.on('request', (req) => {
    if (!req.url().includes('_next') && !req.url().includes('.map')) {
      requests.push({
        method: req.method(),
        url: req.url(),
      });
    }
  });
  
  page.on('response', (res) => {
    if (!res.url().includes('_next') && !res.url().includes('.map')) {
      responses.push({
        status: res.status(),
        url: res.url(),
      });
    }
  });
  
  try {
    console.log('Checking network requests for /inventory...\n');
    
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    
    console.log('Requests:');
    requests.forEach((r) => console.log(`  ${r.method} ${r.url}`));
    
    console.log('\nResponses:');
    responses.forEach((r) => console.log(`  ${r.status} ${r.url}`));
    
    console.log(`\nFinal URL: ${page.url()}`);
    
  } finally {
    await browser.close();
  }
}

checkNetwork();
