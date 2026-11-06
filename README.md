# MTG Collection & PRISM Deck Hub

A self-hosted Magic: The Gathering collection manager and deck tracker designed for the **modular "One Card, Every Deck"** system (such as [PRISM](https://www.kickstarter.com/projects/prismmtg/prism-one-card-every-deck)).

For a detailed explanation of the project's background, architecture, and workflow, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

---

## Quick Start

### Running Locally (Python)

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the application:**
   ```bash
   python run.py
   ```

3. Open your browser to `http://localhost:7432`.

### Running with Docker / TrueNAS

1. Build and start the container:
   ```bash
   docker compose up -d
   ```

2. The application will be accessible at port `7432`. Data is persisted to the mapped directory configured in `docker-compose.yml`.
