# Practice Room

A local mock-interview coach with a Next.js frontend and FastAPI backend. Users can record or upload one practice question, transcribe it with Whisper, and generate a truthful 50–60-word practice answer with the OpenAI Responses API.

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and set a valid `OPENAI_API_KEY`. The existing project-root `.env` is also supported.
2. Install backend packages with `pip install -r backend/requirements.txt`.
3. Start the backend with `python -m backend`. The existing `python app.py` command remains supported.
4. In `frontend`, copy `.env.local.example` to `.env.local` if the backend is not at the default address.
5. Install frontend packages with `npm install`, then start it with `npm run dev`.
6. Open `http://localhost:3000`.

The app is intended for mock interviews and disclosed coaching. Uploaded audio is stored only in a temporary file and removed after each request.

## Project structure

```text
backend/
  app/
    api/routes/       # HTTP endpoints
    core/             # Configuration and shared errors
    schemas/          # API response models
    services/         # Whisper and OpenAI integrations
    utils/            # Upload helpers
    main.py            # FastAPI application factory
  tests/               # Backend contract tests
  requirements.txt
frontend/
  app/                 # Next.js UI and API proxy
```
