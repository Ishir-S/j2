import os
import sys
import json
import uuid
import time
import socket
from typing import Dict, Any, List, Optional

DB_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "device_db.json")


def get_machine_fingerprint() -> str:
    """Generates a hardware/hostname fingerprint unique to this specific computer."""
    hostname = socket.gethostname()
    mac = uuid.getnode()
    return f"{hostname}:{mac}:{sys.platform}"


def generate_unique_device_id() -> str:
    """Generates a deterministic, unique UUID for this computer."""
    fingerprint = get_machine_fingerprint()
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"jarvis-node:{fingerprint}"))


class DeviceManager:
    def __init__(self):
        self.db_path = DB_FILE
        self.local_device: Dict[str, Any] = {}
        self.devices: Dict[str, Any] = {}
        self.load_db()

    def load_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        current_fingerprint = get_machine_fingerprint()
        hostname = socket.gethostname()

        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.local_device = data.get("local_device", {})
                    self.devices = data.get("devices", {})
            except Exception:
                self.local_device = {}
                self.devices = {}

        # If empty, or copied from another machine via Git (different fingerprint), re-generate unique ID
        if not self.local_device or self.local_device.get("fingerprint") != current_fingerprint:
            previous_role = self.local_device.get("role", "CLIENT")
            self.local_device = {
                "device_id": generate_unique_device_id(),
                "name": f"JARVIS ({hostname})",
                "role": previous_role,
                "trust_level": "OWNER",
                "platform": sys.platform,
                "fingerprint": current_fingerprint,
                "created_at": time.time()
            }
            # Clean out any self-entries in devices
            self.devices.pop(self.local_device["device_id"], None)
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
