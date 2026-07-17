import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const screenshotDir = './gan-harness/screenshots';
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

async function evaluateInventory() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.createContext();
  const page = await context.newPage();
  
  const results = {
    timestamp: new Date().toISOString(),
    scores: {
      design_quality: 0,
      originality: 0,
      craft: 0,
      functionality: 0,
      final_score: 0
    },
    breakdown: {},
    notes: []
  };

  try {
    // Set viewport for consistency
    await page.setViewportSize({ width: 1440, height: 900 });
    
    // Navigate
    console.log('Navigating to http://localhost:3000/inventory...');
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    
    // Wait for table or key elements
    const tableSelector = 'table, [role="table"], tbody';
    try {
      await page.waitForSelector(tableSelector, { timeout: 5000 });
      results.notes.push('✓ Table loaded');
    } catch {
      results.notes.push('⚠ Table not found, continuing evaluation');
    }

    // === SCREENSHOT 1: Light Mode ===
    console.log('Capturing light mode screenshot...');
    await page.screenshot({ path: path.join(screenshotDir, 'iteration-001-light-mode.png') });
    results.notes.push('✓ Light mode screenshot saved');

    // === DARK MODE TEST ===
    console.log('Testing dark mode...');
    
    // Try to find and click theme toggle
    let darkModeToggled = false;
    const themeToggleSelectors = [
      '[data-testid="theme-toggle"]',
      'button[aria-label*="theme" i]',
      'button[aria-label*="dark" i]',
      '[class*="ThemeToggle"]'
    ];

    for (const selector of themeToggleSelectors) {
      try {
        const toggle = page.locator(selector).first();
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click();
          await page.waitForTimeout(500);
          darkModeToggled = true;
          results.notes.push(`✓ Theme toggle clicked (${selector})`);
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (!darkModeToggled) {
      // Fallback: manipulate DOM directly
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.add('dark');
      });
      await page.waitForTimeout(500);
      results.notes.push('✓ Dark mode activated via DOM');
      darkModeToggled = true;
    }

    // === SCREENSHOT 2: Dark Mode ===
    console.log('Capturing dark mode screenshot...');
    await page.screenshot({ path: path.join(screenshotDir, 'iteration-001-dark-mode.png') });
    results.notes.push('✓ Dark mode screenshot saved');

    // Switch back
    if (darkModeToggled) {
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
      });
      await page.waitForTimeout(500);
    }

    // === DESIGN QUALITY ===
    console.log('\nEvaluating Design Quality...');
    const designQualityData = await page.evaluate(() => {
      const data = {
        has_custom_colors: false,
        custom_color_list: [],
        badge_count: 0,
        has_semantic_colors: false,
        typography_sizes: [],
        spacing_values: [],
        has_animations: false
      };

      // Scan for custom color usage
      const allClasses = new Set();
      document.querySelectorAll('[class]').forEach(el => {
        el.className.split(/\s+/).forEach(cls => {
          if (cls.match(/(bg|text|border|ring)-(emerald|red|orange|amber|blue|green|purple|cyan|teal|indigo|pink)/)) {
            allClasses.add(cls);
          }
        });
      });

      data.custom_color_list = Array.from(allClasses).slice(0, 15);
      data.has_custom_colors = data.custom_color_list.length > 3;

      // Check for badges
      const badges = document.querySelectorAll('[class*="badge"], span[class*="rounded-full"][class*="bg-"], [class*="pill"]');
      data.badge_count = badges.length;
      data.has_semantic_colors = badges.length > 0;

      // Typography
      const textSizes = new Set();
      document.querySelectorAll('[class*="text-"]').forEach(el => {
        Array.from(el.classList)
          .filter(c => c.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)/))
          .forEach(c => textSizes.add(c));
      });
      data.typography_sizes = Array.from(textSizes).slice(0, 8);

      // Spacing
      const spacing = new Set();
      document.querySelectorAll('[class*="p-"], [class*="gap-"], [class*="m-"], [class*="space-"]').forEach(el => {
        Array.from(el.classList)
          .filter(c => c.match(/^(p|gap|m|space)-(0\.5|1|1\.5|2|2\.5|3|4|6|8|12)/))
          .forEach(c => spacing.add(c));
      });
      data.spacing_values = Array.from(spacing).slice(0, 8);

      // Check for animations
      const animated = document.querySelectorAll('[class*="animate"], [style*="animation"]');
      data.has_animations = animated.length > 0;

      return data;
    });

    results.breakdown.design_quality_raw = designQualityData;
    
    // Score: 0-10
    let designScore = 5;
    if (designQualityData.has_custom_colors) designScore += 2;
    if (designQualityData.has_semantic_colors) designScore += 1.5;
    if (designQualityData.typography_sizes.length >= 6) designScore += 1;
    if (designQualityData.spacing_values.length >= 6) designScore += 0.5;
    designScore = Math.min(10, designScore);
    results.scores.design_quality = designScore;
    
    console.log(`  Custom palette: ${designQualityData.has_custom_colors ? '✓' : '✗'}`);
    console.log(`  Semantic colors: ${designQualityData.has_semantic_colors ? '✓' : '✗'} (${designQualityData.badge_count} badges)`);
    console.log(`  Typography scale: ${designQualityData.typography_sizes.slice(0, 4).join(', ')}`);
    console.log(`  Spacing rhythm: ${designQualityData.spacing_values.slice(0, 4).join(', ')}`);
    console.log(`  Design Score: ${designScore.toFixed(1)}/10`);

    // === ORIGINALITY ===
    console.log('\nEvaluating Originality...');
    const originalityData = await page.evaluate(() => {
      const data = {
        filter_bar_present: false,
        filter_bar_horizontal: false,
        filter_chips_count: 0,
        has_row_animations: false,
        row_animation_detail: '',
        data_viz_elements: 0,
        has_illustrated_empty_state: false
      };

      // Check for filter bar
      const filterBar = document.querySelector('[data-testid="filter-bar"], [class*="filter-bar"], [class*="FilterBar"]');
      data.filter_bar_present = !!filterBar;
      
      if (filterBar) {
        const rect = filterBar.getBoundingClientRect();
        data.filter_bar_horizontal = rect.width > 300;
      }

      // Check for filter chips
      const chips = document.querySelectorAll(
        '[class*="chip"], [data-testid*="chip"], ' +
        'button[class*="rounded-full"][class*="bg-"], ' +
        '[class*="pill"]'
      );
      data.filter_chips_count = chips.length;

      // Row animations
      const rows = document.querySelectorAll('tbody tr, [role="row"]');
      if (rows.length > 0) {
        const firstRow = rows[0];
        const style = window.getComputedStyle(firstRow);
        data.has_row_animations = !!style.animation && style.animation !== 'none';
        data.row_animation_detail = style.animation;
      }

      // Data visualization (badges, icons)
      const dataViz = document.querySelectorAll('svg, [class*="badge"], [class*="icon"], [class*="indicator"]');
      data.data_viz_elements = dataViz.length;

      // Illustrated empty state
      const emptyStates = document.querySelectorAll(
        '[class*="empty"], [data-testid*="empty"], ' +
        '[class*="no-data"], [class*="NoData"]'
      );
      emptyStates.forEach(state => {
        if (state.querySelector('svg') || state.querySelector('img')) {
          data.has_illustrated_empty_state = true;
        }
      });

      return data;
    });

    results.breakdown.originality_raw = originalityData;

    let originalityScore = 5;
    if (originalityData.filter_bar_present) originalityScore += 1.5;
    if (originalityData.filter_bar_horizontal) originalityScore += 1;
    if (originalityData.filter_chips_count > 0) originalityScore += 1;
    if (originalityData.has_row_animations) originalityScore += 1.5;
    if (originalityData.data_viz_elements > 10) originalityScore += 1;
    if (originalityData.has_illustrated_empty_state) originalityScore += 1;
    originalityScore = Math.min(10, originalityScore);
    results.scores.originality = originalityScore;

    console.log(`  Filter bar present: ${originalityData.filter_bar_present ? '✓' : '✗'}`);
    console.log(`  Filter bar horizontal: ${originalityData.filter_bar_horizontal ? '✓' : '✗'}`);
    console.log(`  Filter chips: ${originalityData.filter_chips_count}`);
    console.log(`  Row animations: ${originalityData.has_row_animations ? '✓' : '✗'}`);
    console.log(`  Data viz elements: ${originalityData.data_viz_elements}`);
    console.log(`  Illustrated empty state: ${originalityData.has_illustrated_empty_state ? '✓' : '✗'}`);
    console.log(`  Originality Score: ${originalityScore.toFixed(1)}/10`);

    // === CRAFT ===
    console.log('\nEvaluating Craft...');
    const craftData = await page.evaluate(() => {
      const data = {
        has_transitions: false,
        transition_count: 0,
        has_smooth_timing: false,
        focus_states_visible: false,
        reduced_motion_honored: false,
        layout_shift_free: true
      };

      // Count transition elements
      const transitioned = document.querySelectorAll('[class*="transition"]');
      data.transition_count = transitioned.length;
      data.has_transitions = transitioned.length > 5;

      // Check for spring/ease timing
      let smoothTiming = false;
      transitioned.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.transitionTimingFunction && 
            (style.transitionTimingFunction.includes('ease') || 
             style.transitionTimingFunction.includes('cubic'))) {
          smoothTiming = true;
        }
      });
      data.has_smooth_timing = smoothTiming;

      // Check focus states (via CSS)
      const stylesheet = Array.from(document.styleSheets).find(sheet => {
        try {
          return sheet.cssRules && Array.from(sheet.cssRules).some(rule => 
            rule.selectorText && rule.selectorText.includes(':focus')
          );
        } catch {
          return false;
        }
      });
      data.focus_states_visible = !!stylesheet;

      // Check prefers-reduced-motion
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // If matches, the system respects it (can't fully verify without toggling OS setting)
      data.reduced_motion_honored = !prefersReduced; // Assume honored if current setting is default

      return data;
    });

    results.breakdown.craft_raw = craftData;

    let craftScore = 5;
    if (craftData.has_transitions) craftScore += 2;
    if (craftData.has_smooth_timing) craftScore += 1.5;
    if (craftData.transition_count > 20) craftScore += 1;
    if (craftData.focus_states_visible) craftScore += 1;
    craftScore = Math.min(10, craftScore);
    results.scores.craft = craftScore;

    console.log(`  Transition elements: ${craftData.transition_count}`);
    console.log(`  Smooth timing functions: ${craftData.has_smooth_timing ? '✓' : '✗'}`);
    console.log(`  Focus states: ${craftData.focus_states_visible ? '✓' : '✗'}`);
    console.log(`  Craft Score: ${craftScore.toFixed(1)}/10`);

    // === FUNCTIONALITY ===
    console.log('\nEvaluating Functionality...');
    const functionalityData = await page.evaluate(() => {
      const data = {
        table_renders: false,
        row_count: 0,
        has_filters: false,
        filter_pills_count: 0,
        has_selection: false,
        has_density_toggle: false,
        has_column_controls: false
      };

      // Table check
      const table = document.querySelector('table, [role="table"]');
      data.table_renders = !!table;

      const rows = document.querySelectorAll('tbody tr, [role="row"]');
      data.row_count = rows.length;

      // Filters
      const filterArea = document.querySelector('[data-testid="filter-bar"], [class*="filter"]');
      data.has_filters = !!filterArea;

      const pills = document.querySelectorAll('[class*="pill"], [data-testid*="filter-chip"], button[class*="rounded-full"][class*="remove"]');
      data.filter_pills_count = pills.length;

      // Selection
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      data.has_selection = checkboxes.length > 0;

      // Density
      const densityControls = document.querySelectorAll('[data-testid*="density"], [class*="Density"], button:contains("Compact")');
      data.has_density_toggle = document.querySelectorAll('[class*="density"], [data-testid*="density"]').length > 0;

      // Column controls
      const columnControls = document.querySelectorAll('[data-testid*="column"], [class*="ColumnEditor"], [aria-label*="column" i]');
      data.has_column_controls = columnControls.length > 0;

      return data;
    });

    results.breakdown.functionality_raw = functionalityData;

    let functionalityScore = 6;
    if (functionalityData.table_renders) functionalityScore += 1;
    if (functionalityData.row_count > 0) functionalityScore += 1;
    if (functionalityData.has_filters) functionalityScore += 1;
    if (functionalityData.has_selection) functionalityScore += 0.5;
    if (functionalityData.has_density_toggle) functionalityScore += 0.5;
    functionalityScore = Math.min(10, functionalityScore);
    results.scores.functionality = functionalityScore;

    console.log(`  Table renders: ${functionalityData.table_renders ? '✓' : '✗'}`);
    console.log(`  Rows: ${functionalityData.row_count}`);
    console.log(`  Filters: ${functionalityData.has_filters ? '✓' : '✗'} (${functionalityData.filter_pills_count} pills)`);
    console.log(`  Selection: ${functionalityData.has_selection ? '✓' : '✗'}`);
    console.log(`  Density toggle: ${functionalityData.has_density_toggle ? '✓' : '✗'}`);
    console.log(`  Column controls: ${functionalityData.has_column_controls ? '✓' : '✗'}`);
    console.log(`  Functionality Score: ${functionalityScore.toFixed(1)}/10`);

    // === FINAL SCORE ===
    results.scores.final_score = (
      results.scores.design_quality * 0.35 +
      results.scores.originality * 0.30 +
      results.scores.craft * 0.25 +
      results.scores.functionality * 0.10
    );

    results.pass = results.scores.final_score >= 8.5;

    console.log('\n' + '='.repeat(50));
    console.log('FINAL SCORES');
    console.log('='.repeat(50));
    console.log(`Design Quality (35%):  ${results.scores.design_quality.toFixed(2)}/10`);
    console.log(`Originality (30%):     ${results.scores.originality.toFixed(2)}/10`);
    console.log(`Craft (25%):           ${results.scores.craft.toFixed(2)}/10`);
    console.log(`Functionality (10%):   ${results.scores.functionality.toFixed(2)}/10`);
    console.log('-'.repeat(50));
    console.log(`FINAL SCORE:           ${results.scores.final_score.toFixed(2)}/10`);
    console.log('='.repeat(50));
    console.log(`PASS THRESHOLD (8.5):  ${results.pass ? '✓ PASS' : '✗ NEEDS WORK'}`);

  } catch (error) {
    console.error('Evaluation error:', error);
    results.error = error.message;
    results.notes.push(`✗ Error: ${error.message}`);
  } finally {
    await browser.close();
  }

  return results;
}

// Run evaluation
const results = await evaluateInventory();

// Save results
fs.writeFileSync('./evaluation_results.json', JSON.stringify(results, null, 2));
console.log('\nResults saved to evaluation_results.json');

process.exit(results.pass ? 0 : 1);
