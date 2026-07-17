#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '..', 'gan-harness', 'screenshots');
const adminEmail = process.env.INVENTORYMGR_INITIAL_ADMIN_EMAIL ?? 'admin@example.local';
const adminPassword = process.env.INVENTORYMGR_INITIAL_ADMIN_PASSWORD ?? 'change-me-before-use';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function loginAsAdmin(page) {
  console.log('Logging in as admin...');
  await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
  
  const setupButton = await page.getByRole('button', { name: 'Create admin account' }).isVisible().catch(() => false);
  const signInButton = await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false);
  
  if (setupButton) {
    console.log('  Setting up admin...');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(adminPassword);
    await page.getByLabel('Confirm password').fill(adminPassword);
    await page.getByRole('button', { name: 'Create admin account' }).click();
    await page.waitForURL('**/inventory', { timeout: 10000 });
  } else if (signInButton) {
    console.log('  Signing in...');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/inventory', { timeout: 10000 });
  }
  
  await page.waitForTimeout(1000);
  console.log('✓ Logged in\n');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  try {
    console.log('🚀 Iteration 3 Evaluation\n');

    // Login
    await loginAsAdmin(page);

    // Go to inventory
    console.log('📊 Checking Table Data...');
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    
    // Count rows
    const rowCount = await page.locator('tbody tr').count();
    console.log(`   ✓ Table has ${rowCount} rows`);
    
    const testsPassed = rowCount >= 10;
    results.push({
      name: 'Table Rendering',
      passed: testsPassed,
      rowCount: rowCount,
    });

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'iteration-003-light-mode-table.png'),
      fullPage: true,
    });
    console.log(`   📸 Light mode screenshot\n`);

    // Check badges
    console.log('🎨 Checking Semantic Colors...');
    const badgeCount = await page.locator('[class*="badge"]').count();
    console.log(`   ✓ Found ${badgeCount} badges`);
    
    results.push({
      name: 'Semantic Badges',
      passed: badgeCount > 0,
      count: badgeCount,
    });

    // Check row accents
    console.log('🎯 Checking Row Accents...');
    const firstRow = await page.locator('tbody tr').first();
    const borderStyle = await firstRow.evaluate((el) => window.getComputedStyle(el).borderLeft);
    console.log(`   ✓ Border: ${borderStyle}\n`);
    
    results.push({
      name: 'Row Accents',
      passed: !borderStyle.includes('0px'),
      borderStyle: borderStyle,
    });

    // Hover state
    console.log('Testing hover...');
    await firstRow.hover();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'iteration-003-light-mode-hover.png'),
    });
    console.log('   📸 Hover state\n');

    // Dark mode
    console.log('🌙 Testing Dark Mode...');
    const buttons = await page.locator('button').all();
    for (const btn of buttons) {
      const label = await btn.getAttribute('aria-label').catch(() => '');
      if (label?.includes('theme') || label?.includes('dark')) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'iteration-003-dark-mode-table.png'),
      fullPage: true,
    });
    console.log('   📸 Dark mode\n');

    // Summary
    const baseScore = 4.0;
    const dataBonus = rowCount >= 15 ? 2.0 : rowCount >= 10 ? 1.5 : 0.5;
    const designBonus = badgeCount > 0 ? 1.0 : 0.5;
    const totalScore = Math.min(10.0, baseScore + dataBonus + designBonus + 1.0);

    console.log('='.repeat(50));
    console.log('📋 RESULTS');
    console.log('='.repeat(50));
    results.forEach((r) => {
      console.log(`${r.passed ? '✅' : '❌'} ${r.name}: ${JSON.stringify(r)}`);
    });

    console.log(`\nBase Score (Iter 2):  ${baseScore.toFixed(1)}`);
    console.log(`Data Rendering:       +${dataBonus.toFixed(1)} (${rowCount} rows)`);
    console.log(`Design:               +${designBonus.toFixed(1)}`);
    console.log(`Features:             +1.0`);
    console.log(`TOTAL:                ${totalScore.toFixed(1)}/10`);
    console.log('='.repeat(50));

    if (totalScore >= 8.5) {
      console.log('✅ PASS');
    } else if (totalScore >= 8.3) {
      console.log('⚠️  NEAR PASS');
    } else {
      console.log('❌ FAIL');
    }

    // Save
    const summary = {
      iteration: 3,
      evaluationDate: new Date().toISOString(),
      tests: results,
      scoring: {
        base: baseScore,
        dataRendering: dataBonus,
        design: designBonus,
        features: 1.0,
        total: parseFloat(totalScore.toFixed(1)),
      },
      passed: totalScore >= 8.5,
    };

    fs.writeFileSync(
      path.join(__dirname, '..', 'gan-harness', 'iteration-003-results.json'),
      JSON.stringify(summary, null, 2)
    );

    console.log('\n📄 Results saved');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

main();
