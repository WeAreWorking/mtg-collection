# Install - TrueNAS SCALE with Dockge (image pull)

This is the easiest TrueNAS method. No SSH, no git clone, no manual file copying. You paste the compose into Dockge and set two variables in the UI. Dockge pulls the pre-built image from GitHub (GHCR) and you just click **Redeploy** to update.

## What you need

* TrueNAS SCALE with the Dockge app installed (`Apps -> Dockge`)
* A dataset for app data (one time)
* The image: `ghcr.io/weareworking/mtg-collection:latest` (built by GitHub Actions on every push to `main`)

## 1. Create a dataset for `collection.db`

1. In TrueNAS: **Storage -> Datasets -> Add Dataset**
   e.g. `SSDs -> Databases -> MTG-collection` (reuse an existing pool if you prefer)
2. Note the full path - e.g. `/mnt/SSDs/Databases/MTG-collection`

The container will create `collection.db` inside it on first start. This dataset is **never** overwritten by an update - it is a separate volume from the code.

## 2. Create the Dockge stack

1. Open **Apps -> Dockge**
2. **Stacks -> Add Stack** (or **Create Stack**), name it `mtg-collection`
3. Paste this compose (same as `docker-compose.yml` in the repo):

```yaml
services:
  mtg-collection:
    image: ghcr.io/weareworking/mtg-collection:latest
    pull_policy: always
    container_name: mtg-collection
    ports:
      - "7432:7432"
    volumes:
      - ${MTG_DATA_PATH:-./data}:/app/data
    restart: unless-stopped
    environment:
      - SECRET_KEY=${SECRET_KEY:-change-me-to-something-random}
```

## 3. Set variables in the Dockge UI - no `.env` file needed

Dockge will automatically show a **Variables / Environment** section when you create the stack (on older versions: **... -> Edit Stack**, top of the page). Add these two:

| Variable | Value | Description |
| --- | --- | --- |
| `MTG_DATA_PATH` | `/mnt/SSDs/Databases/MTG-collection` (your path from step 1) | Host dataset mounted to `/app/data` inside the container |
| `SECRET_KEY` | a long random string (e.g. 32+ chars from your password manager) | Flask session signing secret. Do not reuse the placeholder. Do not change it after first start or sessions invalidate. |

> Previously this required hand-editing a `.env` file in the stack folder (`databases > Dockge > mtg-collection/.env`) via SMB. Prefer the UI above - Dockge writes the `.env` for you. The `.env.example` in the repo is just a template that gets gitignored so you never commit a real secret.

## 4. Deploy

Click **Deploy / Start**.

* Docker will pull `ghcr.io/weareworking/mtg-collection:latest` (requires internet first time)
* Set `pull_policy: always` means every **Redeploy** pulls the latest image
* Verify logs show the app listening on `0.0.0.0:7432`, then open `http://<TrueNAS-IP>:7432/`

## 5. Updates

Push to `main` in GitHub -> Actions builds a new image (check the **Actions** tab) -> in Dockge click **Redeploy**.

That's it. No SSH, no `docker compose up --build`, no re-uploading code. Your `MTG_DATA_PATH` dataset is untouched across updates.

## Troubleshooting

* **Port in use:** change `"7432:7432"` to e.g. `"7433:7432"` in the compose before Deploy.
* **Old code showing:** If you just hit *Start* / *Restart* it reuses the old image. You must click **Redeploy** so Dockge does `docker compose pull`.
* **Stack folder confusion:** On TrueNAS, Dockge stacks live at `databases > Dockge > <stack-name>` (e.g. `databases/Dockge/mtg-collection`). That's different from your data dataset `databases > MTG-collection`. Don't put code in the data dataset.
* **Browser cache:** After an update do a hard-refresh (`Ctrl+F5`) for `app.js` / `sorting.js`.

## CLI fallback

If you prefer SSH (optional, not required):

```bash
cd /mnt/SSDs/Databases/Dockge/mtg-collection
# no git clone needed - just keep .env here and the compose
docker compose pull
docker compose up -d
docker compose logs -f
```
