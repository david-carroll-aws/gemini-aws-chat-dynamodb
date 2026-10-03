# Gemini Chat → DynamoDB

A **full-stack serverless** AI chat that streams prompts to Google's Gemini via Vertex AI and persists every exchange through AWS API Gateway and Lambda into DynamoDB — with the frontend reflecting save state live, so users can watch their conversation being written to the AWS environment in real time.

**Note:** This is a personal educational project. The live DynamoDB view exists to demonstrate the write path end-to-end — not to suggest that real chat users need to see their data persisted.

Built as a portfolio project to explore the intersection of **serverless AWS**, **Google Cloud AI**, and **live UX feedback**.

---

## Architecture

```
┌──────────────────┐
│   Browser UI     │  Overlay in a dashboard (gdb/gdb.html + gdb.css + gdb.js)
│                  │  Captures visitor + conversation IDs, renders chat + save state
└────────┬─────────┘
         │ POST  { input, visitorId, conversationId }
         ▼
┌──────────────────┐
│  API Gateway     │  HTTP API  ·  $default stage  ·  CORS enabled
└────────┬─────────┘
         │ Lambda proxy integration
         ▼
┌──────────────────┐        ┌──────────────────┐
│  chatHandler     │───────▶│   Vertex AI      │
│  Lambda (3.14)   │        │   Gemini 3.1     │
│                  │◀───────│   Flash Lite     │
└────────┬─────────┘        └──────────────────┘
         │ put_item + query
         ▼
┌──────────────────┐
│   DynamoDB       │  ChatHistory: conversationId (PK) + timestamp (SK)
│   ChatHistory    │  Fields: visitorId, input, response, model
└────────┬─────────┘
         │ saved · savedCount · firstSavedAt
         ▼
┌──────────────────┐
│   Live UI        │  ✓ Saved to DynamoDB · HH:MM:SS
│   feedback       │  Header: "N AI responses recorded to DynamoDB"
│                  │  Session details: visitor, convo, count, first saved
│                  │  Right panel: last 20 rows, refreshed after each save
└──────────────────┘
```

A second Lambda (`historyHandler`) exposes `GET /history` and returns the 20 most recent items across all conversations, which power the live read-out panel beside the chat.

---

## What It Does

| Layer      | Feature                                                              |
|------------|----------------------------------------------------------------------|
| **Frontend** | Chat overlay, save tags, header chip, session panel, live DB panel  |
| **API**      | `POST /chat` for messages, `GET /history` for the recent-items feed |
| **Compute**  | Two Lambdas: one calls Gemini + writes, one reads from DynamoDB     |
| **AI**       | Google Vertex AI · Gemini 3.1 Flash Lite via `google-genai` SDK     |
| **Storage**  | DynamoDB `ChatHistory` — one row per exchange                       |

The UI intentionally surfaces the write path: every message renders a `✓ Saved to DynamoDB · HH:MM:SS` tag beneath the AI's response, and the header tracks a live count of items persisted for the session.

---

## Behind the Build

**Packaging the Gemini SDK for Lambda.** The `google-genai` SDK depends on `pydantic-core`, which ships as a compiled C extension — a `.so` on Linux, a `.pyd` on Windows. Lambda runs Linux, so a Windows-built package fails with `No module named 'pydantic_core._pydantic_core'`. The fix: build the deployment package inside a Docker container matching the Lambda runtime exactly (`python:3.14-slim`), guaranteeing both the OS and the Python version match.

The silent-fallback gotcha: `pip install --platform manylinux2014_x86_64` is *supposed* to fetch Linux wheels, but when it can't find one matching the exact Python version, it quietly falls back to the local platform's binaries. Verifying the zip contents (`unzip -l ... | grep pydantic_core`) is the only reliable way to catch it.

**Live UI feedback for async writes.** The chat happens optimistically — the user's message renders immediately, then the AI reply, then a save tag when the backend confirms the write landed. Getting the save indicator to feel like part of the message (not a floating badge) required restructuring the DOM: the tag is inserted as a *sibling* of the message row, not a child, avoiding flexbox stretching that left a visible gap before the next message.

**A read-out panel that proves it's real.** Beside the chat is a live panel showing the 20 most recent rows from DynamoDB — refreshed after every save. It's a small architectural choice that changes the whole character of the project: it stops being "a chat that saves" and becomes "a chat you can watch saving."

---

## Stack

| Layer      | Technology                                                          |
|------------|---------------------------------------------------------------------|
| Frontend   | Vanilla HTML / CSS / JS, overlay injected into an existing dashboard |
| Compute    | AWS Lambda (Python 3.14, Docker-built for native deps)              |
| API        | Amazon API Gateway (HTTP API)                                       |
| AI         | Google Vertex AI · Gemini 3.1 Flash Lite via `google-genai` SDK     |
| Storage    | Amazon DynamoDB (on-demand)                                         |
| Auth       | GCP service account (JSON key) via `GOOGLE_APPLICATION_CREDENTIALS` |
| Packaging  | Docker (`python:3.14-slim`) to produce Linux-compatible wheels      |

---

## Project Structure

```
/
├── index.html              Dashboard shell + nav (services rendered from a JS array)
├── gdb/
│   ├── gdb.html            Overlay markup (fetched and injected by gdb.js)
│   ├── gdb.css             All overlay styles
│   └── gdb.js              Overlay logic: open/close, chat, save-state UI, DB panel
├── ServiceData.html        Renders the main iframe content per service
└── DocumentationData.html  Renders the right-panel docs per service
```
