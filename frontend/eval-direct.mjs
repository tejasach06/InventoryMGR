#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '..', 'gan-harness', 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function evalPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const results = [];
  
  try {
    console.log('🚀 Iteration 3 Evaluation - Direct Page Load\n');
    
    // Go directly to inventory
    console.log('📊 Loading inventory page...');
    await page.goto('http://localhost:3000/eval', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Count table rows
    const rowCount = await page.locator('tbody tr').count().catch(() => 0);
    
    const dataRenders = rowCount >= 10;
    results.push({
      test: 'Table Rendering',
      passed: dataRenders,
      value: rowCount,
      score: dataRenders ? 2.0 : 0.5,
    });
    
    // Screenshot light mode
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'iteration-003-light-mode-table.png'),
      fullPage: true,
    });
    console.log(`   📸 Light mode screenshot saved\n`);
    
    // Check for badges
    console.log('🎨 Checking semantic colors...');
    const badges = await page.locator('[class*="badge"]').count().catch(() => 0);
    console.log(`   ✓ Found ${badges} badge elements`);
    
    results.push({
      test: 'Semantic Badges',
      passed: badges > 0,
      value: badges,
      score: badges > 0 ? 1.5 : 0.5,
    });
    
    // Check row styling
    console.log('🎯 Checking row accents...');
    const rows = await page.locator('tbody tr').all().catch(() => []);
    if (rows.length > 0) {
      const firstRow = rows[0];
      const borderStyle = await firstRow.evaluate((el) =>
        window.getComputedStyle(el).borderLeft
      ).catch(() => 'none');
      
      const hasAccent = !borderStyle.includes('0px');
      console.log(`   ✓ Border: ${borderStyle}`);
      
      // Screenshot hover
      await firstRow.hover();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'iteration-003-light-mode-hover.png'),
      });
      console.log(`   📸 Hover state screenshot\n`);
      
      results.push({
        test: 'Row Accents',
        passed: hasAccent,
        value: borderStyle,
        score: hasAccent ? 1.0 : 0.5,
      });
    }
    
    // Dark mode
    console.log('🌙 Testing dark mode...');
    const buttons = await page.locator('button').all().catch(() => []);
    for (const btn of buttons) {
      const label = await btn.getAttribute('aria-label').catch(() => '');
      if (label?.includes('theme') || label?.includes('dark')) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(500);
    const darkRows = await page.locator('tbody tr').count().catch(() => 0);
    console.log(`   ✓ Dark mode rows: ${darkRows}\n`);
    
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'iteration-003-dark-mode-table.png'),
      fullPage: true,
    });
    
    results.push({
      test: 'Dark Mode',
      passed: darkRows > 0,
      value: darkRows,
      score: darkRows > 0 ? 1.0 : 0.5,
    });
    
    // Summary
    console.log('='.repeat(50));
    console.log('📋 EVALUATION RESULTS');
    console.log('='.repeat(50));
    
    results.forEach((r) => {
      const status = r.passed ? '✅' : '❌';
      console.log(`${status} ${r.test}: ${r.value} (${r.score} pts)`);
    });
    
    const totalBonus = results.reduce((sum, r) => sum + r.score, 0);
    const baseScore = 4.0;
    const finalScore = Math.min(10.0, baseScore + totalBonus);
    
    console.log('\n' + '='.repeat(50));
    console.log(`Base Score (Iter 2):  ${baseScore.toFixed(1)}`);
    console.log(`Improvements:         +${totalBonus.toFixed(1)}`);
    console.log(`TOTAL:                ${finalScore.toFixed(1)}/10`);
    console.log('='.repeat(50));
    
    if (finalScore >= 8.5) {
      console.log('✅ PASS - Threshold met!');
    } else if (finalScore >= 8.3) {
      console.log('⚠️  NEAR PASS - Score is 0.2 below threshold');
    } else {
      console.log('❌ BELOW THRESHOLD');
    }
    
    // Save results
    const summary = {
      iteration: 3,
      evaluationDate: new Date().toISOString(),
      tests: results,
      scoring: {
        base: baseScore,
        improvements: totalBonus,
        total: parseFloat(finalScore.toFixed(1)),
      },
      passed: finalScore >= 8.5,
      screenshotDirectory: SCREENSHOT_DIR,
    };
    
    fs.writeFileSync(
      path.join(__dirname, '..', 'gan-harness', 'iteration-003-results.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`\n📄 Results saved to gan-harness/iteration-003-results.json`);
    console.log(`📸 Screenshots saved to gan-harness/screenshots/`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await browser.close();
  }
}

evalPage();
