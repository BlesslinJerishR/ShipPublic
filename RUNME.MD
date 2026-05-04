docker compose up -d
cd backend && cp .env.example .env  # add GITHUB_CLIENT_ID/SECRET
npm install && npx prisma migrate dev --name init && npm run start:dev
cd ../frontend && cp .env.example .env && npm install && npm run dev 
or
yarn && yarn dev
run ./start.sh to start everything:
Use --no-infra if you want to skip Docker (e.g. infra already running)

sudo systemctl restart ollama