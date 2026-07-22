#!/bin/bash
set -e

DEPLOY_DIR="/opt/breadtrans"
COMPOSE_FILE="docker-compose.production.yml"

echo "═══════════════════════════════════════"
echo "  BreadTrans — Deploy Script"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════"

cd "$DEPLOY_DIR"

echo "▶ Pulling latest code..."
git pull origin main

echo "▶ Building & restarting services..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo "▶ Removing dangling images..."
docker image prune -f

echo "▶ Checking service health..."
sleep 5
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "✅ Deploy completed successfully!"
