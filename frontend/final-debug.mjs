#!/usr/bin/env node

import { chromium } from 'playwright';

async function debugFinal() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Final Debug - Direct Page Inspection\n');
    
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    
    // Get the actual HTML content
    const html = await page.content();
    
    // Check for key elements
    const has = {
      table: html.includes('<table'),
      tbody: html.includes('<tbody'),
      vmTable: html.includes('VmTable'),
      mockWarning: html.includes('mock data'),
      inventoryPage: html.includes('InventoryPage'),
    };
    
    console.log('HTML Content Check:');
    Object.entries(has).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
    
    // Take a screenshot to see what's actually rendered
    await page.screenshot({
      path: '/tmp/final-debug.png',
      fullPage: true,
    });
    console.log('\nScreenshot saved to /tmp/final-debug.png');
    
    // Count various elements
    const counts = await page.evaluate(() => ({
      tables: document.querySelectorAll('table').length,
      rows: document.querySelectorAll('tbody tr').length,
      buttons: document.querySelectorAll('button').length,
      headings: document.querySelectorAll('h1, h2, h3').length,
      links: document.querySelectorAll('a').length,
    }));
    
    console.log('\nElement Counts:');
    Object.entries(counts).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
    
  } finally {
    await browser.close();
  }
}

debugFinal();
