#!/usr/bin/env node

import { chromium } from 'playwright';

async function inspect() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    
    // Get the rendered page content
    const html = await page.content();
    
    // Look for specific patterns
    console.log('HTML Analysis:');
    console.log(`  Contains "No VMs found": ${html.includes('No VMs found')}`);
    console.log(`  Contains "Create a VM": ${html.includes('Create a VM')}`);
    console.log(`  Contains "📦": ${html.includes('📦')}`);
    console.log(`  Contains "<table": ${html.includes('<table')}`);
    console.log(`  Contains "tbody": ${html.includes('tbody')}`);
    
    // Find the inventory section
    const match = html.match(/<section[^>]*>([\s\S]{0,2000})<\/section>/);
    if (match) {
      const section = match[1];
      console.log('\nFirst 800 chars of section:');
      console.log(section.substring(0, 800));
    }
    
  } finally {
    await browser.close();
  }
}

inspect();
