# ============================================================
# historyHandler — AWS Lambda
# Returns the most recent ChatHistory items across all conversations.
# Uses Scan + in-memory sort. Fine for small tables.
# ============================================================

import os
import json
import boto3

CHAT_TABLE = os.environ.get("CHAT_TABLE", "ChatHistory")

dynamodb = boto3.resource("dynamodb")
chat_table = dynamodb.Table(CHAT_TABLE)


def lambda_handler(event, context):
    params = event.get("queryStringParameters") or {}
    limit = int(params.get("limit", 20))

    try:
        items = []
        resp = chat_table.scan()
        items.extend(resp.get("Items", []))

        # Handle pagination if the table is bigger than 1MB
        while "LastEvaluatedKey" in resp:
            resp = chat_table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        # Newest first
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        # Trim to requested limit
        items = items[:limit]

        return _response(200, {"items": items, "count": len(items)})

    except Exception as e:
        print(f"[historyHandler] error: {e}")
        return _response(500, {"error": str(e)})


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }