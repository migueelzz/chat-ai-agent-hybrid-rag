# sap-ai-agent-hybrid-rag

### Backend

```bash
# setup database
docker compose up -d

# install dependencies
pdm install

# reset database
pdm run python scripts/reset_db.py

# server start port 8000 -> http://localhost:8000
pdm run dev
```

### Frontend

```bash 
cd web

pnpm install

# server start port 5173 -> http://localhost:5173
pnpm dev
```
