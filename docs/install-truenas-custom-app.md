# Install - TrueNAS SCALE Custom App (native, no Dockge)

TrueNAS SCALE has a built-in **Custom App** (Docker Compose) that does the same job as Dockge - it pull the GHCR image and lets you set variables in the TrueNAS UI instead of editing a `.env` file. This is the cleanest long-term option and the path to a future catalog entry.

You still don't need SSH or a git clone.

## What you need

* TrueNAS SCALE **24.10 or newer** (has Custom Apps)
* A dataset for app data (one time)
* The image: `ghcr.io/weareworking/mtg-collection:latest`

## 1. Create a dataset for `collection.db`

1. **Storage -> Datasets -> Add Dataset**, e.g. `SSDs -> Databases -> MTG-collection`
2. Note the full path, e.g. `/mnt/SSDs/Databases/MTG-collection`

The container will create `collection.db` inside it. Updates never touch this dataset.

## 2. Create the Custom App

1. **Apps -> Custom App -> Create**
2. Name: `mtg-collection`
3. Paste the compose (same as repo `docker-compose.yml`):

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

## 3. Configure variables in the TrueNAS UI

This is the big advantage over `.env` files - everything is in the form, with host paths and secrets handled by TrueNAS.

| Variable | TrueNAS type | Value / How it works |
| --- | --- | --- |
| `MTG_DATA_PATH` | **Host Path** (or **Dataset**) | In the form, pick your dataset from step 1 from a dropdown. TrueNAS mounts it to `/app/data` automatically. You don't type a raw path. Replaces hand-editing `.env`. |
| `SECRET_KEY` | **Environment Variable (Secret)** | Paste a long random string (32+ chars). With `Secret` type it's stored encrypted and masked as `••••` in the UI, never in plain text YAML. Do not reuse the placeholder. Do not change it after first start. |
| Port | **Ports** | Host port `7432` -> container `7432`. Change host side if in use. |
| Update Policy | **Update** | Set to **Always** / **Pull latest** so **Update** in the Apps page pulls the new GHCR image. |

> For a true catalog app (future), these same two variables become a `questions.yaml` schema: `MTG_DATA_PATH` = Dataset picker, `SECRET_KEY` = Secret env var. That is the whole ballgame - see the docs.

## 4. Deploy

Click **Create / Deploy**. TrueNAS pulls the image and starts it. Verify at `http://<TrueNAS-IP>:7432/`.

## 5. Updates

Push to `main` -> GitHub Actions builds -> in TrueNAS: **Apps -> mtg-collection -> Update**.

No SSH, no rebuild, no `.env` file to hunt for. The app data dataset persists.

## Troubleshooting

* **Custom App find:** It's under **Apps -> Custom App** at the top, not under **Community Catalog**. If you don't see it, your TrueNAS version is too old - use the Dockge guide instead.
* **Old image after Update:** Make sure **Update Policy** is set to pull. Otherwise it restarts the same local image.
* **Data vs code folder:** The Host Path dataset is `databases > MTG-collection`. The app config lives in TrueNAS's apps storage - don't put files there.

## Future: TrueNAS Catalog App

A catalog app is exactly the same image + compose, plus a `questions.yaml` definition for the table above (host path dropdown, secret env var, port). Once those two variables are final, adding a catalog entry is mostly packaging + CI review, not a rewrite. See `README.md` notes.
