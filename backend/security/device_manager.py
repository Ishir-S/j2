import os
import json
import uuid
import time
from typing import Dict, Any, List, Optional

DB_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "device_db.json")

class DeviceManager:
    def __init__(self):
        self.db_path = DB_FILE
        self.local_device: Dict[str, Any] = {}
        self.devices: Dict[str, Any] = {}
        self.load_db()

    def load_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        if os.path.exists(self.db_path):
            with open(self.db_path, "r") as f:
                data = json.load(f)
                self.local_device = data.get("local_device", {})
                self.devices = data.get("devices", {})
        
        if not self.local_device:
            self.local_device = {
                "device_id": str(uuid.uuid4()),
                "name": "JARVIS Node",
                "role": "CLIENT",
                "trust_level": "OWNER",
                "platform": os.name,
                "created_at": time.time()
            }
            self.save_db()

    def save_db(self):
        with open(self.db_path, "w") as f:
            json.dump({
                "local_device": self.local_device,
                "devices": self.devices
            }, f, indent=2)

    def get_local_device(self):
        return self.local_device

    def set_role(self, role: str):
        if role in ["HOST", "CLIENT"]:
            self.local_device["role"] = role
            self.save_db()

    def register_device(self, device_info: Dict[str, Any]):
        did = device_info.get("device_id")
        if not did or did == self.local_device["device_id"]:
            return
        
        if did not in self.devices:
            self.devices[did] = {
                "device_id": did,
                "name": device_info.get("name", "Unknown"),
                "role": device_info.get("role", "CLIENT"),
                "trust_level": "UNTRUSTED",
                "last_seen": time.time(),
                "ip": device_info.get("ip")
            }
        else:
            self.devices[did]["last_seen"] = time.time()
            self.devices[did]["role"] = device_info.get("role", self.devices[did].get("role"))
            if "ip" in device_info:
                self.devices[did]["ip"] = device_info["ip"]
        
        self.save_db()

    def get_all_devices(self) -> List[Dict[str, Any]]:
        return list(self.devices.values())

device_manager = DeviceManager()
