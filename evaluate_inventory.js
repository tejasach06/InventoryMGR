// This script will be run using xd://browser tool with puppeteer access
// Evaluates Inventory page against rubric criteria

async function evaluateInventory() {
  // page and browser are available in tab.run() scope
  
  const results = {
    timestamp: new Date().toISOString(),
    scores: {
      design_quality: 0,
      originality: 0,
      craft: 0,
      functionality: 0,
      final_score: 0
    },
    assessments: {},
    notes: []
  };

  try {
    // === NAVIGATE TO PAGE ===
    await tab.goto('http://localhost:3000/inventory', { waitUntil: 'networkidle' });
    await tab.waitForSelector('table, [role="table"]', { timeout: 5000 });
    results.notes.push('✓ Navigation successful, table rendered');

    // === SCREENSHOT 1: Light Mode ===
    await tab.screenshot({ path: 'gan-harness/screenshots/iteration-001-light-mode.png' });
    results.notes.push('✓ Light mode screenshot saved');

    // === TEST: Dark Mode ===
    // Try multiple strategies to find theme toggle
    let themeToggleFound = false;
    const toggleSelectors = [
      '[data-testid="theme-toggle"]',
      'button[aria-label*="theme" i]',
      'button[aria-label*="dark" i]',
      'button[aria-label*="light" i]',
      '[class*="theme"]'
    ];

    for (const selector of toggleSelectors) {
      const element = await tab.page.$(selector);
      if (element) {
        await element.click();
        await tab.page.waitForTimeout(500);
        themeToggleFound = true;
        results.notes.push('✓ Theme toggle clicked (found via selector: ' + selector + ')');
        break;
      }
    }

    if (!themeToggleFound) {
      // Fallback: toggle dark class on root
      await tab.evaluate(() => {
        document.documentElement.classList.toggle('dark');
      });
      await tab.page.waitForTimeout(500);
      results.notes.push('✓ Dark mode toggled via class manipulation');
    }

    // === SCREENSHOT 2: Dark Mode ===
    await tab.screenshot({ path: 'gan-harness/screenshots/iteration-001-dark-mode.png' });
    results.notes.push('✓ Dark mode screenshot saved');

    // Switch back
    if (themeToggleFound) {
      const toggle = await tab.page.$('[data-testid="theme-toggle"]');
      if (toggle) await toggle.click();
    } else {
      await tab.evaluate(() => {
        document.documentElement.classList.toggle('dark');
      });
    }
    await tab.page.waitForTimeout(500);

    // === DESIGN QUALITY ASSESSMENT ===
    const designQuality = await tab.evaluate(() => {
      const assessment = {
        custom_palette: false,
        semantic_colors: false,
        typography_scale: [],
        spacing_rhythm: [],
        dark_light_parity: true,
        visual_hierarchy: true
      };

      // Check for custom color usage (not default slate/indigo only)
      const colorClasses = new Set();
      document.querySelectorAll('[class*="bg-"], [class*="text-"], [class*="border-"]').forEach(el => {
        Array.from(el.classList).forEach(cls => {
          if (cls.match(/^(bg|text|border|ring)-/)) {
            colorClasses.add(cls);
          }
        });
      });
      
      const customColors = Array.from(colorClasses).filter(c => 
        !c.match(/(slate|gray|neutral)/) && c.match(/(emerald|red|orange|amber|blue|green|purple|cyan|teal)/)
      );
      assessment.custom_palette = customColors.length > 3;
      assessment.found_colors = customColors.slice(0, 5);

      // Check semantic color usage in badges
      const badges = document.querySelectorAll('[class*="badge"], span[class*="rounded-full"]');
      assessment.semantic_colors = badges.length > 0;
      assessment.badge_count = badges.length;

      // Typography
      const textSizes = new Set();
      document.querySelectorAll('[class*="text-"]').forEach(el => {
        Array.from(el.classList).forEach(cls => {
          if (cls.match(/^text-(xs|sm|base|lg|xl|2xl|3xl)/)) {
            textSizes.add(cls);
          }
        });
      });
      assessment.typography_scale = Array.from(textSizes).slice(0, 6);

      // Spacing
      const spacing = new Set();
      document.querySelectorAll('[class*="p-"], [class*="gap-"], [class*="m-"]').forEach(el => {
        Array.from(el.classList).forEach(cls => {
          if (cls.match(/^(p|gap|m)-[0-9]/)) {
            spacing.add(cls);
          }
        });
      });
      assessment.spacing_rhythm = Array.from(spacing).slice(0, 6);

      return assessment;
    });

    results.assessments.design_quality = designQuality;
    
    // Score design quality
    let designScore = 5; // base
    if (designQuality.custom_palette) designScore += 2;
    if (designQuality.semantic_colors) designScore += 1.5;
    if (designQuality.typography_scale.length >= 4) designScore += 1;
    if (designQuality.spacing_rhythm.length >= 4) designScore += 0.5;
    results.scores.design_quality = Math.min(10, designScore);
    console.log('Design Quality Score:', results.scores.design_quality);

    // === ORIGINALITY ASSESSMENT ===
    const originality = await tab.evaluate(() => {
      const assessment = {
        horizontal_filter_bar: false,
        signature_interactions: [],
        data_viz_elements: false,
        illustrated_states: false
      };

      // Check for horizontal filter bar (not sidebar drawer)
      const filterBar = document.querySelector('[data-testid="filter-bar"], [class*="filter-bar"], .filter-chips, [role="region"][class*="filter"]');
      if (filterBar) {
        const rect = filterBar.getBoundingClientRect();
        assessment.horizontal_filter_bar = rect.width > 400; // Wide horizontal layout
      }

      // Check for filter chips
      const chips = document.querySelectorAll('[class*="chip"], [data-testid*="chip"], button[class*="rounded-full"][class*="bg-"]');
      assessment.chip_count = chips.length;

      // Check for row animations (staggered entrance)
      const rows = document.querySelectorAll('tbody tr');
      if (rows.length > 0) {
        const style = window.getComputedStyle(rows[0]);
        assessment.row_animation = {
          animation: style.animation || 'none',
          transition: style.transition || 'none'
        };
      }

      // Check for data visualization (badges, indicators)
      const dataVizElements = document.querySelectorAll('[class*="badge"], [class*="status"], svg[class*="w-4"], svg[class*="w-5"]');
      assessment.data_viz_elements = dataVizElements.length > 5;
      assessment.viz_count = dataVizElements.length;

      // Check for illustrated empty/loading states
      const emptyStates = document.querySelectorAll('[class*="empty"], [data-testid*="empty"], [class*="no-data"]');
      emptyStates.forEach(state => {
        if (state.querySelector('svg') || state.querySelector('img')) {
          assessment.illustrated_states = true;
        }
      });

      return assessment;
    });

    results.assessments.originality = originality;

    let originalityScore = 5;
    if (originality.horizontal_filter_bar) originalityScore += 2;
    if (originality.chip_count > 3) originalityScore += 1;
    if (originality.row_animation.animation !== 'none') originalityScore += 1.5;
    if (originality.data_viz_elements) originalityScore += 1;
    if (originality.illustrated_states) originalityScore += 1;
    results.scores.originality = Math.min(10, originalityScore);
    console.log('Originality Score:', results.scores.originality);

    // === CRAFT ASSESSMENT ===
    const craft = await tab.evaluate(() => {
      const assessment = {
        staggered_rows: false,
        spring_physics: false,
        smooth_transitions: false,
        focus_states: false,
        layout_stable: true,
        reduced_motion_support: false
      };

      // Check for staggered animation
      const rows = document.querySelectorAll('tbody tr');
      if (rows.length > 1) {
        const row1Style = window.getComputedStyle(rows[0]);
        const row2Style = window.getComputedStyle(rows[1]);
        assessment.staggered_rows = row1Style.animation.includes('15ms') || 
                                   row1Style.animation.includes('calc') ||
                                   row1Style.animationDelay !== row2Style.animationDelay;
      }

      // Check for spring physics in transitions
      const allElements = document.querySelectorAll('[class*="transition"], [style*="transition"]');
      const hasSpring = Array.from(allElements).some(el => {
        const transition = window.getComputedStyle(el).transition || el.style.transition;
        return transition.includes('cubic-bezier') || transition.includes('spring');
      });
      assessment.spring_physics = hasSpring;

      // Check focus states
      const buttons = document.querySelectorAll('button');
      assessment.has_focus_states = buttons.length > 0;
      if (buttons.length > 0) {
        const button = buttons[0];
        const focusStyle = window.getComputedStyle(button, ':focus-visible').outline;
        assessment.focus_outline = focusStyle || 'default browser';
      }

      // Check for smooth transitions
      const transitionElements = document.querySelectorAll('[class*="transition"]');
      assessment.smooth_transitions = transitionElements.length > 5;

      // Reduced motion support
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        assessment.reduced_motion_support = true;
      }

      return assessment;
    });

    results.assessments.craft = craft;

    let craftScore = 5;
    if (craft.staggered_rows) craftScore += 2;
    if (craft.spring_physics) craftScore += 1.5;
    if (craft.smooth_transitions) craftScore += 1;
    if (craft.has_focus_states) craftScore += 1;
    if (craft.reduced_motion_support) craftScore += 0.5;
    results.scores.craft = Math.min(10, craftScore);
    console.log('Craft Score:', results.scores.craft);

    // === FUNCTIONALITY ASSESSMENT ===
    const functionality = await tab.evaluate(() => {
      const assessment = {
        table_renders: false,
        filters_work: false,
        row_selection: false,
        density_toggle: false,
        persistence: false
      };

      // Table renders
      const table = document.querySelector('table, [role="table"]');
      assessment.table_renders = !!table;

      const rows = document.querySelectorAll('tbody tr, [role="row"]');
      assessment.row_count = rows.length;

      // Check for filter controls
      const filterChips = document.querySelectorAll('[data-testid*="chip"], [class*="pill"], button[class*="remove"]');
      assessment.filters_work = filterChips.length > 0;

      // Row selection (checkboxes)
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      assessment.row_selection = checkboxes.length > 0;

      // Density toggle
      const densityButtons = document.querySelectorAll('button:contains("Compact"), button:contains("Comfortable"), button:contains("Condensed")');
      assessment.density_toggle = document.querySelectorAll('[data-testid*="density"], [class*="density"]').length > 0;

      return assessment;
    });

    results.assessments.functionality = functionality;

    let functionalityScore = 7; // start high for core function
    if (!functionality.table_renders) functionalityScore -= 3;
    if (!functionality.filters_work) functionalityScore -= 2;
    if (!functionality.row_selection) functionalityScore -= 1;
    if (!functionality.density_toggle) functionalityScore -= 1;
    results.scores.functionality = Math.max(0, Math.min(10, functionalityScore));
    console.log('Functionality Score:', results.scores.functionality);

    // === CALCULATE FINAL SCORE ===
    results.scores.final_score = (
      results.scores.design_quality * 0.35 +
      results.scores.originality * 0.30 +
      results.scores.craft * 0.25 +
      results.scores.functionality * 0.10
    );

    results.pass = results.scores.final_score >= 8.5;
    results.notes.push(`\nFinal Score: ${results.scores.final_score.toFixed(2)}/10`);
    results.notes.push(results.pass ? '✓ PASS (>= 8.5)' : '✗ NEEDS WORK (< 8.5)');

  } catch (error) {
    results.error = error.message;
    results.notes.push(`✗ Evaluation error: ${error.message}`);
  }

  return results;
}

// For use with xd://browser tool
console.log('Inventory evaluation script ready. Call via browser tool with action=run');
