#!/bin/bash
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

# 4. Run seed
echo "🌱 Seeding database..."
docker compose run --rm seed

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
