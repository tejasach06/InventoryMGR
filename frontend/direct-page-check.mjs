#!/usr/bin/env node

import { chromium } from 'playwright';

async function checkPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Go directly to inventory
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load', timeout: 15000 });
    
    // Check if we're on login or inventory
    const isLogin = page.url().includes('/login');
    console.log(`Current URL: ${page.url()}`);
    console.log(`On login page: ${isLogin}`);
    
    // Try to find table anyway
    await page.waitForTimeout(1000);
    const tableCount = await page.locator('table').count();
    const rowCount = await page.locator('tbody tr').count();
    
    console.log(`Tables found: ${tableCount}`);
    console.log(`Table rows: ${rowCount}`);
    
    // Check page content
    const content = await page.content();
    console.log(`Page contains "admin@example": ${content.includes('admin@example')}`);
    console.log(`Page contains "Sign in": ${content.includes('Sign in')}`);
    console.log(`Page contains "Create admin": ${content.includes('Create admin')}`);
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/check.png' });
    console.log('Screenshot saved to /tmp/check.png');
    
  } finally {
    await browser.close();
  }
}

checkPage();
