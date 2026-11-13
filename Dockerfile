FROM python:3.12-slim

WORKDIR /app

# Dependencies first so this layer is cached between code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The database lives here; mount a volume over it (see docker-compose.yml)
RUN mkdir -p /app/data

EXPOSE 7432

# Gunicorn instead of Flask's development server. One worker process keeps a
# single SQLite writer and shared in-memory caches; threads handle concurrent
# requests. The long timeout covers big imports and price refreshes, which call
# Scryfall in batches.
CMD ["gunicorn", "--bind", "0.0.0.0:7432", "--workers", "1", "--threads", "4", "--timeout", "300", "--access-logfile", "-", "run:app"]
