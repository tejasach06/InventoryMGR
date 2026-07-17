#!/usr/bin/env node

import { chromium } from 'playwright';

async function testMockData() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('🧪 Testing Mock Data Fallback\n');
    
    // Navigate to any page  
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    
    // Inject code to test the API client directly
    const result = await page.evaluate(async () => {
      // This runs in the browser context where the app's modules are available
      // Try to access the vms API through the window object if exposed
      
      // Wait for app to load
      await new Promise(r => setTimeout(r, 1000));
      
      // Check if there's mock data in the source
      const scriptTags = Array.from(document.querySelectorAll('script'));
      let hasMockData = false;
      
      for (const script of scriptTags) {
        if (script.textContent && script.textContent.includes('mockVms')) {
          hasMockData = true;
          break;
        }
      }
      
      return {
        hasMockData,
        pageTitle: document.title,
        hasSignIn: document.body.textContent.includes('Sign in'),
        hasTable: !!document.querySelector('table'),
      };
    });
    
    console.log('Page Analysis:');
    console.log(`  Mock data in source: ${result.hasMockData}`);
    console.log(`  Page title: ${result.pageTitle}`);
    console.log(`  Has "Sign in": ${result.hasSignIn}`);
    console.log(`  Has table: ${result.hasTable}`);
    
    // Try to fetch vms from API directly
    console.log('\nTesting API directly:');
    const vmsResponse = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/vms');
        const data = await res.json();
        return {
          status: res.status,
          itemCount: data.items?.length || 0,
          total: data.total || 0,
        };
      } catch (err) {
        return { error: err.message };
      }
    });
    
    console.log(JSON.stringify(vmsResponse, null, 2));
    
  } finally {
    await browser.close();
  }
}

testMockData();
