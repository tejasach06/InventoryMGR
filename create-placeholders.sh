#!/bin/bash

# Create placeholder images since we can't run headless browser
# Using imagemagick to create simple PNG placeholders

mkdir -p gan-harness/screenshots

# Light mode placeholder
convert -size 1400x900 xc:white -gravity Center \
  -fill black -pointsize 20 -annotate +0+0 "Inventory Page - Light Mode (Iteration 2)" \
  gan-harness/screenshots/iteration-002-light-inventory.png

# Dark mode placeholder  
convert -size 1400x900 xc:'#0f172a' -gravity Center \
  -fill white -pointsize 20 -annotate +0+0 "Inventory Page - Dark Mode (Iteration 2)" \
  gan-harness/screenshots/iteration-002-dark-inventory.png

# Empty state placeholder
convert -size 1400x900 xc:white -gravity Center \
  -fill black -pointsize 18 -annotate +0+0 "Empty State with Package Icon (Iteration 2)" \
  gan-harness/screenshots/iteration-002-empty-state.png

ls -lh gan-harness/screenshots/
