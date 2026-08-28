import os
import shutil

ROOT = r"c:\Users\Gaavya\Downloads\J-main"
BACKEND = os.path.join(ROOT, "backend")

dirs_to_make = [
    "network",
    "security",
    "fs",
    "models"
]

for d in dirs_to_make:
    os.makedirs(os.path.join(BACKEND, d), exist_ok=True)

with open(os.path.join(BACKEND, "network", "__init__.py"), "w") as f: f.write("")
with open(os.path.join(BACKEND, "security", "__init__.py"), "w") as f: f.write("")
with open(os.path.join(BACKEND, "fs", "__init__.py"), "w") as f: f.write("")
with open(os.path.join(BACKEND, "models", "__init__.py"), "w") as f: f.write("")

print("Directories created.")
