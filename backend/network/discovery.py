import socket
import threading
import json
import time
import struct
from typing import Callable, Dict, Any
from backend.security.device_manager import device_manager

MCAST_GRP = '224.1.1.1'
MCAST_PORT = 5007

class DiscoveryService:
    def __init__(self, port: int = 8000):
        self.port = port
        self.running = False
        self.sock = None
        self.broadcast_thread = None
        self.listen_thread = None
        self.callbacks = []

    def start(self):
        self.running = True
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
            self.sock.bind(('', MCAST_PORT))
        except OSError as e:
            print(f"[Discovery] Bind failed: {e}")
            return

        mreq = struct.pack("4sl", socket.inet_aton(MCAST_GRP), socket.INADDR_ANY)
        self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

        self.listen_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.listen_thread.start()

        self.broadcast_thread = threading.Thread(target=self._broadcast_loop, daemon=True)
        self.broadcast_thread.start()
        
        print(f"[Discovery] Started on {MCAST_GRP}:{MCAST_PORT}")

    def stop(self):
        self.running = False
        if self.sock:
            try:
                self.sock.close()
            except:
                pass

    def add_callback(self, cb: Callable[[Dict[str, Any]], None]):
        self.callbacks.append(cb)

    def _broadcast_loop(self):
        bsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        bsock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        while self.running:
            try:
                local_info = device_manager.get_local_device()
                msg = json.dumps({
                    "action": "announce",
                    "device_id": local_info["device_id"],
                    "name": local_info["name"],
                    "role": local_info["role"],
                    "port": self.port
                }).encode('utf-8')
                bsock.sendto(msg, (MCAST_GRP, MCAST_PORT))
            except Exception as e:
                print(f"[Discovery] Broadcast error: {e}")
            time.sleep(5)
        bsock.close()

    def _listen_loop(self):
        while self.running:
            try:
                data, addr = self.sock.recvfrom(1024)
                ip = addr[0]
                msg = json.loads(data.decode('utf-8'))
                
                if msg.get("action") == "announce":
                    did = msg.get("device_id")
                    local_id = device_manager.get_local_device()["device_id"]
                    if did and did != local_id:
                        msg["ip"] = ip
                        device_manager.register_device(msg)
                        for cb in self.callbacks:
                            try:
                                cb(msg)
                            except:
                                pass
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:
                    print(f"[Discovery] Listen error: {e}")
                time.sleep(1)

discovery_service = DiscoveryService()
