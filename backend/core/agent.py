"""
JARVIS - GROK AI REASONING & AUTONOMOUS AGENT BRAIN
Implements a ReAct (Reasoning + Acting + Observing) execution loop,
connecting xAI Grok API (https://api.x.ai/v1) with genuine host tools and UI capabilities.
"""

import os
import sys
import json
import re
import asyncio
from typing import Dict, Any, List, Optional, AsyncGenerator, Callable
import httpx

from . import memory
from . import tools

DEFAULT_GROK_URL = "https://api.x.ai/v1"
DEFAULT_MODEL = "grok-2-latest"


def get_grok_api_key() -> str:
    return os.environ.get("GROK_API_KEY", "").strip()


def build_system_prompt() -> str:
    memory_context = memory.build_system_context()
    tools_catalog = json.dumps(tools.TOOL_DEFINITIONS, indent=2)

    return f"""You are JARVIS — a brilliant, unflappably composed, highly capable AI assistant powered by xAI Grok.
You speak with polished, precise language, genuine warmth, and a touch of dry wit, but cleverness never compromises technical rigor.

=== INTENT & CAPABILITY UNDERSTANDING PROTOCOL ===
Before taking action, classify the user's intent across all scales:
1. QUESTION_OR_CONVERSATION: General questions, greetings, explanations, concept discussions. (Answer directly in character).
2. OPEN_FEATURE: User wants to open/launch a window or feature (Dashboard, Camera, Viewer, Globe, Research, ASA, Physics, Projects, Chat).
3. EXECUTE_CAPABILITY: User wants to trigger an existing feature tool (spawn physics object, calculate distance, locate city, select 3D part, start research, etc.).
4. SYSTEM_CHANGE_OR_MODIFICATION: User wants to edit code, create files, import files, save projects, or modify system settings.

{memory_context}

=== AVAILABLE NATIVE TOOLS & CAPABILITIES ===
You have genuine access to host computer automation and UI capabilities through these native tools:
{tools_catalog}

=== HOW TO USE TOOLS (CRITICAL PROTOCOL) ===
When you need to interact with the computer, run commands, read/write files, search the web, query system status, access memory, or control the HUD, respond with a TOOL CALL block in this exact JSON format:

```tool_call
{{
  "thought": "A brief 1-sentence reasoning explaining intent classification and what tool you are using.",
  "tool": "tool_name",
  "arguments": {{
    "arg1": "value1"
  }}
}}
```

RULES:
1. You can call tools multiple times in sequence to solve multi-step problems (e.g. search files -> read file -> edit -> verify).
2. When you receive the tool's execution result in the next turn, analyze it, and either call another tool or give your final answer.
3. If a task is a question or conversation, respond directly in character without any tool_call block.
4. Always verify that actions succeeded before telling the user something is done.
5. Be concise and confident.
"""


class JarvisAgent:
    def __init__(self, api_key: str = "", model: str = DEFAULT_MODEL, base_url: str = DEFAULT_GROK_URL):
        self.api_key = api_key or get_grok_api_key()
        self.model = model
        self.base_url = base_url
        self.max_iterations = 6

    async def get_available_models(self) -> List[str]:
        return ["grok-2-latest", "grok-2-1212", "grok-beta", "grok-vision-beta"]

    async def run(
        self,
        user_message: str,
        session_id: str = "default",
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Executes the ReAct agent loop using Grok API, yielding real-time events.
        Events include: status updates, tool calls, tool results, and streamed text tokens.
        """
        api_key = self.api_key or get_grok_api_key()
        if not api_key:
            yield {
                "type": "error",
                "error": "Grok API Key missing. Please set GROK_API_KEY environment variable or configure it in the HUD settings."
            }
            return

        # Save user turn to memory
        memory.save_chat_turn("user", user_message, session_id=session_id)

        # Build conversation history
        history = memory.get_recent_history(limit=16, session_id=session_id)
        
        system_prompt = build_system_prompt()
        messages = [{"role": "system", "content": system_prompt}]
        for h in history[:-1]:  # include prior turns
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": user_message})

        executed_tools_summary = []
        iteration = 0

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        while iteration < self.max_iterations:
            iteration += 1
            yield {"type": "status", "status": "THINKING", "detail": f"Grok Intent Reasoning (step {iteration})..."}

            full_response = ""
            async with httpx.AsyncClient(timeout=60.0) as client:
                try:
                    req_payload = {
                        "model": self.model,
                        "messages": messages,
                        "stream": True,
                        "temperature": 0.3
                    }
                    async with client.stream("POST", f"{self.base_url}/chat/completions", headers=headers, json=req_payload) as response:
                        if response.status_code != 200:
                            err_text = await response.aread()
                            yield {"type": "error", "error": f"Grok API Error {response.status_code}: {err_text.decode('utf-8', 'ignore')}"}
                            return

                        async for line in response.aiter_lines():
                            line_str = line.strip()
                            if not line_str or line_str.startswith(":"):
                                continue

                            if line_str == "data: [DONE]":
                                break

                            if line_str.startswith("data: "):
                                try:
                                    chunk_json = json.loads(line_str[6:])
                                    delta = chunk_json.get("choices", [{}])[0].get("delta", {})
                                    token = delta.get("content", "")
                                    if token:
                                        full_response += token
                                        yield {"type": "token", "token": token, "full": full_response}
                                except json.JSONDecodeError:
                                    pass

                except httpx.ConnectError:
                    yield {
                        "type": "error",
                        "error": "Could not connect to Grok API at https://api.x.ai/v1. Check your internet connection."
                    }
                    return
                except Exception as e:
                    yield {"type": "error", "error": f"Grok Agent error: {str(e)}"}
                    return

            # Check if Grok requested a tool call
            tool_call_match = re.search(r'```tool_call\s*(\{.*?\})\s*```', full_response, re.DOTALL)

            if not tool_call_match:
                # No tool call, conversational response
                memory.save_chat_turn("assistant", full_response, session_id=session_id, tool_calls=executed_tools_summary)
                yield {"type": "done", "response": full_response, "tools_used": executed_tools_summary}
                return

            # Parse tool call
            try:
                tool_data = json.loads(tool_call_match.group(1))
                tool_name = tool_data.get("tool")
                tool_args = tool_data.get("arguments", {})
                thought = tool_data.get("thought", f"Executing {tool_name}")
            except json.JSONDecodeError as e:
                messages.append({"role": "assistant", "content": full_response})
                messages.append({"role": "user", "content": f"SYSTEM ERROR: Tool call JSON was malformed: {str(e)}. Please retry with valid JSON."})
                continue

            yield {
                "type": "tool_call",
                "tool": tool_name,
                "arguments": tool_args,
                "thought": thought
            }
            yield {"type": "status", "status": "EXECUTING_TOOL", "detail": f"Running {tool_name}..."}

            # Execute tool asynchronously
            loop_env = asyncio.get_event_loop()
            tool_result = await loop_env.run_in_executor(None, tools.execute_tool, tool_name, tool_args)

            executed_tools_summary.append({
                "tool": tool_name,
                "arguments": tool_args,
                "result": tool_result
            })

            yield {
                "type": "tool_result",
                "tool": tool_name,
                "result": tool_result
            }

            # Append tool interaction to context for next turn
            messages.append({"role": "assistant", "content": full_response})
            messages.append({
                "role": "user",
                "content": f"TOOL RESULT for [{tool_name}]:\n{json.dumps(tool_result, indent=2)}\n\nNow continue: either call another tool if needed, or provide your final spoken response."
            })

        fallback_msg = "Task execution reached limit of sequential operations. Here is what was accomplished."
        memory.save_chat_turn("assistant", fallback_msg, session_id=session_id, tool_calls=executed_tools_summary)
        yield {"type": "done", "response": fallback_msg, "tools_used": executed_tools_summary}
