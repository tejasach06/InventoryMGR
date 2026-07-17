const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function evaluateApp() {
  let browser, context;
  try {
    browser = await chromium.launch({ headless: false });

    // Light mode test
    console.log('\n=== LIGHT MODE TEST ===');
    context = await browser.createContext();
    const lightPage = await context.newPage();
    await lightPage.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    await lightPage.waitForTimeout(2000); // Wait for animations
    
    const lightScreenPath = 'gan-harness/screenshots/iteration-002-light-inventory.png';
    await lightPage.screenshot({ path: lightScreenPath, fullPage: true });
    console.log(`✓ Light mode screenshot: ${lightScreenPath}`);
    
    // Inspect light mode elements
    const lightDesign = await lightPage.evaluate(() => {
      const filterBar = document.querySelector('[class*="filter"]') || document.querySelector('[class*="Filter"]');
      const badge = document.querySelector('[class*="badge"]') || document.querySelector('[class*="Badge"]');
      const row = document.querySelector('tr') || document.querySelector('[role="row"]');
      
      return {
        filterBar: filterBar ? {
          classes: filterBar.className,
          computed: window.getComputedStyle(filterBar),
          padding: window.getComputedStyle(filterBar).padding,
          backgroundColor: window.getComputedStyle(filterBar).backgroundColor,
          borderBottom: window.getComputedStyle(filterBar).borderBottom,
        } : null,
        badge: badge ? {
          classes: badge.className,
          color: window.getComputedStyle(badge).color,
          backgroundColor: window.getComputedStyle(badge).backgroundColor,
        } : null,
        row: row ? {
          classes: row.className,
          borderLeft: window.getComputedStyle(row).borderLeft,
        } : null,
      };
    });
    console.log('Light mode design:', JSON.stringify(lightDesign, null, 2));
    
    await context.close();

    // Dark mode test
    console.log('\n=== DARK MODE TEST ===');
    context = await browser.createContext({
      colorScheme: 'dark'
    });
    const darkPage = await context.newPage();
    await darkPage.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    await darkPage.waitForTimeout(2000);
    
    const darkScreenPath = 'gan-harness/screenshots/iteration-002-dark-inventory.png';
    await darkPage.screenshot({ path: darkScreenPath, fullPage: true });
    console.log(`✓ Dark mode screenshot: ${darkScreenPath}`);
    
    // Inspect dark mode elements
    const darkDesign = await darkPage.evaluate(() => {
      const filterBar = document.querySelector('[class*="filter"]') || document.querySelector('[class*="Filter"]');
      const badge = document.querySelector('[class*="badge"]') || document.querySelector('[class*="Badge"]');
      const row = document.querySelector('tr') || document.querySelector('[role="row"]');
      
      return {
        filterBar: filterBar ? {
          classes: filterBar.className,
          padding: window.getComputedStyle(filterBar).padding,
          backgroundColor: window.getComputedStyle(filterBar).backgroundColor,
          borderBottom: window.getComputedStyle(filterBar).borderBottom,
          boxShadow: window.getComputedStyle(filterBar).boxShadow,
        } : null,
        badge: badge ? {
          classes: badge.className,
          color: window.getComputedStyle(badge).color,
          backgroundColor: window.getComputedStyle(badge).backgroundColor,
          boxShadow: window.getComputedStyle(badge).boxShadow,
        } : null,
        row: row ? {
          classes: row.className,
          borderLeft: window.getComputedStyle(row).borderLeft,
          animation: window.getComputedStyle(row).animation,
        } : null,
      };
    });
    console.log('Dark mode design:', JSON.stringify(darkDesign, null, 2));
    
    // Test interactions
    console.log('\n=== INTERACTION TESTS ===');
    
    // Check for animations
    const animations = await darkPage.evaluate(() => {
      const rows = document.querySelectorAll('tr, [role="row"]');
      const animationInfo = [];
      rows.forEach((row, idx) => {
        if (idx < 3) {
          const computed = window.getComputedStyle(row);
          animationInfo.push({
            index: idx,
            animation: computed.animation,
            transition: computed.transition,
          });
        }
      });
      return animationInfo;
    });
    console.log('Row animations:', JSON.stringify(animations, null, 2));
    
    // Check for filter pills
    const filterPills = await darkPage.locator('[class*="pill"], [class*="Pill"], button:has-text("filter"), [role="button"]').count();
    console.log(`Filter pills found: ${filterPills}`);
    
    // Test hover effects
    const firstRow = darkPage.locator('tr').first();
    if (await firstRow.count() > 0) {
      await firstRow.hover();
      await darkPage.waitForTimeout(500);
      const hoverScreenPath = 'gan-harness/screenshots/iteration-002-dark-inventory-hover.png';
      await darkPage.screenshot({ path: hoverScreenPath, fullPage: false });
      console.log(`✓ Hover state screenshot: ${hoverScreenPath}`);
    }
    
    await context.close();
    console.log('\n=== EVALUATION COMPLETE ===');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) await browser.close();
  }
}

evaluateApp();
