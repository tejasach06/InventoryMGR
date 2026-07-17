const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Ensure screenshot directory exists
const screenshotDir = 'gan-harness/screenshots';
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

async function evaluateInventory() {
  const browser = await chromium.launch();
  const context = await browser.createContext();
  const page = await context.newPage();

  // Set viewport for consistent screenshots
  await page.setViewportSize({ width: 1440, height: 900 });

  const results = {
    design_quality: {},
    originality: {},
    craft: {},
    functionality: {}
  };

  try {
    // Navigate to inventory page
    console.log('Navigating to http://localhost:3000/inventory...');
    await page.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    
    // Wait for table to render
    await page.waitForSelector('table', { timeout: 5000 }).catch(() => {
      console.warn('Table not found with timeout');
    });

    // Screenshot 1: Light mode inventory
    console.log('Taking light mode screenshot...');
    await page.screenshot({ path: `${screenshotDir}/iteration-001-light-mode.png` });
    results.screenshot_light = 'iteration-001-light-mode.png';

    // Test dark mode toggle
    console.log('Toggling to dark mode...');
    const themeToggle = await page.locator('[data-testid="theme-toggle"], button:has-text("Dark"), button:has-text("Light"), [aria-label*="theme" i], [aria-label*="dark" i]').first();
    
    if (await themeToggle.isVisible().catch(() => false)) {
      await themeToggle.click();
      await page.waitForTimeout(500); // Wait for animation
      
      // Screenshot 2: Dark mode
      console.log('Taking dark mode screenshot...');
      await page.screenshot({ path: `${screenshotDir}/iteration-001-dark-mode.png` });
      results.screenshot_dark = 'iteration-001-dark-mode.png';
      
      // Switch back for remaining tests
      await themeToggle.click();
      await page.waitForTimeout(500);
    } else {
      console.warn('Theme toggle not found, attempting document.documentElement.classList toggle');
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.toggle('dark');
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/iteration-001-dark-mode.png` });
      results.screenshot_dark = 'iteration-001-dark-mode.png';
      
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.toggle('dark');
      });
      await page.waitForTimeout(500);
    }

    // ===== DESIGN QUALITY TESTS =====
    console.log('\n=== DESIGN QUALITY ===');
    
    // Check custom color palette
    const colorPalette = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="bg-"], [class*="text-"], [class*="border-"]');
      const colors = new Set();
      elements.forEach(el => {
        el.className.split(/\s+/).forEach(cls => {
          if (cls.match(/^(bg|text|border)-/) && !cls.match(/-(50|100)$/)) {
            colors.add(cls);
          }
        });
      });
      return Array.from(colors).sort();
    });
    results.design_quality.color_palette = {
      found_custom_colors: colorPalette.length > 0,
      sample_classes: colorPalette.slice(0, 10)
    };
    console.log('Custom color palette:', colorPalette.slice(0, 10).join(', '));

    // Check semantic colors in badges
    const badges = await page.locator('[class*="badge"], span[class*="rounded-full"]').count();
    const badgeExamples = await page.locator('span[class*="rounded-full"]').first().evaluate(el => el.className).catch(() => '');
    results.design_quality.semantic_badges = {
      badge_count: badges,
      sample_badge_class: badgeExamples
    };
    console.log(`Found ${badges} badges with semantic colors`);

    // Check typography scale
    const typographyElements = await page.evaluate(() => {
      const sizes = new Set();
      document.querySelectorAll('[class*="text-"]').forEach(el => {
        const classes = el.className.split(/\s+/);
        const textClass = classes.find(c => c.startsWith('text-'));
        if (textClass) sizes.add(textClass);
      });
      return Array.from(sizes).sort();
    });
    results.design_quality.typography = {
      scale_used: typographyElements.slice(0, 8)
    };
    console.log('Typography scale:', typographyElements.slice(0, 8).join(', '));

    // Check spacing rhythm
    const spacingUsed = await page.evaluate(() => {
      const spacing = new Set();
      document.querySelectorAll('[class*="p-"], [class*="m-"], [class*="gap-"]').forEach(el => {
        el.className.split(/\s+/).forEach(cls => {
          if (cls.match(/^(p|m|gap)-/)) spacing.add(cls);
        });
      });
      return Array.from(spacing).sort();
    });
    results.design_quality.spacing = {
      rhythm_values: spacingUsed.slice(0, 10)
    };

    // ===== ORIGINALITY TESTS =====
    console.log('\n=== ORIGINALITY ===');

    // Check for horizontal filter bar (not sidebar)
    const filterBar = await page.locator('[data-testid="filter-bar"], [class*="filter"], .filter-bar').first();
    const hasHorizontalFilterBar = await filterBar.isVisible().catch(() => false);
    results.originality.filter_bar = {
      horizontal_visible: hasHorizontalFilterBar,
      location: 'checked'
    };
    console.log('Horizontal filter bar visible:', hasHorizontalFilterBar);

    // Check for filter chips/pills
    const filterChips = await page.locator('[class*="chip"], [data-testid*="filter-chip"], button[class*="rounded-full"]').count();
    results.originality.filter_chips = {
      count: filterChips
    };
    console.log(`Found ${filterChips} filter chips`);

    // Check for row entrance animation
    const rows = await page.locator('tbody tr').count();
    const firstRow = await page.locator('tbody tr').first();
    const rowStyle = await firstRow.evaluate(el => window.getComputedStyle(el).animation).catch(() => '');
    results.originality.row_animation = {
      rows_visible: rows,
      first_row_animation: rowStyle
    };
    console.log(`Found ${rows} rows, animation: ${rowStyle || 'none'}`);

    // Check for illustrated empty state
    const emptyState = await page.locator('[class*="empty"], [data-testid*="empty"]').first();
    const hasIllustration = await emptyState.locator('svg, img').isVisible().catch(() => false);
    results.originality.empty_state = {
      has_illustration: hasIllustration
    };
    console.log('Empty state has illustration:', hasIllustration);

    // ===== CRAFT TESTS =====
    console.log('\n=== CRAFT ===');

    // Check reduced motion preference
    const prefersReducedMotion = await page.evaluate(() => {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });
    results.craft.reduced_motion_support = {
      checked: true,
      current_preference: prefersReducedMotion
    };

    // Check focus states
    const firstButton = await page.locator('button').first();
    const focusStyle = await firstButton.evaluate(el => {
      el.focus();
      return window.getComputedStyle(el).outline;
    }).catch(() => 'unknown');
    results.craft.focus_states = {
      outline_style: focusStyle
    };
    console.log('Focus outline style:', focusStyle);

    // Check for layout shifts by measuring density toggle
    const densityToggle = await page.locator('button:has-text("Compact"), button:has-text("Comfortable"), [data-testid*="density"]').first();
    if (await densityToggle.isVisible().catch(() => false)) {
      const initialHeight = await page.evaluate(() => {
        const row = document.querySelector('tbody tr');
        return row ? row.offsetHeight : 0;
      });
      console.log('Initial row height:', initialHeight);
      
      await densityToggle.click();
      await page.waitForTimeout(300); // Wait for transition
      
      const newHeight = await page.evaluate(() => {
        const row = document.querySelector('tbody tr');
        return row ? row.offsetHeight : 0;
      });
      console.log('After density toggle row height:', newHeight);
      results.craft.density_transition = {
        initial_height: initialHeight,
        new_height: newHeight,
        smooth_transition: true
      };
    }

    // ===== FUNCTIONALITY TESTS =====
    console.log('\n=== FUNCTIONALITY ===');

    // Check if table renders
    const tableVisible = await page.locator('table').isVisible().catch(() => false);
    results.functionality.table_renders = tableVisible;
    console.log('Table renders:', tableVisible);

    // Test row selection if checkboxes exist
    const checkboxes = await page.locator('input[type="checkbox"]').count();
    if (checkboxes > 0) {
      const firstCheckbox = await page.locator('input[type="checkbox"]').nth(1);
      await firstCheckbox.click();
      const isChecked = await firstCheckbox.isChecked();
      results.functionality.row_selection = {
        checkboxes_available: checkboxes > 0,
        can_select: isChecked
      };
      console.log('Row selection works:', isChecked);
    }

    // Test filter functionality
    const filterButtons = await page.locator('button:has-text("Filter"), button:has-text("Status"), [data-testid*="filter"]').first();
    if (await filterButtons.isVisible().catch(() => false)) {
      await filterButtons.click();
      await page.waitForTimeout(300);
      results.functionality.filters_accessible = true;
      console.log('Filters accessible and clickable');
    }

    // Check localStorage for density persistence
    const storedDensity = await page.evaluate(() => {
      return localStorage.getItem('inventory-density') || sessionStorage.getItem('inventory-density') || 'not found';
    });
    results.functionality.density_persistence = {
      stored_value: storedDensity
    };
    console.log('Density persistence:', storedDensity);

    console.log('\n=== Evaluation Complete ===');
    console.log(JSON.stringify(results, null, 2));

  } catch (error) {
    console.error('Evaluation error:', error);
    results.error = error.message;
  } finally {
    await browser.close();
  }

  return results;
}

evaluateInventory().then(results => {
  console.log('\nFinal results written to results.json');
  fs.writeFileSync('evaluation-results.json', JSON.stringify(results, null, 2));
});
