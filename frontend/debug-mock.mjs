#!/usr/bin/env node

import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', (msg) => {
    if (msg.type() === 'warn' || msg.type() === 'error') {
      console.log(`[${msg.type()}] ${msg.text()}`);
    }
  });
  
  try {
    console.log('Debugging mock data...\n');
    
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Inspect what's actually in the page
    const inspection = await page.evaluate(() => {
      const table = document.querySelector('table');
      const rows = document.querySelectorAll('tbody tr');
      return {
        hasTable: !!table,
        rowCount: rows.length,
        divCount: document.querySelectorAll('div').length,
        bodyContent: document.body.innerHTML.substring(0, 500),
      };
    });
    
    console.log('Page Inspection:');
    console.log(`  Has table: ${inspection.hasTable}`);
    console.log(`  Row count: ${inspection.rowCount}`);
    console.log(`  DIV count: ${inspection.divCount}`);
    console.log(`  Body snippet: ${inspection.bodyContent.substring(0, 200)}...`);
    
  } finally {
    await browser.close();
  }
}

debug();
