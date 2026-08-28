import os
import json
from typing import Dict, Any

from backend.security.device_manager import device_manager

PERM_DB_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "permissions_db.json")

class PermissionSystem:
    def __init__(self):
        self.db_path = PERM_DB_FILE
        self.policies: Dict[str, Any] = {}
        self.load_db()

    def load_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        if os.path.exists(self.db_path):
            with open(self.db_path, "r") as f:
                self.policies = json.load(f)
        else:
            # Default Policies
            self.policies = {
                "TRUSTED": {
                    "fs.read": "ALLOW",
                    "fs.write": "ALLOW",
                    "fs.delete": "ASK",
                    "sys.info": "ALLOW"
                },
                "EXTERNAL": {
                    "fs.read": "ASK",
                    "fs.write": "DENY",
                    "fs.delete": "DENY",
                    "sys.info": "ASK"
                },
                "UNTRUSTED": {
                    "fs.read": "DENY",
                    "fs.write": "DENY",
                    "fs.delete": "DENY",
                    "sys.info": "DENY"
                }
            }
            self.save_db()

    def save_db(self):
        with open(self.db_path, "w") as f:
            json.dump(self.policies, f, indent=2)

    def evaluate(self, source_device_id: str, action: str) -> str:
        """
        Returns "ALLOW", "ASK", or "DENY"
        """
        # If it's the local device asking itself, allow
        local_dev = device_manager.get_local_device()
        if source_device_id == local_dev["device_id"]:
            return "ALLOW"

        # Lookup device in registry
        devices = device_manager.get_all_devices()
        target_dev = next((d for d in devices if d["device_id"] == source_device_id), None)
        
        if not target_dev:
            return "DENY" # Unknown device fails closed
            
        trust_level = target_dev.get("trust_level", "UNTRUSTED")
        
        if trust_level == "OWNER":
            return "ALLOW"

        policy = self.policies.get(trust_level, self.policies["UNTRUSTED"])
        return policy.get(action, "DENY")

permission_system = PermissionSystem()
