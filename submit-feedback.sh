#!/bin/bash

# Script to submit mock feedback to the Feedback Pulse API
BASE_URL="${1:-http://localhost:8787}"

echo "🚀 Submitting mock feedback to $BASE_URL"
echo "=========================================="
echo ""

# Check if server is running
if ! curl -s "$BASE_URL/" > /dev/null 2>&1; then
  echo "❌ Error: Server is not running at $BASE_URL"
  echo ""
  echo "Please start the dev server first:"
  echo "  npm run dev"
  echo ""
  exit 1
fi

echo "✅ Server is running!"
echo ""

# Array of feedback items
feedback_items=(
  '{"feedback": "Multiple enterprise customers cannot access their accounts due to authentication failures. Revenue is at risk and they are threatening to cancel."}'
  '{"feedback": "Critical security vulnerability detected - user data is being exposed in API responses without proper authentication checks."}'
  '{"feedback": "Payment processing is completely down for the past 2 hours. No transactions are going through and customers are unable to complete purchases."}'
  '{"feedback": "The search functionality is really slow and sometimes returns no results even when I know the data exists. Makes it frustrating to find what I need."}'
  '{"feedback": "The dashboard is confusing - I cannot figure out how to export my reports. Spent 30 minutes trying to find the export button."}'
  '{"feedback": "Mobile app crashes whenever I try to upload files larger than 10MB. Need to use desktop version every time which is inconvenient."}'
  '{"feedback": "Feature request: Would be great to have bulk edit capabilities for managing multiple items at once. Currently have to edit them one by one."}'
  '{"feedback": "Love the new dark mode feature! It is exactly what we needed and makes working late nights much easier on the eyes."}'
  '{"feedback": "The onboarding tutorial was really helpful and well-designed. Made it super easy to get started with the platform."}'
  '{"feedback": "Minor suggestion: Could we add more color themes for the dashboard? The current blue is nice but would love more customization options."}'
)

# Submit each feedback item
for i in "${!feedback_items[@]}"; do
  feedback="${feedback_items[$i]}"
  item_num=$((i + 1))
  
  echo "[$item_num/10] Submitting feedback..."
  response=$(curl -s -X POST "$BASE_URL/api/feedback" \
    -H "Content-Type: application/json" \
    -d "$feedback")
  
  if [ -z "$response" ]; then
    echo "  ⚠️  Empty response (may be processing...)"

 elif echo "$response" | grep -q '"success":true'; then
    escalation=$(echo "$response" | grep -o '"escalation_level":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "unknown")
    easy_win=$(echo "$response" | grep -o '"easy_win":[^,}]*' | cut -d':' -f2 2>/dev/null || echo "unknown")
    echo "  ✅ Success! Classified as: $escalation (Easy Win: $easy_win)"
  else
    echo "  ❌ Error: ${response:0:100}"
  fi
  
  # Small delay between requests
  sleep 1
done

echo ""
echo "✅ All feedback submitted!"
echo ""
echo "📊 View the dashboard at: $BASE_URL/"
echo ""
