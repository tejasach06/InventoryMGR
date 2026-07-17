#!/usr/bin/env node

import { chromium } from 'playwright';

async function show() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    
    // Get the body text
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    console.log('Page Content:');
    console.log(bodyText.substring(0, 1000));
    
    // Check specific divs
    const divContent = await page.evaluate(() => {
      const mainDiv = document.querySelector('main');
      if (mainDiv) return mainDiv.innerText;
      const appDiv = document.querySelector('[role="application"]');
      if (appDiv) return appDiv.innerText;
      return 'No main or application div found';
    });
    
    console.log('\nMain/Application Content:');
    console.log(divContent.substring(0, 500));
    
  } finally {
    await browser.close();
  }
}

show();
