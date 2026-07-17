#!/bin/bash

# Test if server is running
echo "Testing if http://localhost:3000 is accessible..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3000/inventory

# Check port
netstat -tlnp 2>/dev/null | grep 3000 || ss -tlnp 2>/dev/null | grep 3000 || echo "Port 3000 not found in listening ports"

# Try curl with verbose
echo ""
echo "Attempting to fetch page..."
curl -v http://localhost:3000/inventory 2>&1 | head -30
