#!/usr/bin/env node

import { chromium } from 'playwright';

async function checkConsole() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const logs = [];
  const errors = [];
  const warnings = [];
  
  // Capture console messages
  page.on('console', (msg) => {
    if (msg.type() === 'log') logs.push(msg.text());
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warn') warnings.push(msg.text());
  });
  
  try {
    console.log('Loading inventory page and capturing console...\n');
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    
    console.log('WARNINGS:');
    warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
    
    console.log('\nERRORS:');
    errors.forEach((e) => console.log(`  ❌ ${e}`));
    
    console.log('\nLOGS:');
    logs.slice(-10).forEach((l) => console.log(`  📝 ${l}`));
    
    // Check if mock fallback was triggered
    const mockTriggered = warnings.some((w) => w.includes('mock') || w.includes('Mock')) ||
                          logs.some((l) => l.includes('mock') || l.includes('Mock'));
    
    console.log(`\n✅ Mock fallback triggered: ${mockTriggered}`);
    
  } finally {
    await browser.close();
  }
}

checkConsole();
