---
description: Check the production deployment on the VPS
---

The app runs on the VPS in `/opt/ai-math-tutor` (user `deploy`, SSH host alias `florik-vps`
uses root; use `ssh deploy@185.70.109.57` for app commands).

1. `curl -fsS https://tutor.florik.pp.ua/api/health` — expect `{"status":"ok",...}`.
2. Ask the user to run (you have no SSH access from the sandbox unless they allow it):
   `ssh deploy@185.70.109.57 'cd /opt/ai-math-tutor && docker compose -f docker-compose.prod.yml ps && docker compose -f docker-compose.prod.yml logs --tail=50 api'`
3. Summarise: container health, last errors, and whether the latest GitHub Actions run deployed
   (`gh run list --limit 3` if `gh` is authenticated).
