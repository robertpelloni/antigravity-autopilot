#!/bin/bash

# Test the Claude Autopilot API via ngrok tunnel

echo "🧪 Testing Claude Autopilot API..."
echo "🌐 URL: https://060bfd674c99.ngrok-free.app"
echo ""

echo "1️⃣ Testing health endpoint..."
curl -s "https://060bfd674c99.ngrok-free.app/health" | jq .
echo ""

echo "2️⃣ Testing models endpoint..."
curl -s -H "Authorization: Bearer test-key" "https://060bfd674c99.ngrok-free.app/v1/models" | jq .
echo ""

echo "3️⃣ Testing chat completion..."
curl -s -X POST "https://060bfd674c99.ngrok-free.app/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you help me write a simple Python function?"
      }
    ],
    "max_tokens": 150
  }' | jq .

echo ""
echo "✅ API tests complete!"