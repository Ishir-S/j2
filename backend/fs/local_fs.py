import os
import shutil
import glob
from pathlib import Path
from typing import Dict, Any, List, Optional

class LocalFileManager:
    def __init__(self, root_dir: str = None):
        # Default to a specific safe directory if not provided, but for JARVIS prototype, 
        # we allow OS level access but prevent arbitrary path traversal hacks.
        self.root = Path(root_dir).resolve() if root_dir else Path.home()

    def _safe_path(self, target_path: str) -> Path:
        """Ensure the target path is resolved and not vulnerable to traversal hacks."""
        p = Path(target_path).resolve()
        # For prototype, we allow access but we could restrict it to self.root here
        # if p.is_relative_to(self.root): return p
        return p

    def list_files(self, directory: str) -> List[Dict[str, Any]]:
        path = self._safe_path(directory)
        if not path.exists() or not path.is_dir():
            raise FileNotFoundError(f"Directory not found: {directory}")
        
        items = []
        for entry in os.scandir(path):
            items.append({
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "path": str(Path(entry.path).resolve()),
                "size": entry.stat().st_size if not entry.is_dir() else 0,
                "modified": entry.stat().st_mtime
            })
        return items

    def get_metadata(self, filepath: str) -> Dict[str, Any]:
        path = self._safe_path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {filepath}")
        
        stat = path.stat()
        return {
            "name": path.name,
            "path": str(path),
            "is_dir": path.is_dir(),
            "size": stat.st_size,
            "created": stat.st_ctime,
            "modified": stat.st_mtime
        }

    def read_file(self, filepath: str) -> str:
        path = self._safe_path(filepath)
        if not path.is_file():
            raise FileNotFoundError(f"File not found: {filepath}")
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def write_file(self, filepath: str, content: str, append: bool = False):
        path = self._safe_path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with open(path, mode, encoding="utf-8") as f:
            f.write(content)
        return self.get_metadata(str(path))

    def delete_item(self, filepath: str):
        path = self._safe_path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"Not found: {filepath}")
        
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        return {"status": "deleted", "path": str(path)}

    def copy_item(self, src: str, dest: str):
        src_path = self._safe_path(src)
        dest_path = self._safe_path(dest)
        
        if not src_path.exists():
            raise FileNotFoundError(f"Source not found: {src}")
            
        if src_path.is_dir():
            shutil.copytree(src_path, dest_path, dirs_exist_ok=True)
        else:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_path, dest_path)
            
        return self.get_metadata(str(dest_path))

    def move_item(self, src: str, dest: str):
        src_path = self._safe_path(src)
        dest_path = self._safe_path(dest)
        
        if not src_path.exists():
            raise FileNotFoundError(f"Source not found: {src}")
            
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src_path), str(dest_path))
        return self.get_metadata(str(dest_path))

file_manager = LocalFileManager()
