import os
from pydantic import BaseModel
from typing import Dict, Any

class MessageRequest(BaseModel):
    text: str
    session_id: str = "default"

class SettingsRequest(BaseModel):
    api_key: str = ""
    model: str = "llama-3.3-70b-versatile"
    base_url: str = "https://api.groq.com/openai/v1"

class FactRequest(BaseModel):
    category: str
    key: str
    value: str

class ToolExecRequest(BaseModel):
    tool: str
    arguments: Dict[str, Any] = {}

class RoleRequest(BaseModel):
    role: str

class FSWriteRequest(BaseModel):
    path: str
    content: str
    request_device_id: str = ""
