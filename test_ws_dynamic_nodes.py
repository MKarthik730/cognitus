import asyncio
import json
import sys
import time

try:
    import websockets
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets

WS_URL = "ws://localhost:8001/ws/test_session_dynamic"
TIMEOUT = 120
START_TIME = time.time()

EVENT_COUNTS = {}


def elapsed() -> str:
    return f"[+{time.time() - START_TIME:.1f}s]"


async def test_dynamic_node_selection():
    print(f"{elapsed()} Connecting to {WS_URL} ...")
    try:
        async with websockets.connect(WS_URL, ping_timeout=10) as ws:
            print(f"{elapsed()} Connected. Sending analysis request ...")

            await ws.send(
                json.dumps(
                    {
                        "situation": "A 65-year-old male with history of hypertension and diabetes presents with acute chest pain radiating to the left arm, shortness of breath, and diaphoresis. ECG shows ST elevation in leads V1-V4. What is the appropriate management?",
                        "user_id": 1,
                    }
                )
            )

            print(f"{elapsed()} Waiting for events (timeout={TIMEOUT}s) ...\n")

            node_selection_start_received = False
            node_selection_complete_received = False
            selected_nodes = []
            expert_responses = []
            errors = []
            complete_received = False
            all_events = []

            while True:
                remaining = TIMEOUT - (time.time() - START_TIME)
                if remaining <= 0:
                    print(f"{elapsed()} TIMEOUT reached ({TIMEOUT}s)")
                    break

                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=min(10, remaining))
                except asyncio.TimeoutError:
                    print(f"{elapsed()} (no message for 10s, still waiting...)")
                    continue

                data = json.loads(raw)
                event_type = data.get("type", "UNKNOWN")
                EVENT_COUNTS[event_type] = EVENT_COUNTS.get(event_type, 0) + 1
                all_events.append(data)

                indent = (
                    "  "
                    if event_type
                    in (
                        "expert_complete",
                        "expert_error",
                        "node_start",
                        "node_complete",
                    )
                    else ""
                )

                if event_type == "node_selection_start":
                    node_selection_start_received = True
                    print(f"{elapsed()} {indent}EVENT: node_selection_start")

                elif event_type == "node_selection_complete":
                    node_selection_complete_received = True
                    selected_nodes = data.get("nodes", [])
                    names = [n.get("name", "?") for n in selected_nodes]
                    print(f"{elapsed()} {indent}EVENT: node_selection_complete")
                    print(
                        f"{elapsed()} {indent}  -> Selected nodes ({len(selected_nodes)}): {names}"
                    )
                    for n in selected_nodes:
                        print(
                            f"{elapsed()} {indent}     - {n.get('name')}: role={n.get('role')[:60]}..."
                        )

                elif event_type == "expert_complete":
                    domain = data.get("domain", "?")
                    expert_responses.append(domain)
                    conf = data.get("data", {}).get("confidence", "?")
                    model = data.get("data", {}).get("model_used", "?")
                    print(
                        f"{elapsed()} {indent}EVENT: expert_complete  domain={domain}  confidence={conf}  model={model}"
                    )

                elif event_type == "expert_error":
                    errors.append(data)
                    print(
                        f"{elapsed()} {indent}EVENT: expert_error  domain={data.get('domain')}  error={data.get('error')}"
                    )

                elif event_type == "node_start":
                    print(
                        f"{elapsed()} {indent}EVENT: node_start  node={data.get('node')}  status={data.get('status')}"
                    )

                elif event_type == "node_complete":
                    node = data.get("node", "?")
                    d = data.get("data", {})
                    if node == "cross_check":
                        print(
                            f"{elapsed()} {indent}EVENT: node_complete  node=cross_check  "
                            f"contradictions={len(d.get('contradictions', []))}  "
                            f"agreements={len(d.get('agreements', []))}  "
                            f"consensus_score={d.get('consensus_score', '?')}"
                        )
                    elif node == "synthesizer":
                        print(
                            f"{elapsed()} {indent}EVENT: node_complete  node=synthesizer  "
                            f"verdict={d.get('verdict', '?')[:80]}  "
                            f"confidence={d.get('confidence', '?')}"
                        )
                    else:
                        print(f"{elapsed()} {indent}EVENT: node_complete  node={node}")

                elif event_type == "complete":
                    complete_received = True
                    d = data.get("data", {})
                    print(f"{elapsed()} EVENT: complete")
                    print(f"{elapsed()}   verdict: {d.get('verdict', 'N/A')[:100]}")
                    print(
                        f"{elapsed()}   consensus_score: {d.get('consensus_score', 'N/A')}"
                    )
                    print(
                        f"{elapsed()}   experts: {[e.get('domain') for e in d.get('experts', [])]}"
                    )
                    print(
                        f"{elapsed()}   contradictions: {len(d.get('contradictions', []))}"
                    )
                    print(f"{elapsed()}   agreements: {len(d.get('agreements', []))}")

                elif event_type == "error":
                    errors.append(data)
                    print(
                        f"{elapsed()} {indent}EVENT: error  message={data.get('message')}"
                    )

                else:
                    print(
                        f"{elapsed()} {indent}EVENT: {event_type}  data={json.dumps(data, ensure_ascii=False)[:200]}"
                    )

                if event_type == "complete" or event_type == "error":
                    break

            print(f"\n{'=' * 60}")
            print(f"{elapsed()} SUMMARY")
            print(f"{'=' * 60}")
            print(
                f"  node_selection_start:      {'YES' if node_selection_start_received else 'NO'}"
            )
            print(
                f"  node_selection_complete:    {'YES' if node_selection_complete_received else 'NO'}"
            )
            if node_selection_complete_received:
                names = [n.get("name", "?") for n in selected_nodes]
                print(f"  Selected nodes:             {names}")
            print(
                f"  Expert responses:           {len(expert_responses)} ({expert_responses})"
            )
            print(
                f"  Complete event:             {'YES' if complete_received else 'NO'}"
            )
            print(f"  Errors:                     {len(errors)}")
            for e in errors:
                print(f"    - {e.get('type')}: {e.get('message', e.get('error', '?'))}")
            print(f"  Event counts:               {EVENT_COUNTS}")
            print(f"  Total events received:      {sum(EVENT_COUNTS.values())}")
            print(f"  Elapsed time:               {time.time() - START_TIME:.1f}s")

    except websockets.exceptions.WebSocketException as e:
        print(f"{elapsed()} WebSocket connection error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"{elapsed()} Unexpected error: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_dynamic_node_selection())
