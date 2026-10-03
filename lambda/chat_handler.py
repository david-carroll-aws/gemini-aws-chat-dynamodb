# ============================================================
# chatHandler — AWS Lambda
# Stage 2: Call Vertex AI + log each exchange to DynamoDB.
# ============================================================

import os
import json
import datetime
import boto3
from google import genai
from google.genai import types

# ---- Config ----
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "dacnyc-chainlink-nodes")
LOCATION   = os.environ.get("GCP_LOCATION", "global")
MODEL_NAME = os.environ.get("MODEL_NAME", "gemini-3.1-flash-lite")
CHAT_TABLE = os.environ.get("CHAT_TABLE", "ChatHistory")

SYSTEM_INSTRUCTION = (
    "You are a helpful assistant. "
    "Give a complete answer in 3 to 5 sentences. "
    "Write in plain prose without markdown, bullet points, or headers."
)

# ---- AWS client ----
dynamodb = boto3.resource("dynamodb")
chat_table = dynamodb.Table(CHAT_TABLE)

# ---- Gemini client ----
_client = None

def get_client():
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=PROJECT_ID,
            location=LOCATION
        )
    return _client


def call_gemini(message: str) -> str:
    client = get_client()
    chat = client.chats.create(
        model=MODEL_NAME,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            max_output_tokens=800,
            thinking_config=types.ThinkingConfig(thinking_level="low")
        )
    )
    response = chat.send_message(message)
    return response.text


def log_to_dynamodb(conversation_id, visitor_id, message, reply):
    """Write one exchange and return (saved, savedCount, firstSavedAt)."""
    try:
        timestamp = datetime.datetime.utcnow().isoformat() + "Z"
        chat_table.put_item(Item={
            "conversationId": conversation_id,
            "timestamp":      timestamp,
            "visitorId":      visitor_id,
            "input":          message,
            "response":       reply,
            "model":          MODEL_NAME,
        })

        # Count total messages in this conversation
        resp = chat_table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("conversationId").eq(conversation_id),
            Select="COUNT",
        )
        saved_count = resp.get("Count", 0)

        # Get the first message's timestamp
        first_resp = chat_table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("conversationId").eq(conversation_id),
            Limit=1,
            ScanIndexForward=True,
        )
        items = first_resp.get("Items", [])
        first_saved_at = items[0].get("timestamp") if items else timestamp

        return True, saved_count, first_saved_at

    except Exception as e:
        print(f"[chatHandler] DynamoDB error: {e}")
        return False, 0, None


def lambda_handler(event, context):
    # ---- Parse body ----
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        body = {}

    message         = (body.get("input") or body.get("message") or "").strip()
    visitor_id      = body.get("visitorId")
    conversation_id = body.get("conversationId")

    if not message:
        return _response(400, {"error": "empty message"})

    # ---- Call Gemini ----
    try:
        reply = call_gemini(message)
    except Exception as e:
        print(f"[chatHandler] Gemini error: {e}")
        return _response(500, {"error": str(e)})

    # ---- Log to DynamoDB (only if we have both IDs) ----
    saved = False
    saved_count = 0
    first_saved_at = None

    if conversation_id and visitor_id:
        saved, saved_count, first_saved_at = log_to_dynamodb(
            conversation_id, visitor_id, message, reply
        )
    else:
        print("[chatHandler] missing visitorId or conversationId — skipping log")

    # ---- Return ----
    return _response(200, {
        "response":     reply,
        "saved":        saved,
        "savedCount":   saved_count,
        "firstSavedAt": first_saved_at,
    })


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
        "body": json.dumps(body),
    }