#!/bin/bash
# Deploy Fund for Indonesia: build, database, migrations, app.
#
# Usage:
#   ./deploy.sh           Normal deploy. Never seeds; safe to run again and again.
#   SEED=1 ./deploy.sh    First deploy onto a FRESH, EMPTY database only: also
#                         loads the demo seed (prisma/seed.ts) after migrations.
#
# The seed is opt-in because it is demo data, not bootstrap data: it creates a
# demo account with a known password holding both the ADMIN and VERIFIER
# assignments. It also refuses outright to run on a database that already has
# Campaigns or Donations, so under `set -e` an unconditional seed step would
# stop every deploy after the first before the app started.
set -e

echo "🚀 Deploying Fund for Indonesia..."

# 1. Build app image
echo "📦 Building Docker images..."
docker compose build app

# 2. Start database
echo "🗄️ Starting database..."
docker compose up -d db
echo "⏳ Waiting for database to be healthy..."
sleep 8

# 3. Run migrations
echo "🔄 Running migrations..."
docker compose run --rm migrate

# 4. Seed, only when explicitly asked for
if [ "${SEED:-}" = "1" ]; then
  echo "🌱 SEED=1: seeding the database with demo data (fresh database only)..."
  docker compose run --rm seed
else
  echo "⏭️  Skipping seed. To seed a fresh, empty database, run: SEED=1 ./deploy.sh"
fi

# 5. Start the app
echo "🌐 Starting application..."
docker compose up -d app

echo ""
echo "✅ Deployment complete!"
echo "   App: http://localhost:3000"
echo "   DB:  postgresql://localhost:5432/fund_indonesia"
echo ""
echo "📋 Useful commands:"
echo "   docker compose logs -f app    # View app logs"
echo "   docker compose down           # Stop all services"
echo "   docker compose up -d          # Start all services"
